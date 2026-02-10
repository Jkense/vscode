/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../../nls.js';
import { IViewletViewOptions } from '../../../../browser/parts/views/viewsViewlet.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ViewPane, IViewPaneOptions } from '../../../../browser/parts/views/viewPane.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../../common/views.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { ILocalizedString } from '../../../../../platform/action/common/action.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { $, append, isHTMLElement } from '../../../../../base/browser/dom.js';
import { ILeapfrogChatHistoryService, LEAPFROG_AVAILABLE_MODELS, ILeapfrogChatMessageData, ILeapfrogChatMessage, ILeapfrogChatAttachment, ILeapfrogAIService } from '../../common/leapfrog.js';
import { LeapfrogConfigurationKeys } from '../../common/leapfrogConfiguration.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { toErrorMessage } from '../../../../../base/common/errorMessage.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';

interface ChatMessageElement {
	role: 'user' | 'assistant' | 'system';
	content: string;
	element: HTMLElement;
}

interface ISlashCommand {
	name: string;
	description: string;
	handler: (args: string, context: ISlashCommandContext) => Promise<string>;
}

interface ISlashCommandContext {
	attachments: ILeapfrogChatAttachment[];
}

// Define available slash commands
const SLASH_COMMANDS: ISlashCommand[] = [
	{
		name: 'ask',
		description: 'Ask a question about your research data',
		handler: async (args, ctx) => args || 'Ask a question about your research.',
	},
	{
		name: 'tag',
		description: 'Suggest tags for selected text or attachments',
		handler: async (args, ctx) => {
			let prompt = 'Please suggest relevant tags/codes for the following text. Consider themes, patterns, and categories that would help organize qualitative research data.';
			if (ctx.attachments.length > 0) {
				prompt += '\n\nAlso suggest tags that could apply across the entire attached file(s).';
			}
			if (args) {
				prompt += `\n\nFocus: ${args}`;
			}
			return prompt;
		},
	},
	{
		name: 'search',
		description: 'Search through your project files for relevant content',
		handler: async (args, ctx) => {
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
		handler: async (args, ctx) => {
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
		handler: async (args, ctx) => {
			let prompt = 'Please provide a concise summary of the provided research data';
			if (args) {
				prompt += ` focusing on: ${args}`;
			}
			prompt += '.';
			return prompt;
		},
	},
];

export class LeapfrogChatView extends ViewPane {

	static readonly ID: string = 'workbench.panel.chat.view';
	static readonly NAME: ILocalizedString = nls.localize2('chat', "Chat");

	// DOM elements
	private messagesContainer: HTMLElement | undefined;
	private inputContainer: HTMLElement | undefined;
	private inputTextarea: HTMLTextAreaElement | undefined;
	private modelSelector: HTMLSelectElement | undefined;
	private sessionSelector: HTMLSelectElement | undefined;
	private welcomeElement: HTMLElement | undefined;
	private stopButton: HTMLElement | undefined;
	private newChatButton: HTMLElement | undefined;

	// State
	private messages: ChatMessageElement[] = [];
	private isProcessing = false;
	private currentSessionId: string | undefined;
	private currentStreamCancel: CancellationTokenSource | undefined;
	private attachments: ILeapfrogChatAttachment[] = [];
	private attachmentContainer: HTMLElement | undefined;

	constructor(
		options: IViewletViewOptions,
		@IThemeService themeService: IThemeService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IOpenerService openerService: IOpenerService,
		@IHoverService hoverService: IHoverService,
		@ILeapfrogChatHistoryService private readonly chatHistoryService: ILeapfrogChatHistoryService,
		@ILeapfrogAIService private readonly aiService: ILeapfrogAIService,
		@ILogService private readonly logService: ILogService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@IFileService private readonly fileService: IFileService,
	) {
		super(options as IViewPaneOptions, keybindingService, contextMenuService, _configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);

		// Listen for session changes
		this._register(this.chatHistoryService.onDidChangeSessions(() => {
			this.refreshSessionSelector();
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		container.classList.add('leapfrog-chat-view');

		// Header with session selector and model selector
		const header = append(container, $('.leapfrog-chat-header'));
		this.renderSessionSelector(header);
		this.renderModelSelector(header);

		// Messages container
		this.messagesContainer = append(container, $('.leapfrog-chat-messages'));

		// Show welcome message
		this.renderWelcomeMessage();

		// Input container
		this.inputContainer = append(container, $('.leapfrog-chat-input-container'));
		this.renderInputArea();

		// Load or create a session on initial render
		this.loadOrCreateSession();
	}

	// -----------------------------------------------------------------------
	// Session Management
	// -----------------------------------------------------------------------

	private async loadOrCreateSession(): Promise<void> {
		try {
			const sessions = await this.chatHistoryService.getSessions();

			if (sessions.length > 0) {
				// Load the most recent session
				this.currentSessionId = sessions[0].id;
			} else {
				// Create a new session
				const newSession = await this.chatHistoryService.createSession();
				this.currentSessionId = newSession.id;
			}

			await this.loadSessionMessages();
			this.refreshSessionSelector();
		} catch (err) {
			this.logService.error('[Leapfrog] Failed to load or create session', err);
		}
	}

	private async loadSessionMessages(): Promise<void> {
		if (!this.currentSessionId) {
			return;
		}

		try {
			const session = await this.chatHistoryService.getSession(this.currentSessionId);
			if (!session) {
				return;
			}

			// Clear current messages
			this.messages = [];
			if (this.messagesContainer) {
				while (this.messagesContainer.firstChild) {
					this.messagesContainer.removeChild(this.messagesContainer.firstChild);
				}
			}

			// Load messages from session
			if (session.messages.length === 0) {
				this.renderWelcomeMessage();
			} else {
				if (this.welcomeElement) {
					this.welcomeElement.remove();
					this.welcomeElement = undefined;
				}

				for (const msg of session.messages) {
					this.addMessage(msg.role, msg.content);
				}
			}
		} catch (err) {
			this.logService.error('[Leapfrog] Failed to load session messages', err);
		}
	}

	private async switchSession(sessionId: string): Promise<void> {
		// Save current session state (messages are already saved as they're sent)
		this.currentSessionId = sessionId;
		await this.loadSessionMessages();
	}

	private async createNewSession(): Promise<void> {
		try {
			const newSession = await this.chatHistoryService.createSession();
			this.currentSessionId = newSession.id;
			this.messages = [];
			if (this.messagesContainer) {
				while (this.messagesContainer.firstChild) {
					this.messagesContainer.removeChild(this.messagesContainer.firstChild);
				}
				this.renderWelcomeMessage();
			}
			this.refreshSessionSelector();
			if (this.sessionSelector) {
				this.sessionSelector.value = newSession.id;
			}
		} catch (err) {
			this.logService.error('[Leapfrog] Failed to create new session', err);
		}
	}

	private async refreshSessionSelector(): Promise<void> {
		if (!this.sessionSelector) {
			return;
		}

		try {
			const sessions = await this.chatHistoryService.getSessions();

			// Clear and repopulate
			while (this.sessionSelector.firstChild) {
				this.sessionSelector.removeChild(this.sessionSelector.firstChild);
			}

			for (const session of sessions) {
				const option = document.createElement('option');
				option.value = session.id;
				option.textContent = session.title || 'Chat';
				this.sessionSelector.appendChild(option);
			}

			if (this.currentSessionId) {
				this.sessionSelector.value = this.currentSessionId;
			}
		} catch (err) {
			this.logService.error('[Leapfrog] Failed to refresh session selector', err);
		}
	}

	// -----------------------------------------------------------------------
	// UI Rendering
	// -----------------------------------------------------------------------

	private renderSessionSelector(header: HTMLElement): void {
		const selectorContainer = append(header, $('.leapfrog-chat-session-selector'));

		this.newChatButton = append(selectorContainer, $('button.leapfrog-chat-new'));
		this.newChatButton.textContent = nls.localize('leapfrogChatNew', "New Chat");
		this.newChatButton.title = nls.localize('leapfrogChatNewTitle', "Start a new conversation");
		this.newChatButton.onclick = () => this.createNewSession();

		const label = append(selectorContainer, $('label'));
		label.textContent = nls.localize('leapfrogChatSession', "Session:");

		this.sessionSelector = append(selectorContainer, $('select')) as HTMLSelectElement;
		this.sessionSelector.onchange = (e) => {
			const sessionId = (e.target as HTMLSelectElement).value;
			if (sessionId && sessionId !== this.currentSessionId) {
				this.switchSession(sessionId);
			}
		};
	}

	private renderModelSelector(header: HTMLElement): void {
		const selectorContainer = append(header, $('.leapfrog-chat-model-selector'));

		const label = append(selectorContainer, $('label'));
		label.textContent = nls.localize('leapfrogChatModel', "Model:");

		this.modelSelector = append(selectorContainer, $('select')) as HTMLSelectElement;

		// Get default model from configuration
		const defaultModel = this._configurationService.getValue<string>(LeapfrogConfigurationKeys.DefaultModel) || 'gpt-4o';

		// Populate with available models
		for (const model of LEAPFROG_AVAILABLE_MODELS) {
			const option = document.createElement('option');
			option.value = model.id;
			option.textContent = `${model.name} (${model.provider})`;
			if (model.id === defaultModel) {
				option.selected = true;
			}
			this.modelSelector.appendChild(option);
		}

		// API key status indicator
		const apiKeyStatus = append(header, $('.leapfrog-chat-api-status'));
		apiKeyStatus.title = nls.localize('leapfrogApiKeyStatus', "Configure API keys in settings");

		const configureButton = append(apiKeyStatus, $('button.leapfrog-configure-api'));
		configureButton.textContent = nls.localize('leapfrogConfigureApi', "Configure API Keys");
		configureButton.onclick = () => this.openApiKeySettings();
	}

	private renderWelcomeMessage(): void {
		if (!this.messagesContainer) {
			return;
		}

		this.welcomeElement = append(this.messagesContainer, $('.leapfrog-chat-welcome'));

		const icon = append(this.welcomeElement, $('.leapfrog-chat-welcome-icon'));
		// allow-any-unicode-next-line
		icon.textContent = '🐸';

		const title = append(this.welcomeElement, $('h3'));
		title.textContent = nls.localize('chatWelcome', "AI Assistant");

		const description = append(this.welcomeElement, $('p'));
		description.textContent = nls.localize('chatDescription', "I can help you analyze your qualitative research data, suggest codes, find patterns, and answer questions about your transcripts.");

		const suggestions = append(this.welcomeElement, $('.leapfrog-chat-suggestions'));
		const suggestionsTitle = append(suggestions, $('p.suggestions-title'));
		suggestionsTitle.textContent = nls.localize('leapfrogChatSuggestions', "Try asking:");

		const suggestionsList = [
			nls.localize('chatSuggestion1', "What themes emerge from my interview data?"),
			nls.localize('chatSuggestion2', "Suggest tags for the selected text"),
			nls.localize('chatSuggestion3', "Find quotes related to 'user frustration'"),
			nls.localize('chatSuggestion4', "Summarize the key findings"),
		];

		for (const suggestion of suggestionsList) {
			const suggestionButton = append(suggestions, $('button.leapfrog-chat-suggestion'));
			suggestionButton.textContent = suggestion;
			suggestionButton.onclick = () => this.sendMessage(suggestion);
		}
	}

	private renderInputArea(): void {
		if (!this.inputContainer) {
			return;
		}

		// Attachment container
		this.attachmentContainer = append(this.inputContainer, $('.leapfrog-chat-attachments'));
		this.renderAttachmentUI();

		const inputWrapper = append(this.inputContainer, $('.leapfrog-chat-input-wrapper'));

		const attachButton = append(inputWrapper, $('button.leapfrog-chat-attach'));
		// allow-any-unicode-next-line
		attachButton.textContent = '📎';
		attachButton.title = nls.localize('leapfrogChatAttach', "Attach file");
		attachButton.onclick = () => this.pickFileAttachment();

		this.inputTextarea = append(inputWrapper, $('textarea')) as HTMLTextAreaElement;
		this.inputTextarea.placeholder = nls.localize('leapfrogChatPlaceholder', "Ask a question about your research...");
		this.inputTextarea.rows = 3;

		// Handle Enter key (Shift+Enter for newline)
		this.inputTextarea.onkeydown = (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this.handleSend();
			}
		};

		// Auto-resize textarea
		this.inputTextarea.oninput = () => {
			if (this.inputTextarea) {
				this.inputTextarea.style.height = 'auto';
				this.inputTextarea.style.height = Math.min(this.inputTextarea.scrollHeight, 150) + 'px';
			}
		};

		const buttonContainer = append(this.inputContainer, $('.leapfrog-chat-buttons'));

		const sendButton = append(buttonContainer, $('button.leapfrog-chat-send'));
		sendButton.textContent = nls.localize('leapfrogChatSend', "Send");
		sendButton.onclick = () => this.handleSend();

		this.stopButton = append(buttonContainer, $('button.leapfrog-chat-stop'));
		this.stopButton.textContent = nls.localize('leapfrogChatStop', "Stop");
		this.stopButton.style.display = 'none';
		this.stopButton.onclick = () => this.cancelStream();

		const clearButton = append(buttonContainer, $('button.leapfrog-chat-clear'));
		clearButton.textContent = nls.localize('leapfrogChatClear', "Clear");
		clearButton.onclick = () => this.clearChat();
	}

	// -----------------------------------------------------------------------
	// Attachment Management
	// -----------------------------------------------------------------------

	private async pickFileAttachment(): Promise<void> {
		try {
			const files = await this.fileDialogService.showOpenDialog({
				title: nls.localize('leapfrogChatAttachFile', "Attach file"),
				canSelectFiles: true,
				canSelectFolders: false,
				canSelectMany: true,
			});

			if (!files || files.length === 0) {
				return;
			}

			for (const fileUri of files) {
				try {
					const fileName = fileUri.path.split('/').pop() || 'file';
					const stat = await this.fileService.stat(fileUri);

					let content: string | undefined;
					if (stat.size && stat.size < 1024 * 100) { // 100KB limit for inline content
						try {
							const fileContent = await this.fileService.readFile(fileUri);
							content = fileContent.value.toString();
						} catch {
							// If reading fails, just use reference
						}
					}

					const attachment: ILeapfrogChatAttachment = {
						type: 'file',
						uri: fileUri.toString(),
						name: fileName,
						content,
					};

					this.attachments.push(attachment);
				} catch (err) {
					this.logService.error('[Leapfrog] Failed to attach file', err);
				}
			}

			this.renderAttachmentUI();
		} catch (err) {
			this.logService.error('[Leapfrog] File dialog error', err);
		}
	}

	private renderAttachmentUI(): void {
		if (!this.attachmentContainer) {
			return;
		}

		// Clear existing attachments display
		while (this.attachmentContainer.firstChild) {
			this.attachmentContainer.removeChild(this.attachmentContainer.firstChild);
		}

		if (this.attachments.length === 0) {
			return;
		}

		const label = append(this.attachmentContainer, $('label'));
		label.textContent = nls.localize('leapfrogChatAttachments', "Attachments:");

		const chipsContainer = append(this.attachmentContainer, $('.leapfrog-chat-attachment-chips'));

		for (let i = 0; i < this.attachments.length; i++) {
			const attachment = this.attachments[i];
			const chip = append(chipsContainer, $('.leapfrog-chat-attachment-chip'));

			const name = append(chip, $('span.leapfrog-chat-attachment-name'));
			name.textContent = attachment.name;

			const removeBtn = append(chip, $('button.leapfrog-chat-attachment-remove'));
			removeBtn.textContent = '×';
			removeBtn.title = nls.localize('leapfrogChatRemoveAttachment', "Remove");
			removeBtn.onclick = () => {
				this.attachments.splice(i, 1);
				this.renderAttachmentUI();
			};
		}
	}

	private clearAttachments(): void {
		this.attachments = [];
		this.renderAttachmentUI();
	}

	// -----------------------------------------------------------------------
	// Message Handling
	// -----------------------------------------------------------------------

	private handleSend(): void {
		if (this.isProcessing || !this.inputTextarea) {
			return;
		}

		const content = this.inputTextarea.value.trim();
		if (!content) {
			return;
		}

		this.sendMessage(content);
		this.inputTextarea.value = '';
		this.inputTextarea.style.height = 'auto';
	}

	private async sendMessage(content: string): Promise<void> {
		if (this.isProcessing) {
			return;
		}

		// Clear welcome message on first message
		if (this.messages.length === 0 && this.welcomeElement) {
			this.welcomeElement.remove();
			this.welcomeElement = undefined;
		}

		// Check for slash commands
		const slashCommand = this.parseSlashCommand(content);
		let finalContent = content;

		if (slashCommand) {
			try {
				finalContent = await slashCommand.command.handler(slashCommand.args, { attachments: this.attachments });
				// Display the original slash command in UI
				this.addMessage('user', content);
			} catch (err) {
				this.logService.error('[Leapfrog] Slash command error', err);
				finalContent = content;
				this.addMessage('user', content);
			}
		} else {
			// Add user message
			this.addMessage('user', content);
		}

		// Persist user message to session
		if (this.currentSessionId) {
			const userMessage: ILeapfrogChatMessageData = {
				id: generateUuid(),
				role: 'user',
				content,
				timestamp: Date.now(),
				attachments: this.attachments.length > 0 ? [...this.attachments] : undefined,
			};
			this.chatHistoryService.addMessage(this.currentSessionId, userMessage).catch(err =>
				this.logService.error('[Leapfrog] Failed to save user message', err)
			);
		}

		// Set processing state
		this.isProcessing = true;

		// Get AI response with streaming (using processed command content)
		this.streamResponse(finalContent);

		// Clear attachments after sending
		this.clearAttachments();
	}

	private parseSlashCommand(input: string): { command: ISlashCommand; args: string } | undefined {
		const trimmed = input.trim();
		if (!trimmed.startsWith('/')) {
			return undefined;
		}

		const parts = trimmed.substring(1).split(/\s+/);
		const commandName = parts[0].toLowerCase();
		const args = parts.slice(1).join(' ');

		const command = SLASH_COMMANDS.find(c => c.name === commandName);
		if (!command) {
			return undefined;
		}

		return { command, args };
	}

	private addMessage(role: 'user' | 'assistant' | 'system', content: string): void {
		if (!this.messagesContainer) {
			return;
		}

		const messageElement = append(this.messagesContainer, $(`.leapfrog-chat-message.${role}`));

		const avatar = append(messageElement, $('.leapfrog-chat-avatar'));
		// allow-any-unicode-next-line
		avatar.textContent = role === 'user' ? '\u{1F464}' : '\u{1F438}';

		const contentElement = append(messageElement, $('.leapfrog-chat-content'));
		contentElement.textContent = content;

		const messageData: ChatMessageElement = {
			role,
			content,
			element: messageElement
		};

		this.messages.push(messageData);

		// Scroll to bottom
		this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
	}

	private createMessageElement(role: 'user' | 'assistant' | 'system', content: string): HTMLElement {
		const messageElement = $( `.leapfrog-chat-message.${role}`);

		const avatar = append(messageElement, $('.leapfrog-chat-avatar'));
		// allow-any-unicode-next-line
		avatar.textContent = role === 'user' ? '\u{1F464}' : '\u{1F438}';

		const contentElement = append(messageElement, $('.leapfrog-chat-content'));
		contentElement.textContent = content;

		return messageElement;
	}

	// -----------------------------------------------------------------------
	// Streaming Response
	// -----------------------------------------------------------------------

	private async streamResponse(userContent?: string): Promise<void> {
		if (!this.messagesContainer || !this.currentSessionId) {
			this.isProcessing = false;
			return;
		}

		// Build chat messages from current conversation
		const chatMessages: ILeapfrogChatMessage[] = this.messages.map(m => ({
			role: m.role,
			content: m.content,
		}));

		// If userContent is provided (from slash command processing), replace the last user message
		if (userContent && chatMessages.length > 0 && chatMessages[chatMessages.length - 1].role === 'user') {
			chatMessages[chatMessages.length - 1].content = userContent;
		}

		// Build system message with attachment context
		let systemContent = 'You are an AI assistant specialized in analyzing qualitative research data. Help the user identify themes, patterns, suggest codes/tags, find relevant quotes, and answer questions about their research.';

		if (this.attachments.length > 0) {
			systemContent += '\n\nAttached files:\n';
			for (const att of this.attachments) {
				if (att.content) {
					systemContent += `\n--- ${att.name} ---\n${att.content}\n`;
				} else {
					systemContent += `- ${att.name} (${att.uri})\n`;
				}
			}
		}

		const systemMessage: ILeapfrogChatMessage = {
			role: 'system',
			content: systemContent,
		};
		chatMessages.unshift(systemMessage);

		// Create assistant message placeholder
		const messageElement = this.createMessageElement('assistant', '');
		this.messagesContainer.appendChild(messageElement);
		const contentElementQuery = messageElement.querySelector('.leapfrog-chat-content');
		if (!contentElementQuery || !isHTMLElement(contentElementQuery)) {
			this.isProcessing = false;
			return;
		}
		const contentElement = contentElementQuery;

		const messageData: ChatMessageElement = {
			role: 'assistant',
			content: '',
			element: messageElement
		};
		this.messages.push(messageData);

		// Setup cancellation
		this.currentStreamCancel = new CancellationTokenSource();
		if (this.stopButton) {
			this.stopButton.style.display = 'inline-block';
		}

		let fullContent = '';

		try {
			for await (const chunk of this.aiService.stream(chatMessages, { model: this.modelSelector?.value }, this.currentStreamCancel.token)) {
				if (this.currentStreamCancel.token.isCancellationRequested) {
					break;
				}

				fullContent += chunk.content;
				if (contentElement) {
					contentElement.textContent = fullContent;
				}
				messageData.content = fullContent;

				// Scroll to bottom
				if (this.messagesContainer) {
					this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
				}

				if (chunk.done) {
					break;
				}
			}

			// Persist assistant message
			const assistantMessage: ILeapfrogChatMessageData = {
				id: generateUuid(),
				role: 'assistant',
				content: fullContent,
				timestamp: Date.now(),
				model: this.modelSelector?.value,
			};
			await this.chatHistoryService.addMessage(this.currentSessionId, assistantMessage);

			// Auto-generate title from first user message if not set
			const session = await this.chatHistoryService.getSession(this.currentSessionId);
			if (session && session.title === 'New Chat') {
				const title = await this.chatHistoryService.generateSessionTitle(this.currentSessionId);
				await this.chatHistoryService.setSessionTitle(this.currentSessionId, title);
			}

		} catch (err) {
			if (!(err instanceof Error) || !err.message.includes('cancelled')) {
				const errorMessage = `Error: ${toErrorMessage(err)}`;
				if (contentElement) {
					contentElement.textContent = errorMessage;
				}
				messageData.content = errorMessage;
				this.logService.error('[Leapfrog] Streaming error:', err);
			}
		} finally {
			this.isProcessing = false;
			this.currentStreamCancel = undefined;
			if (this.stopButton) {
				this.stopButton.style.display = 'none';
			}
		}
	}

	private cancelStream(): void {
		if (this.currentStreamCancel) {
			this.currentStreamCancel.cancel();
		}
	}

	private clearChat(): void {
		this.messages = [];
		if (this.messagesContainer) {
			while (this.messagesContainer.firstChild) {
				this.messagesContainer.removeChild(this.messagesContainer.firstChild);
			}
			this.renderWelcomeMessage();
		}
	}

	private openApiKeySettings(): void {
		// TODO: Open settings filtered to leapfrog API keys
		this.logService.info('[Leapfrog] Open API key settings');
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}
