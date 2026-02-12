/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../../nls.js';
import { ViewPane, IViewPaneOptions } from '../../../../browser/parts/views/viewPane.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../../common/views.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { ILeapfrogChatHistoryService, ILeapfrogAIService, ILeapfrogChatMessage, ILeapfrogChatMessageData } from '../../common/leapfrog.js';
import { append, $ } from '../../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { generateUuid } from '../../../../../base/common/uuid.js';

/**
 * Leapfrog Chat View Pane - Custom ViewPane Implementation
 *
 * This view provides functional chat with:
 * - Simple textarea input
 * - Message display
 * - Streaming AI responses from ILeapfrogAIService
 * - Session persistence via ILeapfrogChatHistoryService
 * - Per-project message storage in .leapfrog/chat.json
 *
 * We extend ViewPane (not ChatViewPane) because:
 * - VS Code's chat infrastructure is disabled in this build
 * - ChatViewPane requires unavailable services (chatAgentService, etc.)
 * - ViewPane is proven pattern (LeapfrogTagsView uses it successfully)
 * - We control UI and behavior directly
 */
export class LeapfrogChatViewPane extends ViewPane {

	static readonly ID: string = 'leapfrogChatView';
	static readonly NAME = nls.localize2('leapfrogChat', "Chat");

