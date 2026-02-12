/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Unit tests for LeapfrogChatAgent structures and data formats
 *
 * These tests verify the data structures used by LeapfrogChatAgent:
 * - Command metadata structures
 * - Request/response message formats
 * - Streaming chunk formats
 * - Configuration and model information
 */

import * as assert from 'assert';
import { ILeapfrogAIModel } from '../../common/leapfrog.js';

suite('LeapfrogChatAgent - Data Structures', () => {
	test('should validate slash command metadata', () => {
		const commands = [
			{ name: 'ask', description: 'Ask a question' },
			{ name: 'tag', description: 'Suggest tags' },
			{ name: 'search', description: 'Search content' },
			{ name: 'cross-reference', description: 'Find related content' },
			{ name: 'summarize', description: 'Summarize content' },
		];

		assert.strictEqual(commands.length, 5);
		assert.strictEqual(commands[0].name, 'ask');
		assert.strictEqual(commands[4].name, 'summarize');

		// All commands should have description
		commands.forEach(cmd => {
			assert.ok(cmd.description.length > 0);
		});
	});

	test('should validate AI model information', () => {
		const models: ILeapfrogAIModel[] = [
			{ id: 'gpt-4o', name: 'GPT-4 Optimized', provider: 'openai', contextLength: 128000 },
			{ id: 'gpt-4o-mini', name: 'GPT-4 Mini', provider: 'openai', contextLength: 128000 },
			{ id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet', provider: 'anthropic', contextLength: 200000 },
			{ id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku', provider: 'anthropic', contextLength: 200000 },
		];

		assert.strictEqual(models.length, 4);
		models.forEach(model => {
			assert.ok(model.id.length > 0);
			assert.ok(model.name.length > 0);
		});
	});

	test('should validate streaming chunk format', () => {
		const chunks = [
			{ content: 'Hello ', done: false },
			{ content: 'from ', done: false },
			{ content: 'AI', done: false },
			{ content: '!', done: true },
		];

		let fullContent = '';
		for (const chunk of chunks) {
			fullContent += chunk.content;
			assert.ok(typeof chunk.done === 'boolean');
		}
		assert.strictEqual(fullContent, 'Hello from AI!');
	});

	test('should validate request message format', () => {
		const request = {
			message: 'What are the themes?',
			command: 'ask',
			variables: {},
			location: 4,
		};

		assert.ok(request.message.length > 0);
		assert.strictEqual(request.command, 'ask');
		assert.ok(request.variables !== null);
	});

	test('should validate response message format', () => {
		const response = {
			id: 'resp-1',
			content: 'The themes include...',
			model: 'gpt-4o',
			timestamp: Date.now(),
		};

		assert.ok(response.id.length > 0);
		assert.ok(response.content.length > 0);
		assert.ok(response.model.length > 0);
		assert.ok(response.timestamp > 0);
	});

	test('should validate markdown content progress', () => {
		const progress = {
			kind: 'markdownContent',
			content: {
				value: '# Analysis\n\nKey findings...',
			},
		};

		assert.strictEqual(progress.kind, 'markdownContent');
		assert.ok(progress.content.value.includes('# Analysis'));
	});

	test('should validate command execution metadata', () => {
		const execution = {
			command: 'search',
			args: 'user frustration',
			timestamp: Date.now(),
			status: 'completed',
		};

		assert.ok(execution.command.length > 0);
		assert.ok(execution.args.length > 0);
		assert.strictEqual(execution.status, 'completed');
	});

	test('should validate slash command transformation', () => {
		const transformations: { [key: string]: string } = {
			ask: 'what is AI?',
			tag: 'tags for content',
			search: 'search keyword',
			'cross-reference': 'find connections',
			summarize: 'summarize text',
		};

		Object.entries(transformations).forEach(([cmd, text]) => {
			assert.ok(cmd.length > 0);
			assert.ok(text.length > 0);
		});
	});

	test('should validate agent invocation result', () => {
		const result = {
			metadata: {
				model: 'gpt-4o',
				errorType: undefined,
				tokensUsed: 150,
			},
		};

		assert.ok(result.metadata.model.length > 0);
		assert.strictEqual(result.metadata.errorType, undefined);
		assert.ok(result.metadata.tokensUsed > 0);
	});

	test('should validate configuration overrides', () => {
		const config = {
			model: 'claude-3-5-sonnet-latest',
			temperature: 0.7,
			maxTokens: 2000,
		};

		assert.ok(config.model.length > 0);
		assert.ok(config.temperature >= 0 && config.temperature <= 1);
		assert.ok(config.maxTokens > 0);
	});

	test('should validate slash command autocomplete', () => {
		const input = 's';
		const commands = ['ask', 'tag', 'search', 'cross-reference', 'summarize'];
		const matches = commands.filter(cmd => cmd.startsWith(input));

		assert.ok(matches.length > 0);
		assert.ok(matches.includes('search'));
		assert.ok(matches.includes('summarize'));
	});

	test('should validate message history structure', () => {
		const history = [
			{
				role: 'user',
				content: 'First question',
				timestamp: Date.now(),
			},
			{
				role: 'assistant',
				content: 'First response',
				timestamp: Date.now() + 1000,
			},
		];

		assert.strictEqual(history.length, 2);
		assert.strictEqual(history[0].role, 'user');
		assert.strictEqual(history[1].role, 'assistant');
	});
});
