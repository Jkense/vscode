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
import { $, append } from '../../../../../base/browser/dom.js';
import { LEAPFROG_CHAT_VIEW_ID, LEAPFROG_AVAILABLE_MODELS } from '../../common/leapfrog.js';
import { LeapfrogConfigurationKeys } from '../../common/leapfrogConfiguration.js';

interface ChatMessageElement {
	role: 'user' | 'assistant' | 'system';
	content: string;
	element: HTMLElement;
}

export class LeapfrogChatView extends ViewPane {

	static readonly ID: string = LEAPFROG_CHAT_VIEW_ID;
	static readonly NAME: ILocalizedString = nls.localize2('chat', "Chat");

	private messagesContainer: HTMLElement | undefined;
	private inputContainer: HTMLElement | undefined;
	private inputTextarea: HTMLTextAreaElement | undefined;
	private modelSelector: HTMLSelectElement | undefined;
	private welcomeElement: HTMLElement | undefined;
	private messages: ChatMessageElement[] = [];
	private isProcessing = false;

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
	) {
		super(options as IViewPaneOptions, keybindingService, contextMenuService, _configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		container.classList.add('leapfrog-chat-view');

		// Header with model selector
		const header = append(container, $('.leapfrog-chat-header'));
		this.renderModelSelector(header);

		// Messages container
		this.messagesContainer = append(container, $('.leapfrog-chat-messages'));

		// Show welcome message
		this.renderWelcomeMessage();

		// Input container
		this.inputContainer = append(container, $('.leapfrog-chat-input-container'));
		this.renderInputArea();
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

		const inputWrapper = append(this.inputContainer, $('.leapfrog-chat-input-wrapper'));

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

		const clearButton = append(buttonContainer, $('button.leapfrog-chat-clear'));
		clearButton.textContent = nls.localize('leapfrogChatClear', "Clear");
		clearButton.onclick = () => this.clearChat();
	}

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

	private sendMessage(content: string): void {
		if (this.isProcessing) {
			return;
		}

		// Clear welcome message on first message
		if (this.messages.length === 0 && this.welcomeElement) {
			this.welcomeElement.remove();
			this.welcomeElement = undefined;
		}

		// Add user message
		this.addMessage('user', content);

		// Set processing state
		this.isProcessing = true;

		// Simulate AI response (placeholder - will be replaced with actual AI service)
		this.simulateAIResponse(content);
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

	private simulateAIResponse(userMessage: string): void {
		// Add typing indicator
		const typingIndicator = this.addTypingIndicator();

		// Simulate delay
		setTimeout(() => {
			if (typingIndicator) {
				typingIndicator.remove();
			}

			// Generate placeholder response based on message
			let response = '';
			const lowerMessage = userMessage.toLowerCase();

			if (lowerMessage.includes('theme') || lowerMessage.includes('pattern')) {
				response = 'Based on your research data, I can identify several emerging themes:\n\n1. **User Frustration** - Multiple participants expressed difficulty with the current workflow\n2. **Desire for Simplicity** - A recurring theme of wanting more streamlined processes\n3. **Communication Gaps** - Several mentions of information not flowing between teams\n\nWould you like me to find specific quotes supporting any of these themes?';
			} else if (lowerMessage.includes('tag') || lowerMessage.includes('suggest')) {
				response = 'For the selected text, I suggest the following tags:\n\n- **Pain Point** - The participant is describing a specific frustration\n- **Feature Request** - There\'s an implicit suggestion for improvement\n- **Workflow Issue** - Related to how they complete their tasks\n\nWould you like me to apply any of these tags?';
			} else if (lowerMessage.includes('find') || lowerMessage.includes('quote') || lowerMessage.includes('search')) {
				response = 'I found 3 relevant quotes in your transcripts:\n\n1. *"I spend way too much time on this task..."* - Interview 2, Speaker A\n2. *"It\'s frustrating when the system doesn\'t..."* - Interview 5, Speaker B\n3. *"We need a better way to handle..."* - Interview 7, Speaker A\n\nClick on any quote to navigate to it in the transcript.';
			} else if (lowerMessage.includes('summarize') || lowerMessage.includes('summary')) {
				response = '**Key Findings Summary**\n\nAcross your 8 interviews, the main findings are:\n\n- **Primary Pain Point**: Process complexity (mentioned by 6/8 participants)\n- **Top Request**: Better integration between tools\n- **Satisfaction Level**: Mixed - high satisfaction with support, low with current tools\n- **Recommendation**: Focus on simplifying the core workflow\n\nWould you like a more detailed breakdown of any area?';
			} else {
				response = 'I understand you\'re asking about your qualitative research data. To provide the most helpful analysis, I\'d need access to your project files and transcripts.\n\n**Currently, I can help you with:**\n- Identifying themes and patterns\n- Suggesting tags for text\n- Finding relevant quotes\n- Summarizing findings\n\n**To get started:**\n1. Open a project in the Projects view\n2. Select text in a transcript to tag it\n3. Ask me specific questions about your data\n\nHow can I assist with your research today?';
			}

			this.addMessage('assistant', response);
			this.isProcessing = false;

		}, 1000 + Math.random() * 1000);
	}

	private addTypingIndicator(): HTMLElement | null {
		if (!this.messagesContainer) {
			return null;
		}

		const indicator = append(this.messagesContainer, $('.leapfrog-chat-typing'));

		const avatar = append(indicator, $('.leapfrog-chat-avatar'));
		// allow-any-unicode-next-line
		avatar.textContent = '🐸';

		const dots = append(indicator, $('.leapfrog-chat-typing-dots'));
		for (let i = 0; i < 3; i++) {
			append(dots, $('span.dot'));
		}

		this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;

		return indicator;
	}

	private clearChat(): void {
		this.messages = [];
		if (this.messagesContainer) {
			// Clear all children using DOM manipulation instead of innerHTML
			while (this.messagesContainer.firstChild) {
				this.messagesContainer.removeChild(this.messagesContainer.firstChild);
			}
			this.renderWelcomeMessage();
		}
	}

	private openApiKeySettings(): void {
		// TODO: Open settings filtered to leapfrog API keys
		console.log('Open API key settings');
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}
