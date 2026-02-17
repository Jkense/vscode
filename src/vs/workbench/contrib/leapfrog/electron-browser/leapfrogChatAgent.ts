/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Leapfrog Chat Agent Implementation
 *
 * Implements IChatAgentImplementation to connect ILeapfrogAIService to VS Code's agent system.
 * This agent handles slash commands, message streaming, and attachments.
 *
 * Key responsibilities:
 * - Implement IChatAgentImplementation interface
 * - Convert IChatAgentRequest → ILeapfrogChatMessage[]
 * - Stream responses from ILeapfrogAIService
 * - Report progress as markdown chunks to ChatWidget
 * - Handle slash commands (/ask, /tag, /search, /cross-reference, /summarize)
 */

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';

import {
	ILeapfrogAIService,
	ILeapfrogChatConfig,
	ILeapfrogIndexService,
	LEAPFROG_AVAILABLE_MODELS,
} from '../common/leapfrog.js';
import { LeapfrogConfigurationKeys } from '../common/leapfrogConfiguration.js';

import {
	IChatAgentImplementation,
	IChatAgentRequest,
	IChatAgentResult,
	IChatAgentHistoryEntry,
} from '../../../../workbench/contrib/chat/common/participants/chatAgents.js';

import {
	IChatProgress,
} from '../../../../workbench/contrib/chat/common/chatService/chatService.js';

/**
 * Slash command processor for transforming user input based on command
 */
interface ISlashCommandProcessor {
	name: string;
	description: string;
	process(args: string, context: ICommandContext): string;
}

interface ICommandContext {
	// Could include context like selected text, current file, etc.
	selectedText?: string;
}

/**
 * Leapfrog Chat Agent - integrates AI service with VS Code's chat system
 */
export class LeapfrogChatAgent extends Disposable implements IChatAgentImplementation {

	private readonly _slashCommands: ISlashCommandProcessor[] = [
		{
			name: 'ask',
			description: 'Ask a question about your research data',
			process: (args) => args || 'Ask a question about your research.',
		},
		{
			name: 'tag',
			description: 'Suggest tags for selected text or attachments',
			process: (args) => {
				let prompt = 'Please suggest relevant tags/codes for the following text. Consider themes, patterns, and categories that would help organize qualitative research data.';
				if (args) {
					prompt += `\n\nFocus: ${args}`;
				}
				return prompt;
			},
		},
		{
			name: 'search',
			description: 'Search through your project files for relevant content',
			process: (args) => {
				let prompt = 'Search through my research data for content related to: ';
				if (args) {
					prompt += args;
				} else {
					prompt += 'themes and patterns.';
				}
				prompt += '\n\nReturn the most relevant findings with context.';
				return prompt;
			},
		},
		{
			name: 'cross-reference',
			description: 'Find related content across transcripts',
			process: (args) => {
				let prompt = 'Find related and cross-referenced content across my transcripts';
				if (args) {
					prompt += ` related to: ${args}`;
				}
				prompt += '. Identify connections, patterns, and recurring themes.';
				return prompt;
			},
		},
		{
			name: 'summarize',
			description: 'Generate a summary of selected content',
			process: (args) => {
				let prompt = 'Please provide a concise summary of the provided research data';
				if (args) {
					prompt += ` focusing on: ${args}`;
				}
				prompt += '.';
				return prompt;
			},
		},
	];

	constructor(
		@ILeapfrogAIService private readonly aiService: ILeapfrogAIService,
		@ILeapfrogIndexService private readonly indexService: ILeapfrogIndexService,
		@IConfigurationService private readonly configService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.logService.info('[Leapfrog] Chat Agent initialized');
	}

	// -----------------------------------------------------------------------
	// Main Agent Implementation
	// -----------------------------------------------------------------------

