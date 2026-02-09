/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { LeapfrogAIService } from '../../electron-browser/leapfrogAIService.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ILeapfrogApiKeyService, LEAPFROG_AVAILABLE_MODELS } from '../../common/leapfrog.js';
import { LeapfrogConfigurationKeys } from '../../common/leapfrogConfiguration.js';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

class MockApiKeyService implements Partial<ILeapfrogApiKeyService> {
	declare readonly _serviceBrand: undefined;

	private keys = new Map<string, string>();

	async setApiKey(provider: 'openai' | 'anthropic', key: string): Promise<void> {
		this.keys.set(provider, key);
	}

	async getApiKey(provider: 'openai' | 'anthropic'): Promise<string | undefined> {
		return this.keys.get(provider);
	}

	async deleteApiKey(provider: 'openai' | 'anthropic'): Promise<void> {
		this.keys.delete(provider);
	}

	async hasApiKey(provider: 'openai' | 'anthropic'): Promise<boolean> {
		return this.keys.has(provider);
	}

	/** Helper – seed a key for testing */
	seed(provider: 'openai' | 'anthropic', key: string): void {
		this.keys.set(provider, key);
	}
}

class MockConfigurationService {
	private values = new Map<string, unknown>();

	getValue<T>(key: string): T | undefined {
		return this.values.get(key) as T | undefined;
	}

	setValue(key: string, value: unknown): void {
		this.values.set(key, value);
	}

	// Stub remaining IConfigurationService methods used by the service
	updateValue(): Promise<void> { return Promise.resolve(); }
	inspect() { return undefined; }
	keys() { return { default: [], user: [], workspace: [], workspaceFolder: [] }; }
	onDidChangeConfiguration = () => ({ dispose: () => { } });
}

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

function createSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	let index = 0;
	return new ReadableStream({
		pull(controller) {
			if (index < chunks.length) {
				controller.enqueue(encoder.encode(chunks[index]));
				index++;
			} else {
				controller.close();
			}
		},
	});
}

function mockFetchResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

