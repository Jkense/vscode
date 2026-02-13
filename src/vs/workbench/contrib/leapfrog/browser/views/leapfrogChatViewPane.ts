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
import { IQuickInputService, IQuickPickItem } from '../../../../../platform/quickinput/common/quickInput.js';
import { ActionBar, ActionsOrientation } from '../../../../../base/browser/ui/actionbar/actionbar.js';
import { Action, IAction } from '../../../../../base/common/actions.js';

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
	private tabBar: ActionBar | undefined;
	private tabActions: Map<string, Action> = new Map();
	private openSessions: string[] = [];
	private activeSessionIndex = 0;
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
		@IQuickInputService private readonly quickInputService: IQuickInputService,
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

		// Create tab bar container at top
		const tabBarContainer = append(container, $('div.chat-tabs-container'));
		this.renderTabBar(tabBarContainer);

		// Create main chat container
		this.chatContainer = append(container, $('div.chat-container'));

		// Messages list
		this.messagesList = append(this.chatContainer, $('div.chat-messages'));

		// Input area
		this.renderInputArea(this.chatContainer);

		// Load and display existing messages
		this.initializeSessions();
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
			// Clear existing messages when switching sessions
			if (this.messagesList) {
				this.messagesList.innerHTML = '';
			}

			// Load messages for current session
			if (this.currentSessionId) {
				const session = await this.chatHistoryService.getSession(this.currentSessionId);
				if (session && session.messages) {
					for (const msg of session.messages) {
						this.addMessageToUI(msg.role as 'user' | 'assistant', msg.content);
					}
				}
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

			// Get chat config (can contain model, temperature, etc.)
			const config = this.configurationService.getValue<Record<string, unknown>>('leapfrog.ai') || {};

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
			this.addMessageToUI('assistant', nls.localize('leapfrogChatErrorGeneral', 'Error: {0}', errorMsg));
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

	private renderTabBar(container: HTMLElement): void {
		this.tabBar = this._register(new ActionBar(container, {
			orientation: ActionsOrientation.HORIZONTAL,
			ariaLabel: nls.localize('chatTabsLabel', 'Chat Sessions'),
			ariaRole: 'tablist',
			focusOnlyEnabledItems: true
		}));
	}

	private async initializeSessions(): Promise<void> {
		try {
			const sessions = await this.chatHistoryService.getSessions();

			if (sessions.length === 0) {
				// Create first session
				const newSession = await this.chatHistoryService.createSession('Chat');
				this.openSessions = [newSession.id];
				this.currentSessionId = newSession.id;
			} else {
				// Open the most recent session
				this.openSessions = [sessions[0].id];
				this.currentSessionId = sessions[0].id;
			}

			this.activeSessionIndex = 0;
			await this.refreshTabBar();
			await this.loadMessages();
		} catch (error) {
			this.logService.error('[Leapfrog Chat] Failed to initialize sessions:', error);
		}
	}

	private async refreshTabBar(): Promise<void> {
		if (!this.tabBar) {
			return;
		}

		// Clear existing tabs
		this.tabBar.clear();
		this.tabActions.clear();

		// Create actions for each open session
		const actions: IAction[] = [];

		for (let i = 0; i < this.openSessions.length; i++) {
			const sessionId = this.openSessions[i];
			const session = await this.chatHistoryService.getSession(sessionId);

			if (!session) {
				continue;
			}

			// Create tab action
			const tabAction = new Action(
				`session-tab-${sessionId}`,
				this.getSessionTitle(session),
				'chat-tab',
				true,
				() => this.switchToSession(i)
			);

			// Mark active tab as checked
			tabAction.checked = (i === this.activeSessionIndex);

			this.tabActions.set(sessionId, tabAction);
			actions.push(tabAction);
		}

		// Add "New Session" button
		const newSessionAction = new Action(
			'new-session',
			'+',
			'chat-tab-new',
			true,
			() => this.createNewSession()
		);
		actions.push(newSessionAction);

		// Add "Time Back" button (history icon)
		const timeBackAction = new Action(
			'time-back',
			'$(history)',
			'chat-tab-timeback',
			true,
			() => this.showSessionPicker()
		);
		actions.push(timeBackAction);

		// Push all actions to tab bar
		this.tabBar.push(actions);
	}

	private getSessionTitle(session: { title?: string; messages?: Array<{ role: string; content: string }> }): string {
		// Use first 30 chars of title, or "New Chat"
		if (session.title && session.title !== 'Chat') {
			return session.title.length > 30
				? session.title.substring(0, 27) + '...'
				: session.title;
		}
		return nls.localize('newChat', 'New Chat');
	}

	private async switchToSession(index: number): Promise<void> {
		if (index < 0 || index >= this.openSessions.length) {
			return;
		}

		this.activeSessionIndex = index;
		this.currentSessionId = this.openSessions[index];

		// Refresh UI
		await this.refreshTabBar();
		await this.loadMessages();
	}

	private async createNewSession(): Promise<void> {
		try {
			const newSession = await this.chatHistoryService.createSession('Chat');

			// Add to open sessions
			this.openSessions.push(newSession.id);
			this.activeSessionIndex = this.openSessions.length - 1;
			this.currentSessionId = newSession.id;

			// Refresh UI
			await this.refreshTabBar();
			await this.loadMessages();
		} catch (error) {
			this.logService.error('[Leapfrog Chat] Failed to create session:', error);
		}
	}

	private async showSessionPicker(): Promise<void> {
		try {
			// Get all sessions (sorted by most recent)
			const allSessions = await this.chatHistoryService.getSessions();

			if (allSessions.length === 0) {
				return;
			}

			// Create QuickPick items
			const items: (IQuickPickItem & { sessionId?: string })[] = allSessions.map(session => ({
				label: this.getSessionTitle(session),
				description: this.formatSessionDate(session.updatedAt),
				detail: this.getSessionPreview(session),
				sessionId: session.id
			}));

			// Create and configure picker
			type SessionPickItem = IQuickPickItem & { sessionId?: string };
			const picker = this.quickInputService.createQuickPick<SessionPickItem>();
			picker.placeholder = nls.localize('searchSessions', 'Search chat sessions...');
			picker.matchOnLabel = true;
			picker.matchOnDescription = true;
			picker.matchOnDetail = true;
			picker.items = items;

			// Handle selection
			picker.onDidAccept(() => {
				const selected = picker.selectedItems[0] as SessionPickItem | undefined;
				if (selected?.sessionId) {
					this.openSessionFromPicker(selected.sessionId);
				}
				picker.hide();
			});

			// Cleanup on hide
			picker.onDidHide(() => picker.dispose());

			// Show picker (autofocuses automatically)
			picker.show();

		} catch (error) {
			this.logService.error('[Leapfrog Chat] Failed to show session picker:', error);
		}
	}

	private formatSessionDate(timestamp: string): string {
		const date = new Date(timestamp);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		if (diffMins < 1) {
			return nls.localize('justNow', 'Just now');
		} else if (diffMins < 60) {
			return nls.localize('minsAgo', '{0} mins ago', diffMins);
		} else if (diffHours < 24) {
			return nls.localize('hoursAgo', '{0} hours ago', diffHours);
		} else if (diffDays < 7) {
			return nls.localize('daysAgo', '{0} days ago', diffDays);
		} else {
			return date.toLocaleDateString();
		}
	}

	private getSessionPreview(session: { messages?: Array<{ role: string; content: string }> }): string {
		// Get first user message as preview
		const firstMsg = session.messages?.find(m => m.role === 'user');
		if (firstMsg) {
			const preview = firstMsg.content.substring(0, 80);
			return preview.length < firstMsg.content.length ? preview + '...' : preview;
		}
		return nls.localize('emptySession', 'Empty session');
	}

	private async openSessionFromPicker(sessionId: string): Promise<void> {
		// Check if already open
		const existingIndex = this.openSessions.indexOf(sessionId);

		if (existingIndex !== -1) {
			// Already open, just switch to it
			await this.switchToSession(existingIndex);
		} else {
			// Open as new tab
			this.openSessions.push(sessionId);
			this.activeSessionIndex = this.openSessions.length - 1;
			this.currentSessionId = sessionId;

			await this.refreshTabBar();
			await this.loadMessages();
		}
	}
}
