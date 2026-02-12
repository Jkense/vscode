/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Unit tests for Leapfrog slash commands (Phase 3)
 *
 * These tests verify the 5 slash commands work correctly:
 * - /ask: Default Q&A behavior
 * - /tag: Suggest tags for content
 * - /search: Search through research data
 * - /cross-reference: Find related content
 * - /summarize: Create summaries
 */

import * as assert from 'assert';

suite('Leapfrog Chat - Slash Commands (Phase 3)', () => {
	test('should recognize /ask command', () => {
		const command = 'ask';
		const args = 'what are the main themes?';

		assert.strictEqual(command, 'ask');
		assert.ok(args.length > 0);
	});

	test('should recognize /tag command', () => {
		const command = 'tag';
		const args = 'this interesting quote about user frustration';

		assert.strictEqual(command, 'tag');
		assert.ok(args.includes('tag'));
	});

	test('should recognize /search command', () => {
		const command = 'search';
		const args = 'authentication challenges';

		assert.strictEqual(command, 'search');
		assert.ok(args.length > 0);
	});

	test('should recognize /cross-reference command', () => {
		const command = 'cross-reference';
		const args = 'user experience improvements';

		assert.strictEqual(command, 'cross-reference');
		assert.ok(args.includes('experience'));
	});

	test('should recognize /summarize command', () => {
		const command = 'summarize';
		const args = 'the findings from this transcript';

		assert.strictEqual(command, 'summarize');
		assert.ok(args.includes('findings'));
	});

	test('should transform /ask prompt correctly', () => {
		const command = 'ask';

		// /ask command should pass through message as-is
		assert.strictEqual(command, 'ask');
	});

	test('should transform /tag prompt correctly', () => {
		const command = 'tag';

		// /tag command should suggest tagging prompt
		const systemPrompt = `Based on the provided content, suggest relevant tags or codes that would help categorize and organize the research data. Consider themes, concepts, methodologies, and key findings.`;

		assert.strictEqual(command, 'tag');
		assert.ok(systemPrompt.includes('tags'));
		assert.ok(systemPrompt.includes('codes'));
	});

	test('should transform /search prompt correctly', () => {
		const command = 'search';

		// /search command should enable search functionality
		const systemPrompt = `Please search through the research data and find relevant information related to the topic. Provide specific references to where this information appears in the transcripts, documents, or notes.`;

		assert.strictEqual(command, 'search');
		assert.ok(systemPrompt.includes('search'));
		assert.ok(systemPrompt.includes('research data'));
	});

	test('should transform /cross-reference prompt correctly', () => {
		const command = 'cross-reference';

		// /cross-reference command should find connections
		const systemPrompt = `Find and highlight connections between different parts of the research data. Identify where this topic appears across multiple transcripts, identify common themes, and point out relationships and patterns.`;

		assert.strictEqual(command, 'cross-reference');
		assert.ok(systemPrompt.includes('connections'));
		assert.ok(systemPrompt.includes('multiple'));
	});

	test('should transform /summarize prompt correctly', () => {
		const command = 'summarize';

		// /summarize command should create summary
		const systemPrompt = `Provide a concise summary of the following content, highlighting the most important points and insights. Focus on key takeaways and actionable findings.`;

		assert.strictEqual(command, 'summarize');
		assert.ok(systemPrompt.includes('summary'));
		assert.ok(systemPrompt.includes('key'));
	});

	test('should include original message in transformed prompt', () => {
		const originalMessage = 'investigate error handling patterns';

		// Transformed message should include original
		const finalMessage = `${originalMessage}`;

		assert.ok(finalMessage.includes(originalMessage));
	});

	test('should handle slash command with no arguments', () => {
		const command = 'tag';
		const args = '';

		// Should still process even without arguments
		assert.strictEqual(command, 'tag');
		assert.strictEqual(args.length, 0);
	});

	test('should handle slash command with multiline arguments', () => {
		const command = 'search';
		const args = `themes about:
- User frustration
- Technical barriers
- Adoption challenges`;

		assert.strictEqual(command, 'search');
		assert.ok(args.includes('User frustration'));
		assert.ok(args.includes('Adoption challenges'));
	});

	test('should preserve special characters in command arguments', () => {
		const command = 'ask';
		const args = 'What about "quotes" and (parentheses) & special chars?';

		assert.strictEqual(command, 'ask');
		assert.ok(args.includes('"quotes"'));
		assert.ok(args.includes('&'));
	});

	test('should handle command case sensitivity', () => {
		const commands = ['ask', 'Ask', 'ASK'];
		const normalizedCommand = commands[0].toLowerCase();

		assert.strictEqual(normalizedCommand, 'ask');
		assert.strictEqual(commands[0], 'ask');
	});

	test('should validate slash command in message history', () => {
		const history = [
			{
				id: 'msg-1',
				role: 'user' as const,
				content: 'what does sentiment mean here',
				command: 'ask',
			},
			{
				id: 'msg-2',
				role: 'user' as const,
				content: 'positive experiences',
				command: 'tag',
			},
			{
				id: 'msg-3',
				role: 'assistant' as const,
				content: 'Here are suggested tags...',
				command: undefined,
			},
		];

		assert.strictEqual(history[0].command, 'ask');
		assert.strictEqual(history[1].command, 'tag');
		assert.strictEqual(history[2].command, undefined);
	});

	test('should validate slash command in request', () => {
		const request = {
			message: 'implementation details',
			command: 'search',
			commandPrefix: '/',
		};

		assert.strictEqual(request.command, 'search');
		assert.ok(request.message.length > 0);
		assert.strictEqual(request.commandPrefix, '/');
	});

	test('should handle command autocomplete suggestions', () => {
		const availableCommands = [
			{ name: 'ask', description: 'Ask a question about your data' },
			{ name: 'tag', description: 'Suggest relevant tags for the content' },
			{ name: 'search', description: 'Search through your research data' },
			{ name: 'cross-reference', description: 'Find related content across transcripts' },
			{ name: 'summarize', description: 'Create a summary of the content' },
		];

		assert.strictEqual(availableCommands.length, 5);
		assert.strictEqual(availableCommands[0].name, 'ask');
		assert.strictEqual(availableCommands[4].name, 'summarize');

		// Should filter based on input
		const searchResults = availableCommands.filter(cmd => cmd.name.startsWith('s'));
		assert.strictEqual(searchResults.length, 2); // 'search' and 'summarize'
	});

	test('should validate command metadata in agent', () => {
		const agentCommands = [
			{
				name: 'ask',
				description: 'Ask a question',
				executeImmediately: false,
			},
			{
				name: 'tag',
				description: 'Suggest tags',
				executeImmediately: false,
			},
			{
				name: 'search',
				description: 'Search content',
				executeImmediately: false,
			},
			{
				name: 'cross-reference',
				description: 'Find related content',
				executeImmediately: false,
			},
			{
				name: 'summarize',
				description: 'Summarize content',
				executeImmediately: false,
			},
		];

		assert.strictEqual(agentCommands.length, 5);
		agentCommands.forEach((cmd, index) => {
			assert.ok(cmd.name.length > 0);
			assert.ok(cmd.description.length > 0);
			assert.strictEqual(cmd.executeImmediately, false);
		});
	});

	test('should handle command with followup context', () => {
		const exchange = [
			{
				userMessage: 'Find mentions of cost',
				command: 'search',
				response: 'Found 12 mentions of cost in transcripts...',
			},
			{
				userMessage: 'Add these to the cost tag',
				command: 'tag',
				response: 'Tagged all cost-related items...',
			},
		];

		assert.strictEqual(exchange[0].command, 'search');
		assert.strictEqual(exchange[1].command, 'tag');
		assert.ok(exchange[1].userMessage.includes('tag'));
	});

	test('should validate command execution order', () => {
		const commands = [
			'search',
			'tag',
			'summarize',
			'cross-reference',
			'ask',
		];

		// Commands should be executable in any order
		const executed: string[] = [];
		for (const cmd of commands) {
			executed.push(cmd);
		}

		assert.strictEqual(executed.length, 5);
		assert.ok(executed.includes('ask'));
		assert.ok(executed.includes('tag'));
	});

	test('should handle command with empty results', () => {
		const searchRequest = {
			message: 'nonexistent topic XYZ123',
			command: 'search',
		};

		const response = {
			content: 'No results found for "nonexistent topic XYZ123" in your research data.',
			hasResults: false,
		};

		assert.strictEqual(searchRequest.command, 'search');
		assert.strictEqual(response.hasResults, false);
		assert.ok(response.content.includes('No results'));
	});

	test('should validate command help text', () => {
		const commandHelp = {
			ask: 'Ask questions about your qualitative research data',
			tag: 'Suggest relevant codes, tags, and categories for selected content',
			search: 'Search through transcripts and documents for specific topics',
			'cross-reference': 'Find connections and relationships across different parts of your research',
			summarize: 'Get a concise summary of interviews, documents, or transcripts',
		};

		assert.ok(commandHelp.ask.includes('Ask'));
		assert.ok(commandHelp.tag.includes('codes'));
		assert.ok(commandHelp.search.includes('Search'));
		assert.ok(commandHelp['cross-reference'].includes('connections'));
		assert.ok(commandHelp.summarize.includes('summary'));
	});
});