	private chatContainer: HTMLElement | undefined;
	private messagesList: HTMLElement | undefined;
	private inputEditor: HTMLTextAreaElement | undefined;
	private sendButton: HTMLButtonElement | undefined;
	private isStreaming = false;
	private currentSessionId: string | undefined;
	protected override configurationService: IConfigurationService;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@ILogService private readonly logService: ILogService,
		@ILeapfrogChatHistoryService private readonly chatHistoryService: ILeapfrogChatHistoryService,
		@ILeapfrogAIService private readonly aiService: ILeapfrogAIService,
	) {
		super(
			options,
			keybindingService,
			contextMenuService,
			configurationService,
			contextKeyService,
			viewDescriptorService,
			instantiationService,
			openerService,
			themeService,
			hoverService
		);

		this.configurationService = configurationService;

		this.logService.info('[Leapfrog Chat] View initialized');
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		container.classList.add('leapfrog-chat-viewpane');

		// Create main chat container
		this.chatContainer = append(container, $('div.chat-container'));

		// Messages list
		this.messagesList = append(this.chatContainer, $('div.chat-messages'));

		// Input area
		this.renderInputArea(this.chatContainer);

		// Load and display existing messages
		this.loadMessages();
	}

	private renderInputArea(container: HTMLElement): void {
		const inputContainer = append(container, $('div.chat-input-area'));

		// Textarea for input
		this.inputEditor = append(inputContainer, $('textarea.chat-input')) as HTMLTextAreaElement;
		this.inputEditor.placeholder = nls.localize('leapfrogChatPlaceholder', 'Type your message... (Enter to send, Shift+Enter for newline)');
		this.inputEditor.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this.sendMessage();
			}
		});

		// Button container
		const buttonContainer = append(inputContainer, $('div.chat-buttons'));

		// Send button
		this.sendButton = append(buttonContainer, $('button.monaco-button'));
		this.sendButton.textContent = nls.localize('leapfrogChatSend', 'Send');
		this.sendButton.addEventListener('click', () => this.sendMessage());

		// Clear button
		const clearButton = append(buttonContainer, $('button.monaco-button.secondary'));
		clearButton.textContent = nls.localize('leapfrogChatClear', 'Clear');
		clearButton.addEventListener('click', () => this.clearChat());
	}

	private async loadMessages(): Promise<void> {
		try {
			const sessions = await this.chatHistoryService.getSessions();
			if (sessions.length > 0) {
				const latestSession = sessions[0];
				this.currentSessionId = latestSession.id;
				if (latestSession.messages) {
					for (const msg of latestSession.messages) {
						this.addMessageToUI(msg.role as 'user' | 'assistant', msg.content);
					}
				}
			} else {
				// Create a new session if none exist
				const newSession = await this.chatHistoryService.createSession('Chat');
				this.currentSessionId = newSession.id;
			}
		} catch (error) {
			this.logService.warn('[Leapfrog Chat] Failed to load messages:', error);
		}
	}

	private async sendMessage(): Promise<void> {
		if (!this.inputEditor || this.isStreaming || !this.inputEditor.value.trim() || !this.currentSessionId) {
			return;
		}

		const content = this.inputEditor.value.trim();
		this.inputEditor.value = '';
		this.isStreaming = true;
		this.updateButtonStates();

		try {
			// Add user message to UI and save to history
			this.addMessageToUI('user', content);
			const userMsg: ILeapfrogChatMessageData = {
				id: generateUuid(),
				role: 'user',
				content,
				timestamp: Date.now()
			};
			await this.chatHistoryService.addMessage(this.currentSessionId, userMsg);

			// Get chat config
			const config = this.configurationService.getValue<any>('leapfrog.ai') || {};

			// Add loading placeholder
			const loadingElement = this.addMessageToUI('assistant', nls.localize('leapfrogChatThinking', 'Thinking...'));

			// Get current session messages for context
			const session = await this.chatHistoryService.getSession(this.currentSessionId);
			const messages: ILeapfrogChatMessage[] = (session?.messages || []).map(m => ({
				role: m.role,
				content: m.content
			}));

			// Stream response from AI service
			let fullResponse = '';
			try {
				for await (const chunk of this.aiService.stream(messages, config, CancellationToken.None)) {
					fullResponse += chunk.content;
					if (loadingElement) {
						loadingElement.textContent = fullResponse;
					}
				}
			} catch (streamError) {
				this.logService.error('[Leapfrog Chat] Stream error:', streamError);
				fullResponse = nls.localize('leapfrogChatError', 'Error getting response: {0}',
					streamError instanceof Error ? streamError.message : 'Unknown error');
				if (loadingElement) {
					loadingElement.textContent = fullResponse;
				}
			}

			// Save assistant response to history
			const assistantMsg: ILeapfrogChatMessageData = {
				id: generateUuid(),
				role: 'assistant',
				content: fullResponse,
				timestamp: Date.now()
			};
			await this.chatHistoryService.addMessage(this.currentSessionId, assistantMsg);

		} catch (error) {
			this.logService.error('[Leapfrog Chat] Error:', error);
			const errorMsg = error instanceof Error ? error.message : 'Unknown error';
			this.addMessageToUI('assistant', nls.localize('leapfrogChatError', 'Error: {0}', errorMsg));
		} finally {
			this.isStreaming = false;
			this.updateButtonStates();
		}
	}

	private addMessageToUI(role: 'user' | 'assistant', content: string): HTMLElement | null {
		if (!this.messagesList) {
			return null;
		}

		const messageDiv = append(this.messagesList, $(`div.chat-message.${role}`));
		const roleLabel = append(messageDiv, $('div.message-role'));
		roleLabel.textContent = role === 'user'
			? nls.localize('leapfrogChatYou', 'You')
			: nls.localize('leapfrogChatAssistant', 'Assistant');

		const contentDiv = append(messageDiv, $('div.message-content'));
		contentDiv.textContent = content;

		// Scroll to bottom
		if (this.messagesList) {
			this.messagesList.scrollTop = this.messagesList.scrollHeight;
		}

		return contentDiv;
	}

	private clearChat(): void {
		if (this.messagesList) {
			this.messagesList.innerHTML = '';
		}
		if (this.inputEditor) {
			this.inputEditor.value = '';
		}
	}

	private updateButtonStates(): void {
		if (this.sendButton && this.inputEditor) {
			this.sendButton.disabled = this.isStreaming || !this.inputEditor.value.trim();
		}
	}
}
