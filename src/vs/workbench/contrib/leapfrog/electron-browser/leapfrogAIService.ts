/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Desktop implementation of ILeapfrogAIService.
 *
 * Wraps the OpenAI and Anthropic REST APIs directly (no shared @leapfrog/ai
 * dependency at the VS Code layer -- we keep the Electron side self-contained
 * so that the service can rely only on standard VS Code platform APIs and fetch).
 *
 * Follows the same self-contained pattern established by
 * `leapfrogTranscriptionService.ts`.
 */

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import {
	ILeapfrogAIService,
	ILeapfrogChatMessage,
	ILeapfrogChatConfig,
	ILeapfrogChatResponse,
	ILeapfrogChatStreamChunk,
	ILeapfrogAIModel,
	ILeapfrogApiKeyService,
	LEAPFROG_AVAILABLE_MODELS,
} from '../common/leapfrog.js';
import { LeapfrogConfigurationKeys } from '../common/leapfrogConfiguration.js';

const OPENAI_BASE = 'https://api.openai.com/v1';
const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';

export class LeapfrogAIService extends Disposable implements ILeapfrogAIService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@ILeapfrogApiKeyService private readonly apiKeyService: ILeapfrogApiKeyService,
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();
		this.logService.info('[Leapfrog] AI Service initialized');
	}

	// -----------------------------------------------------------------------
	// Public API
	// -----------------------------------------------------------------------

	async chat(messages: ILeapfrogChatMessage[], config?: ILeapfrogChatConfig): Promise<ILeapfrogChatResponse> {
		const model = this.resolveModel(config?.model);
		const provider = model.provider;
		const apiKey = await this.requireApiKey(provider);
		const temperature = config?.temperature ?? this.getConfiguredTemperature();
		const maxTokens = config?.maxTokens ?? this.getConfiguredMaxTokens();

		if (provider === 'openai') {
			return this.chatOpenAI(messages, model.id, temperature, maxTokens, apiKey);
		} else {
			return this.chatAnthropic(messages, model.id, temperature, maxTokens, apiKey);
		}
	}

	async *stream(messages: ILeapfrogChatMessage[], config?: ILeapfrogChatConfig): AsyncIterable<ILeapfrogChatStreamChunk> {
		const model = this.resolveModel(config?.model);
		const provider = model.provider;
		const apiKey = await this.requireApiKey(provider);
		const temperature = config?.temperature ?? this.getConfiguredTemperature();
		const maxTokens = config?.maxTokens ?? this.getConfiguredMaxTokens();

		if (provider === 'openai') {
			yield* this.streamOpenAI(messages, model.id, temperature, maxTokens, apiKey);
		} else {
			yield* this.streamAnthropic(messages, model.id, temperature, maxTokens, apiKey);
		}
	}

	getAvailableModels(): ILeapfrogAIModel[] {
		return [...LEAPFROG_AVAILABLE_MODELS];
	}

	getDefaultModel(): ILeapfrogAIModel {
		const defaultId = this.configurationService.getValue<string>(LeapfrogConfigurationKeys.DefaultModel) || 'gpt-4o';
		return LEAPFROG_AVAILABLE_MODELS.find(m => m.id === defaultId) || LEAPFROG_AVAILABLE_MODELS[0];
	}

	// -----------------------------------------------------------------------
	// Model / config helpers
	// -----------------------------------------------------------------------

	private resolveModel(modelId?: string): ILeapfrogAIModel {
		const id = modelId || this.getDefaultModel().id;
		const found = LEAPFROG_AVAILABLE_MODELS.find(m => m.id === id);
		if (!found) {
			throw new Error(`Unknown model: ${id}`);
		}
		return found;
	}

	private async requireApiKey(provider: 'openai' | 'anthropic'): Promise<string> {
		const key = await this.apiKeyService.getApiKey(provider);
		if (!key) {
			throw new Error(
				`${provider === 'openai' ? 'OpenAI' : 'Anthropic'} API key not configured. ` +
				'Please set your API key in Leapfrog settings (leapfrog.ai).'
			);
		}
		return key;
	}

	private getConfiguredTemperature(): number {
		return this.configurationService.getValue<number>(LeapfrogConfigurationKeys.Temperature) ?? 0.7;
	}

	private getConfiguredMaxTokens(): number {
		return this.configurationService.getValue<number>(LeapfrogConfigurationKeys.MaxTokens) ?? 4096;
	}

	// -----------------------------------------------------------------------
	// OpenAI
	// -----------------------------------------------------------------------

	private async chatOpenAI(
		messages: ILeapfrogChatMessage[],
		model: string,
		temperature: number,
		maxTokens: number,
		apiKey: string,
	): Promise<ILeapfrogChatResponse> {
		const body = {
			model,
			messages: messages.map(m => ({ role: m.role, content: m.content })),
			temperature,
			max_tokens: maxTokens,
		};

		const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`,
			},
			body: JSON.stringify(body),
		});

		if (!res.ok) {
			const text = await res.text().catch(() => 'Unknown error');
			throw new Error(`OpenAI API error ${res.status}: ${text}`);
		}

		const data = await res.json() as OpenAIChatResponse;
		const choice = data.choices?.[0];
		if (!choice) {
			throw new Error('No response from OpenAI');
		}

		return {
			content: choice.message?.content ?? '',
			model: data.model,
			usage: data.usage ? {
				promptTokens: data.usage.prompt_tokens,
				completionTokens: data.usage.completion_tokens,
				totalTokens: data.usage.total_tokens,
			} : undefined,
		};
	}

	private async *streamOpenAI(
		messages: ILeapfrogChatMessage[],
		model: string,
		temperature: number,
		maxTokens: number,
		apiKey: string,
	): AsyncGenerator<ILeapfrogChatStreamChunk> {
		const controller = new AbortController();

		try {
			const body = {
				model,
				messages: messages.map(m => ({ role: m.role, content: m.content })),
				temperature,
				max_tokens: maxTokens,
				stream: true,
			};

			const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${apiKey}`,
				},
				body: JSON.stringify(body),
				signal: controller.signal,
			});

			if (!res.ok) {
				const text = await res.text().catch(() => 'Unknown error');
				throw new Error(`OpenAI API error ${res.status}: ${text}`);
			}

			for await (const line of this.readSSELines(res)) {
				if (line === '[DONE]') {
					yield { content: '', done: true };
					return;
				}

				try {
					const data = JSON.parse(line) as OpenAIStreamChunk;
					const delta = data.choices?.[0]?.delta;
					if (delta?.content) {
						yield { content: delta.content, done: false };
					}
					if (data.choices?.[0]?.finish_reason) {
						yield { content: '', done: true };
						return;
					}
				} catch {
					// Skip malformed JSON lines
					this.logService.warn('[Leapfrog] Skipping malformed OpenAI stream line:', line);
				}
			}

			// Stream ended without explicit [DONE]
			yield { content: '', done: true };
		} finally {
			controller.abort();
		}
	}

	// -----------------------------------------------------------------------
	// Anthropic
	// -----------------------------------------------------------------------

	private async chatAnthropic(
		messages: ILeapfrogChatMessage[],
		model: string,
		temperature: number,
		maxTokens: number,
		apiKey: string,
	): Promise<ILeapfrogChatResponse> {
		const { formatted, system } = this.formatAnthropicMessages(messages);

		const body: Record<string, unknown> = {
			model,
			messages: formatted,
			max_tokens: maxTokens,
			temperature,
		};

		if (system) {
			body.system = system;
		}

		const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': apiKey,
				'anthropic-version': ANTHROPIC_VERSION,
			},
			body: JSON.stringify(body),
		});

		if (!res.ok) {
			const text = await res.text().catch(() => 'Unknown error');
			throw new Error(`Anthropic API error ${res.status}: ${text}`);
		}

		const data = await res.json() as AnthropicChatResponse;
		const textBlock = data.content?.find((c: { type: string }) => c.type === 'text');

		return {
			content: textBlock?.text ?? '',
			model: data.model,
			usage: data.usage ? {
				promptTokens: data.usage.input_tokens,
				completionTokens: data.usage.output_tokens,
				totalTokens: data.usage.input_tokens + data.usage.output_tokens,
			} : undefined,
		};
	}

	private async *streamAnthropic(
		messages: ILeapfrogChatMessage[],
		model: string,
		temperature: number,
		maxTokens: number,
		apiKey: string,
	): AsyncGenerator<ILeapfrogChatStreamChunk> {
		const controller = new AbortController();

		try {
			const { formatted, system } = this.formatAnthropicMessages(messages);

			const body: Record<string, unknown> = {
				model,
				messages: formatted,
				max_tokens: maxTokens,
				temperature,
				stream: true,
			};

			if (system) {
				body.system = system;
			}

			const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': apiKey,
					'anthropic-version': ANTHROPIC_VERSION,
				},
				body: JSON.stringify(body),
				signal: controller.signal,
			});

			if (!res.ok) {
				const text = await res.text().catch(() => 'Unknown error');
				throw new Error(`Anthropic API error ${res.status}: ${text}`);
			}

			for await (const line of this.readSSELines(res)) {
				try {
					const data = JSON.parse(line) as AnthropicStreamEvent;

					if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
						yield { content: data.delta.text ?? '', done: false };
					} else if (data.type === 'message_stop') {
						yield { content: '', done: true };
						return;
					} else if (data.type === 'message_delta') {
						// Last event before message_stop, contains final usage
						if (data.delta?.stop_reason) {
							yield { content: '', done: true };
							return;
						}
					}
				} catch {
					// Skip malformed JSON lines
					this.logService.warn('[Leapfrog] Skipping malformed Anthropic stream line:', line);
				}
			}

			// Stream ended without explicit message_stop
			yield { content: '', done: true };
		} finally {
			controller.abort();
		}
	}

	private formatAnthropicMessages(messages: ILeapfrogChatMessage[]): {
		formatted: { role: 'user' | 'assistant'; content: string }[];
		system?: string;
	} {
		const formatted: { role: 'user' | 'assistant'; content: string }[] = [];
		let system: string | undefined;

		for (const msg of messages) {
			if (msg.role === 'system') {
				system = msg.content;
			} else {
				formatted.push({ role: msg.role, content: msg.content });
			}
		}

		return { formatted, system };
	}

	// -----------------------------------------------------------------------
	// SSE stream reader
	// -----------------------------------------------------------------------

	/**
	 * Reads SSE lines from a fetch Response. Yields the `data:` payloads,
	 * stripping the `data: ` prefix. Skips blank lines and `event:` lines.
	 */
	private async *readSSELines(response: Response): AsyncGenerator<string> {
		const reader = response.body?.getReader();
		if (!reader) {
			throw new Error('Response body is not readable');
		}

		const decoder = new TextDecoder();
		let buffer = '';

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');

				// Keep the last (possibly incomplete) line in the buffer
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					const trimmed = line.trim();

					// Skip empty lines and event-type lines
					if (!trimmed || trimmed.startsWith('event:')) {
						continue;
					}

					if (trimmed.startsWith('data: ')) {
						const payload = trimmed.slice(6);
						if (payload) {
							yield payload;
						}
					}
				}
			}

			// Process any remaining buffer
			if (buffer.trim()) {
				const trimmed = buffer.trim();
				if (trimmed.startsWith('data: ')) {
					const payload = trimmed.slice(6);
					if (payload) {
						yield payload;
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
	}
}

// ---------------------------------------------------------------------------
// Raw response shapes (internal)
// ---------------------------------------------------------------------------

interface OpenAIChatResponse {
	id: string;
	model: string;
	choices: {
		message: {
			role: string;
			content: string | null;
		};
		finish_reason: string | null;
	}[];
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

interface OpenAIStreamChunk {
	id: string;
	choices: {
		delta: {
			role?: string;
			content?: string;
		};
		finish_reason: string | null;
	}[];
}

interface AnthropicChatResponse {
	id: string;
	model: string;
	content: {
		type: string;
		text?: string;
	}[];
	usage?: {
		input_tokens: number;
		output_tokens: number;
	};
}

interface AnthropicStreamEvent {
	type: string;
	delta?: {
		type?: string;
		text?: string;
		stop_reason?: string;
	};
	usage?: {
		output_tokens: number;
	};
}