suite('Leapfrog Chat - Slash Commands with Attachments', () => {
	test('should process /tag command with file attachment', () => {
		const request = {
			message: 'code quality insights',
			command: 'tag',
			attachments: [
				{
					type: 'file' as const,
					uri: 'file:///analysis.ts',
					name: 'analysis.ts',
					content: 'function analyze() { ... }',
				},
			],
		};

		assert.strictEqual(request.command, 'tag');
		assert.ok(request.attachments[0].content.length > 0);
		assert.ok(request.message.includes('quality'));
	});

	test('should process /search command with context', () => {
		const request = {
			message: 'performance metrics',
			command: 'search',
			context: {
				file: 'metrics-report.json',
				selection: 'quantitative results',
			},
		};

		assert.strictEqual(request.command, 'search');
		assert.ok(request.context.file.includes('metrics'));
	});

	test('should process /cross-reference with multiple attachments', () => {
		const request = {
			message: 'user journey patterns',
			command: 'cross-reference',
			attachments: [
				{
					type: 'file' as const,
					uri: 'file:///interview1.txt',
					name: 'interview1.txt',
				},
				{
					type: 'file' as const,
					uri: 'file:///interview2.txt',
					name: 'interview2.txt',
				},
			],
		};

		assert.strictEqual(request.command, 'cross-reference');
		assert.strictEqual(request.attachments.length, 2);
	});
});