function mockFetchStreamResponse(chunks: string[], status = 200): Response {
	return new Response(createSSEStream(chunks), {
		status,
		headers: { 'Content-Type': 'text/event-stream' },
	});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

suite('LeapfrogAIService', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	let service: LeapfrogAIService;
	let apiKeyService: MockApiKeyService;
	let configService: MockConfigurationService;
	let originalFetch: typeof globalThis.fetch;

	setup(() => {
		apiKeyService = new MockApiKeyService();
		configService = new MockConfigurationService();

		configService.setValue(LeapfrogConfigurationKeys.DefaultModel, 'gpt-4o');
		configService.setValue(LeapfrogConfigurationKeys.Temperature, 0.7);
		configService.setValue(LeapfrogConfigurationKeys.MaxTokens, 4096);

		service = store.add(new LeapfrogAIService(
			apiKeyService as unknown as ILeapfrogApiKeyService,
			new NullLogService() as unknown as ILogService,
			configService as unknown as IConfigurationService,
		));

		// Save original fetch
		originalFetch = globalThis.fetch;
	});

	teardown(() => {
		// Restore original fetch
		globalThis.fetch = originalFetch;
	});

	// -----------------------------------------------------------------------
	// Model info
	// -----------------------------------------------------------------------

	test('getAvailableModels returns all models', () => {
		const models = service.getAvailableModels();
		assert.strictEqual(models.length, LEAPFROG_AVAILABLE_MODELS.length);
		assert.strictEqual(models[0].id, 'gpt-4o');
	});

	test('getDefaultModel returns configured default', () => {
		configService.setValue(LeapfrogConfigurationKeys.DefaultModel, 'claude-3-5-sonnet-latest');
		const model = service.getDefaultModel();
		assert.strictEqual(model.id, 'claude-3-5-sonnet-latest');
		assert.strictEqual(model.provider, 'anthropic');
	});

	test('getDefaultModel falls back to gpt-4o if unconfigured', () => {
		configService.setValue(LeapfrogConfigurationKeys.DefaultModel, undefined);
		const model = service.getDefaultModel();
		assert.strictEqual(model.id, 'gpt-4o');
	});

	// -----------------------------------------------------------------------
	// API key validation
	// -----------------------------------------------------------------------

	test('chat throws when no API key is set for openai', async () => {
		await assert.rejects(
			() => service.chat([{ role: 'user', content: 'hello' }], { model: 'gpt-4o' }),
			(err: Error) => err.message.includes('API key not configured'),
		);
	});

	test('chat throws when no API key is set for anthropic', async () => {
		await assert.rejects(
			() => service.chat([{ role: 'user', content: 'hello' }], { model: 'claude-3-5-sonnet-latest' }),
			(err: Error) => err.message.includes('API key not configured'),
		);
	});

	test('chat throws for unknown model', async () => {
		apiKeyService.seed('openai', 'sk-test');
		await assert.rejects(
			() => service.chat([{ role: 'user', content: 'hello' }], { model: 'nonexistent-model' }),
			(err: Error) => err.message.includes('Unknown model'),
		);
	});

	// -----------------------------------------------------------------------
	// Provider routing
	// -----------------------------------------------------------------------

	test('routes gpt-4o to openai', async () => {
		apiKeyService.seed('openai', 'sk-test');

		let calledUrl = '';
		globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
			calledUrl = typeof input === 'string' ? input : input.toString();
			return mockFetchResponse({
				id: 'chatcmpl-1',
				model: 'gpt-4o',
				choices: [{ message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }],
				usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
			});
		};

		await service.chat([{ role: 'user', content: 'hello' }], { model: 'gpt-4o' });
		assert.ok(calledUrl.includes('api.openai.com'));
	});

	test('routes claude-3-5-sonnet-latest to anthropic', async () => {
		apiKeyService.seed('anthropic', 'sk-ant-test');

		let calledUrl = '';
		globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
			calledUrl = typeof input === 'string' ? input : input.toString();
			return mockFetchResponse({
				id: 'msg_1',
				model: 'claude-3-5-sonnet-latest',
				content: [{ type: 'text', text: 'Hello!' }],
				usage: { input_tokens: 5, output_tokens: 2 },
			});
		};

		await service.chat([{ role: 'user', content: 'hello' }], { model: 'claude-3-5-sonnet-latest' });
		assert.ok(calledUrl.includes('api.anthropic.com'));
	});

	// -----------------------------------------------------------------------
	// OpenAI chat
	// -----------------------------------------------------------------------

	test('chat returns OpenAI response content', async () => {
		apiKeyService.seed('openai', 'sk-test');

		globalThis.fetch = async () => mockFetchResponse({
			id: 'chatcmpl-1',
			model: 'gpt-4o',
			choices: [{ message: { role: 'assistant', content: 'Hello from GPT!' }, finish_reason: 'stop' }],
			usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
		});

		const result = await service.chat([{ role: 'user', content: 'hi' }], { model: 'gpt-4o' });
		assert.strictEqual(result.content, 'Hello from GPT!');
		assert.strictEqual(result.model, 'gpt-4o');
		assert.strictEqual(result.usage?.totalTokens, 15);
	});

	test('chat handles OpenAI API errors', async () => {
		apiKeyService.seed('openai', 'sk-test');

		globalThis.fetch = async () => new Response('Rate limit exceeded', { status: 429 });

		await assert.rejects(
			() => service.chat([{ role: 'user', content: 'hi' }], { model: 'gpt-4o' }),
			(err: Error) => err.message.includes('429'),
		);
	});

	// -----------------------------------------------------------------------
	// Anthropic chat
	// -----------------------------------------------------------------------

	test('chat returns Anthropic response content', async () => {
		apiKeyService.seed('anthropic', 'sk-ant-test');

		globalThis.fetch = async () => mockFetchResponse({
			id: 'msg_1',
			model: 'claude-3-5-sonnet-latest',
			content: [{ type: 'text', text: 'Hello from Claude!' }],
			usage: { input_tokens: 10, output_tokens: 5 },
		});

		const result = await service.chat([{ role: 'user', content: 'hi' }], { model: 'claude-3-5-sonnet-latest' });
		assert.strictEqual(result.content, 'Hello from Claude!');
		assert.strictEqual(result.model, 'claude-3-5-sonnet-latest');
		assert.strictEqual(result.usage?.totalTokens, 15);
	});

	test('chat sends system messages separately for Anthropic', async () => {
		apiKeyService.seed('anthropic', 'sk-ant-test');

		let sentBody: Record<string, unknown> = {};
		globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
			sentBody = JSON.parse(init?.body as string);
			return mockFetchResponse({
				id: 'msg_1',
				model: 'claude-3-5-sonnet-latest',
				content: [{ type: 'text', text: 'Response' }],
				usage: { input_tokens: 10, output_tokens: 5 },
			});
		};

		await service.chat(
			[
				{ role: 'system', content: 'You are helpful.' },
				{ role: 'user', content: 'hi' },
			],
			{ model: 'claude-3-5-sonnet-latest' },
		);

		assert.strictEqual(sentBody.system, 'You are helpful.');
		const messages = sentBody.messages as Array<{ role: string }>;
		assert.ok(!messages.some(m => m.role === 'system'), 'System messages should not be in the messages array');
	});

	// -----------------------------------------------------------------------
	// OpenAI streaming
	// -----------------------------------------------------------------------

	test('stream parses OpenAI SSE format', async () => {
		apiKeyService.seed('openai', 'sk-test');

		const sseChunks = [
			'data: {"id":"c1","choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
			'data: {"id":"c1","choices":[{"delta":{"content":" world"},"finish_reason":null}]}\n\n',
			'data: [DONE]\n\n',
		];

		globalThis.fetch = async () => mockFetchStreamResponse(sseChunks);

		const chunks: { content: string; done: boolean }[] = [];
		for await (const chunk of service.stream([{ role: 'user', content: 'hi' }], { model: 'gpt-4o' })) {
			chunks.push(chunk);
		}

		assert.ok(chunks.length >= 2, 'Should have at least 2 content chunks');
		assert.strictEqual(chunks[0].content, 'Hello');
		assert.strictEqual(chunks[0].done, false);
		assert.strictEqual(chunks[1].content, ' world');
		assert.strictEqual(chunks[1].done, false);

		// Last chunk should be done
		const lastChunk = chunks[chunks.length - 1];
		assert.strictEqual(lastChunk.done, true);
	});

	// -----------------------------------------------------------------------
	// Anthropic streaming
	// -----------------------------------------------------------------------

	test('stream parses Anthropic SSE format', async () => {
		apiKeyService.seed('anthropic', 'sk-ant-test');

		const sseChunks = [
			'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","model":"claude-3-5-sonnet-latest"}}\n\n',
			'event: content_block_start\ndata: {"type":"content_block_start","index":0}\n\n',
			'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
			'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" from Claude"}}\n\n',
			'event: message_stop\ndata: {"type":"message_stop"}\n\n',
		];

		globalThis.fetch = async () => mockFetchStreamResponse(sseChunks);

		const chunks: { content: string; done: boolean }[] = [];
		for await (const chunk of service.stream([{ role: 'user', content: 'hi' }], { model: 'claude-3-5-sonnet-latest' })) {
			chunks.push(chunk);
		}

		assert.ok(chunks.length >= 2, 'Should have at least 2 content chunks');
		assert.strictEqual(chunks[0].content, 'Hello');
		assert.strictEqual(chunks[0].done, false);
		assert.strictEqual(chunks[1].content, ' from Claude');
		assert.strictEqual(chunks[1].done, false);

		// Last chunk should be done
		const lastChunk = chunks[chunks.length - 1];
		assert.strictEqual(lastChunk.done, true);
	});

	// -----------------------------------------------------------------------
	// Error handling
	// -----------------------------------------------------------------------

	test('stream handles network errors', async () => {
		apiKeyService.seed('openai', 'sk-test');

		globalThis.fetch = async () => { throw new Error('Network error'); };

		await assert.rejects(
			async () => {
				const chunks = [];
				for await (const chunk of service.stream([{ role: 'user', content: 'hi' }], { model: 'gpt-4o' })) {
					chunks.push(chunk);
				}
			},
			(err: Error) => err.message.includes('Network error'),
		);
	});

	test('stream handles HTTP errors', async () => {
		apiKeyService.seed('openai', 'sk-test');

		globalThis.fetch = async () => new Response('Invalid API key', { status: 401 });

		await assert.rejects(
			async () => {
				const chunks = [];
				for await (const chunk of service.stream([{ role: 'user', content: 'hi' }], { model: 'gpt-4o' })) {
					chunks.push(chunk);
				}
			},
			(err: Error) => err.message.includes('401'),
		);
	});

	// -----------------------------------------------------------------------
	// Configuration integration
	// -----------------------------------------------------------------------

	test('uses configured temperature and maxTokens', async () => {
		apiKeyService.seed('openai', 'sk-test');
		configService.setValue(LeapfrogConfigurationKeys.Temperature, 0.2);
		configService.setValue(LeapfrogConfigurationKeys.MaxTokens, 2048);

		let sentBody: Record<string, unknown> = {};
		globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
			sentBody = JSON.parse(init?.body as string);
			return mockFetchResponse({
				id: 'chatcmpl-1',
				model: 'gpt-4o',
				choices: [{ message: { role: 'assistant', content: 'Ok' }, finish_reason: 'stop' }],
				usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
			});
		};

		await service.chat([{ role: 'user', content: 'hi' }], { model: 'gpt-4o' });

		assert.strictEqual(sentBody.temperature, 0.2);
		assert.strictEqual(sentBody.max_tokens, 2048);
	});

	test('config overrides take precedence over settings', async () => {
		apiKeyService.seed('openai', 'sk-test');
		configService.setValue(LeapfrogConfigurationKeys.Temperature, 0.7);
		configService.setValue(LeapfrogConfigurationKeys.MaxTokens, 4096);

		let sentBody: Record<string, unknown> = {};
		globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
			sentBody = JSON.parse(init?.body as string);
			return mockFetchResponse({
				id: 'chatcmpl-1',
				model: 'gpt-4o',
				choices: [{ message: { role: 'assistant', content: 'Ok' }, finish_reason: 'stop' }],
				usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
			});
		};

		await service.chat(
			[{ role: 'user', content: 'hi' }],
			{ model: 'gpt-4o', temperature: 0.1, maxTokens: 512 },
		);

		assert.strictEqual(sentBody.temperature, 0.1);
		assert.strictEqual(sentBody.max_tokens, 512);
	});
});