	async invoke(
		request: IChatAgentRequest,
		progress: (parts: IChatProgress[]) => void,
		history: IChatAgentHistoryEntry[],
		token: CancellationToken
	): Promise<IChatAgentResult> {

		// Validate request
		if (!request) {
			this.logService.error('[Leapfrog] Invalid request: request is null or undefined');
			progress([
				{
					kind: 'markdownContent',
					content: new MarkdownString('Error: Invalid request'),
				}
			]);
			return { metadata: { errorType: 'validation' } };
		}

		try {
			// Process slash command if present
			let userMessage = '';
			try {
				userMessage = typeof request.message === 'string' ? request.message : (request.message as unknown as { text: string }).text || String(request.message);
				if (!userMessage || userMessage.trim().length === 0) {
					throw new Error('Empty message');
				}
			} catch (err) {
				this.logService.error('[Leapfrog] Error extracting message:', err);
				progress([
					{
						kind: 'markdownContent',
						content: new MarkdownString('Error: Could not process your message. Please try again.'),
					}
				]);
				return { metadata: { errorType: 'validation' } };
			}

			let processedMessage = this.processSlashCommand(request.command, userMessage);

			// Enrich /search and /cross-reference commands with index results
			if (request.command === 'search' || request.command === 'cross-reference') {
				const searchQuery = userMessage.replace(/^\/\w+\s*/, '').trim() || userMessage;
				processedMessage = await this.enrichWithSearchResults(searchQuery, processedMessage);
			}

			// Convert request and history to Leapfrog message format
			let messages;
			try {
				messages = this.convertToLeapfrogMessages(processedMessage, history);
				if (!messages || messages.length === 0) {
					throw new Error('Failed to convert messages to proper format');
				}
			} catch (conversionErr) {
				this.logService.error('[Leapfrog] Message conversion error:', conversionErr);
				progress([
					{
						kind: 'markdownContent',
						content: new MarkdownString('Error: Could not process message history. Please try again.'),
					}
				]);
				return { metadata: { errorType: 'conversion' } };
			}

			// Get configured model
			let model;
			try {
				model = this.getConfiguredModel();
				if (!model) {
					throw new Error('No model selected');
				}
			} catch (modelErr) {
				this.logService.error('[Leapfrog] Model selection error:', modelErr);
				progress([
					{
						kind: 'markdownContent',
						content: new MarkdownString('Error: Could not select AI model. Please check your Leapfrog settings.'),
					}
				]);
				return { metadata: { errorType: 'modelselection' } };
			}
			const config: ILeapfrogChatConfig = { model };

			// Stream response from AI service
			let fullContent = '';

			try {
				for await (const chunk of this.aiService.stream(messages, config, token)) {
					if (token.isCancellationRequested) {
						break;
					}

					fullContent += chunk.content;

					// Report progress with markdown content
					progress([
						{
							kind: 'markdownContent',
							content: new MarkdownString(fullContent),
						}
					]);
				}
			} catch (err) {
				this.logService.error('[Leapfrog] Streaming error:', err);

				// Report error in progress
				const errorMessage = err instanceof Error ? err.message : 'Unknown error';
				progress([
					{
						kind: 'markdownContent',
						content: new MarkdownString(`Error: ${errorMessage}`),
					}
				]);
				return {
					metadata: { errorType: 'streaming' },
				};
			}

			// Return completed response metadata
			return {
				metadata: { model },
			};

		} catch (err) {
			this.logService.error('[Leapfrog] Chat agent error:', err);

			// Determine specific error type for better user feedback
			let errorMessage = 'An unexpected error occurred';
			let errorType = 'agent';

			if (err instanceof Error) {
				const message = err.message.toLowerCase();

				// Network errors
				if (message.includes('network') || message.includes('timeout')) {
					errorMessage = 'Network error: Unable to reach the AI service. Please check your connection and try again.';
					errorType = 'network';
				}
				// Authentication errors
				else if (message.includes('auth') || message.includes('401') || message.includes('403')) {
					errorMessage = 'Authentication error: Please check your API key configuration in settings.';
					errorType = 'auth';
				}
				// Rate limiting
				else if (message.includes('429') || message.includes('rate')) {
					errorMessage = 'Rate limit exceeded: Please wait a moment and try again.';
					errorType = 'ratelimit';
				}
				// Invalid configuration
				else if (message.includes('model') || message.includes('config')) {
					errorMessage = 'Configuration error: Please check your Leapfrog settings and try again.';
					errorType = 'config';
				}
				// Use original message if specific
				else {
					errorMessage = err.message;
				}
			}

			progress([
				{
					kind: 'markdownContent',
					content: new MarkdownString(`**Error:** ${errorMessage}`),
				}
			]);

			return {
				metadata: { errorType },
			};
		}
	}

	// -----------------------------------------------------------------------
	// Slash Command Processing
	// -----------------------------------------------------------------------

	private processSlashCommand(command: string | undefined, message: string): string {
		if (!command) {
			return message;
		}

		// Find the processor for this command
		const processor = this._slashCommands.find(c => c.name === command);
		if (!processor) {
			this.logService.warn(`[Leapfrog] Unknown slash command: /${command}`);
			return message;
		}

		// Extract arguments (everything after the first space)
		const match = message.match(/^\/\w+\s*(.*)?$/);
		const args = match ? match[1] || '' : '';

		// Process the command
		return processor.process(args, {});
	}

