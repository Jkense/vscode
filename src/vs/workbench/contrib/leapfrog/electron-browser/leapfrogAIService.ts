/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * AI Service for Leapfrog.
 *
 * Integrates with OpenAI and Anthropic APIs for chat completion and streaming.
 * Uses native SDKs (openai, @anthropic-ai/sdk) when available, or provides fallback
 * for HTTP-based streaming if SDKs are not installed.
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
	LEAPFROG_AVAILABLE_MODELS,
	ILeapfrogApiKeyService,
} from '../common/leapfrog.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { LeapfrogConfigurationKeys } from '../common/leapfrogConfiguration.js';

export class LeapfrogAIService extends Disposable implements ILeapfrogAIService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@ILeapfrogApiKeyService private readonly apiKeyService: ILeapfrogApiKeyService,
		@IConfigurationService private readonly configService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.logService.info('[Leapfrog] AI Service initialized');
	}

	// -----------------------------------------------------------------------
	// Chat API
	// -----------------------------------------------------------------------

	async chat(messages: ILeapfrogChatMessage[], config?: ILeapfrogChatConfig): Promise<ILeapfrogChatResponse> {
		const model = config?.model || this.getDefaultModel().id;
		const modelInfo = LEAPFROG_AVAILABLE_MODELS.find(m => m.id === model);

		if (!modelInfo) {
			throw new Error(`Unknown model: ${model}`);
		}

		// Collect all chunks and return as single response
		let fullContent = '';
		for await (const chunk of this.stream(messages, config)) {
			fullContent += chunk.content;
		}

		return {
			content: fullContent,
			model: model,
		};
	}

	// -----------------------------------------------------------------------
	// Streaming API
	// -----------------------------------------------------------------------

	async *stream(messages: ILeapfrogChatMessage[], config?: ILeapfrogChatConfig, cancelToken?: CancellationToken): AsyncIterable<ILeapfrogChatStreamChunk> {
		const model = config?.model || this.getDefaultModel().id;
		const modelInfo = LEAPFROG_AVAILABLE_MODELS.find(m => m.id === model);

		if (!modelInfo) {
			throw new Error(`Unknown model: ${model}`);
		}

		try {
			if (modelInfo.provider === 'openai') {
				yield* this.streamOpenAI(messages, model, config, cancelToken);
			} else if (modelInfo.provider === 'anthropic') {
				yield* this.streamAnthropic(messages, model, config, cancelToken);
			} else {
				throw new Error(`Unsupported provider: ${modelInfo.provider}`);
			}
		} catch (err) {
			this.logService.error('[Leapfrog] Streaming error:', err);
			throw err;
		}
	}

	// -----------------------------------------------------------------------
	// OpenAI Streaming
	// -----------------------------------------------------------------------

	private async *streamOpenAI(
		messages: ILeapfrogChatMessage[],
		model: string,
		config?: ILeapfrogChatConfig,
		cancelToken?: CancellationToken,
	): AsyncIterable<ILeapfrogChatStreamChunk> {
		const apiKey = await this.apiKeyService.getApiKey('openai');
		if (!apiKey) {
			throw new Error('OpenAI API key not configured. Please set it in settings.');
		}

		try {
			// Try to use native OpenAI SDK if available
			const OpenAI = await this.loadOpenAISDK();
			if (OpenAI) {
				yield* this.streamOpenAIWithSDK(OpenAI, apiKey, messages, model, config, cancelToken);
			} else {
				// Fallback to HTTP streaming
				yield* this.streamOpenAIWithHTTP(apiKey, messages, model, config, cancelToken);
			}
		} catch (err) {
			this.logService.error('[Leapfrog] OpenAI streaming failed:', err);
			throw err;
		}
	}

	private async *streamOpenAIWithSDK(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		OpenAI: any,
		apiKey: string,
		messages: ILeapfrogChatMessage[],
		model: string,
		config?: ILeapfrogChatConfig,
		cancelToken?: CancellationToken,
	): AsyncIterable<ILeapfrogChatStreamChunk> {
		const client = new (OpenAI as any)({ apiKey });
		const stream = await client.chat.completions.create({
			model,
			messages: messages,
			temperature: config?.temperature ?? 0.7,
			max_tokens: config?.maxTokens ?? 2000,
			stream: true,
		});

		for await (const chunk of stream) {
			if (cancelToken?.isCancellationRequested) {
				break;
			}

			const content = chunk.choices[0]?.delta?.content ?? '';
			if (content) {
				yield { content, done: false };
			}
		}

		yield { content: '', done: true };
	}

	private async *streamOpenAIWithHTTP(
		apiKey: string,
		messages: ILeapfrogChatMessage[],
		model: string,
		config?: ILeapfrogChatConfig,
		cancelToken?: CancellationToken,
	): AsyncIterable<ILeapfrogChatStreamChunk> {
		// Fallback HTTP implementation
		const controller = new AbortController();
		const cancelListener = cancelToken?.onCancellationRequested(() => controller.abort());

		try {
			const response = await fetch('https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${apiKey}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					model,
					messages,
					temperature: config?.temperature ?? 0.7,
					max_tokens: config?.maxTokens ?? 2000,
					stream: true,
				}),
				signal: controller.signal,
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
			}

			if (!response.body) {
				throw new Error('No response body from OpenAI');
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				const chunk = decoder.decode(value);
				const lines = chunk.split('\n');

				for (const line of lines) {
					if (line.startsWith('data: ')) {
						const data = line.slice(6);
						if (data === '[DONE]') {
							yield { content: '', done: true };
							return;
						}
						try {
							const parsed = JSON.parse(data);
							const content = parsed.choices?.[0]?.delta?.content ?? '';
							if (content) {
								yield { content, done: false };
							}
						} catch {
							// Ignore JSON parse errors (incomplete lines, etc)
						}
					}
				}
			}
		} finally {
			cancelListener?.dispose();
		}
	}

	// -----------------------------------------------------------------------
	// Anthropic Streaming
	// -----------------------------------------------------------------------

	private async *streamAnthropic(
		messages: ILeapfrogChatMessage[],
		model: string,
		config?: ILeapfrogChatConfig,
		cancelToken?: CancellationToken,
	): AsyncIterable<ILeapfrogChatStreamChunk> {
		const apiKey = await this.apiKeyService.getApiKey('anthropic');
		if (!apiKey) {
			throw new Error('Anthropic API key not configured. Please set it in settings.');
		}

		try {
			// Try to use native Anthropic SDK if available
			const Anthropic = await this.loadAnthropicSDK();
			if (Anthropic) {
				yield* this.streamAnthropicWithSDK(Anthropic, apiKey, messages, model, config, cancelToken);
			} else {
				// Fallback to HTTP streaming
				yield* this.streamAnthropicWithHTTP(apiKey, messages, model, config, cancelToken);
			}
		} catch (err) {
			this.logService.error('[Leapfrog] Anthropic streaming failed:', err);
			throw err;
		}
	}

	private async *streamAnthropicWithSDK(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		Anthropic: any,
		apiKey: string,
		messages: ILeapfrogChatMessage[],
		model: string,
		config?: ILeapfrogChatConfig,
		cancelToken?: CancellationToken,
	): AsyncIterable<ILeapfrogChatStreamChunk> {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const client = new (Anthropic as any)({ apiKey });

		// Convert system messages to separate parameter
		const systemMessages = messages.filter(m => m.role === 'system');
		const otherMessages = messages.filter(m => m.role !== 'system');
		const system = systemMessages.map(m => m.content).join('\n\n') || undefined;

		const stream = await client.messages.stream({
			model,
			max_tokens: config?.maxTokens ?? 2000,
			system,
			messages: otherMessages,
		});

		for await (const event of stream) {
			if (cancelToken?.isCancellationRequested) {
				break;
			}

			if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
				const content = event.delta.text ?? '';
				if (content) {
					yield { content, done: false };
				}
			}
		}

		yield { content: '', done: true };
	}

	private async *streamAnthropicWithHTTP(
		apiKey: string,
		messages: ILeapfrogChatMessage[],
		model: string,
		config?: ILeapfrogChatConfig,
		cancelToken?: CancellationToken,
	): AsyncIterable<ILeapfrogChatStreamChunk> {
		// Fallback HTTP implementation
		const controller = new AbortController();
		const cancelListener = cancelToken?.onCancellationRequested(() => controller.abort());

		try {
			// Extract system message
			const systemMessages = messages.filter(m => m.role === 'system');
			const otherMessages = messages.filter(m => m.role !== 'system');
			const system = systemMessages.map(m => m.content).join('\n\n') || undefined;

			const body: any = {
				model,
				max_tokens: config?.maxTokens ?? 2000,
				messages: otherMessages,
				stream: true,
			};

			if (system) {
				body.system = system;
			}

			const response = await fetch('https://api.anthropic.com/v1/messages', {
				method: 'POST',
				headers: {
					'x-api-key': apiKey,
					'anthropic-version': '2023-06-01',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(body),
				signal: controller.signal,
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Anthropic API error: ${response.status} ${errorText}`);
			}

			if (!response.body) {
				throw new Error('No response body from Anthropic');
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				const chunk = decoder.decode(value);
				const lines = chunk.split('\n');

				for (const line of lines) {
					if (line.startsWith('data: ')) {
						const data = line.slice(6);
						try {
							const parsed = JSON.parse(data);
							if (parsed.type === 'content_block_delta' && parsed.delta.type === 'text_delta') {
								const content = parsed.delta.text ?? '';
								if (content) {
									yield { content, done: false };
								}
							} else if (parsed.type === 'message_stop') {
								yield { content: '', done: true };
								return;
							}
						} catch {
							// Ignore JSON parse errors
						}
					}
				}
			}
		} finally {
			cancelListener?.dispose();
		}
	}

	// -----------------------------------------------------------------------
	// Model Info
	// -----------------------------------------------------------------------

	getAvailableModels(): ILeapfrogAIModel[] {
		return LEAPFROG_AVAILABLE_MODELS;
	}

	getDefaultModel(): ILeapfrogAIModel {
		const modelId = this.configService.getValue<string>(LeapfrogConfigurationKeys.DefaultModel) || 'gpt-4o';
		const model = LEAPFROG_AVAILABLE_MODELS.find(m => m.id === modelId);
		return model || LEAPFROG_AVAILABLE_MODELS[0];
	}

	// -----------------------------------------------------------------------
	// Utilities
	// -----------------------------------------------------------------------

	private async loadOpenAISDK(): Promise<any> {
		try {
			// Try dynamic import - will fail gracefully if not installed
			const module = await import('openai');
			return module.default;
		} catch {
			this.logService.debug('[Leapfrog] OpenAI SDK not available, will use HTTP fallback');
			return undefined;
		}
	}

	private async loadAnthropicSDK(): Promise<any> {
		try {
			// Try dynamic import - will fail gracefully if not installed
			const module = await import('@anthropic-ai/sdk');
			return module.default;
		} catch {
			this.logService.debug('[Leapfrog] Anthropic SDK not available, will use HTTP fallback');
			return undefined;
		}
	}
}