	// -----------------------------------------------------------------------
	// Message Conversion
	// -----------------------------------------------------------------------

	private convertToLeapfrogMessages(
		currentMessage: string,
		history: IChatAgentHistoryEntry[]
	): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {

		const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

		// Add system message (optional, can be enhanced with project context)
		messages.push({
			role: 'system',
			content: this.getSystemPrompt(),
		});

		// Convert history to messages
		for (const entry of history) {
			if (entry.request && entry.request.message) {
				const requestText = typeof entry.request.message === 'string'
					? entry.request.message
					: (entry.request.message as unknown as { text: string }).text || String(entry.request.message);

				messages.push({
					role: 'user',
					content: requestText,
				});
			}

			// Add assistant response if present
			if (entry.response) {
				const responseText = this.extractResponseText(entry.response);
				if (responseText) {
					messages.push({
						role: 'assistant',
						content: responseText,
					});
				}
			}
		}

		// Add current user message
		messages.push({
			role: 'user',
			content: currentMessage,
		});

		return messages;
	}

	private extractResponseText(response: IChatAgentHistoryEntry['response']): string {
		if (!response) {
			return '';
		}

		// Extract markdown content from response parts
		let text = '';

		if (Array.isArray(response)) {
			for (const part of response) {
				if (part && typeof part === 'object') {
					const obj = part as Record<string, unknown>;
					if (obj.content) {
						text += obj.content.toString() + '\n';
					}
				}
			}
		}

		return text.trim();
	}

	// -----------------------------------------------------------------------
	// Configuration & Context
	// -----------------------------------------------------------------------

	/**
	 * Enrich a prompt with semantic search results from the index.
	 */
	private async enrichWithSearchResults(query: string, originalPrompt: string): Promise<string> {
		if (!this.indexService.isReady()) {
			return originalPrompt;
		}

		try {
			const results = await this.indexService.search(query, { limit: 5, minScore: 0.3 });
			if (results.length === 0) {
				return originalPrompt;
			}

			let context = 'Here are relevant excerpts from the research project:\n\n';
			for (const r of results) {
				const source = r.chunk.filePath.split(/[/\\]/).pop() ?? r.chunk.filePath;
				context += `--- ${source} (relevance: ${(r.score * 100).toFixed(0)}%) ---\n`;
				if (r.chunk.headingPath) {
					context += `Section: ${r.chunk.headingPath}\n`;
				}
				if (r.chunk.speaker) {
					context += `Speaker: ${r.chunk.speaker}\n`;
				}
				context += r.chunk.content.trim() + '\n\n';
			}

			return context + '\n' + originalPrompt;
		} catch (err) {
			this.logService.warn('[Leapfrog] Search enrichment failed:', err);
			return originalPrompt;
		}
	}

	private getSystemPrompt(): string {
		return `You are Leapfrog, an AI assistant specialized in helping with qualitative research analysis.
You help researchers:
- Analyze interview transcripts and research data
- Identify themes, patterns, and insights
- Suggest codes and tags for organizing research data
- Find connections across different sources
- Generate summaries and synthesize findings

Always be thoughtful about the research context and provide evidence-based insights.`;
	}

	private getConfiguredModel(): string {
		try {
			const configuredModel = this.configService.getValue<string>(LeapfrogConfigurationKeys.ChatDefaultModel);
			if (configuredModel) {
				// Verify it's a valid model
				const isValid = LEAPFROG_AVAILABLE_MODELS.some(m => m.id === configuredModel);
				if (isValid) {
					return configuredModel;
				}
			}
		} catch (err) {
			this.logService.debug('[Leapfrog] Error reading model configuration:', err);
		}

		// Fall back to default model
		return this.aiService.getDefaultModel().id;
	}

	// -----------------------------------------------------------------------
	// Public Helper Methods (for testing/debugging)
	// -----------------------------------------------------------------------

	getSlashCommands(): Array<{ name: string; description: string }> {
		return this._slashCommands.map(c => ({
			name: c.name,
			description: c.description,
		}));
	}

	processCommand(command: string, args: string): string {
		const processor = this._slashCommands.find(c => c.name === command);
		if (!processor) {
			throw new Error(`Unknown command: ${command}`);
		}

		return processor.process(args, {});
	}
}
