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
import {
	LEAPFROG_CHAT_VIEW_ID,
	LEAPFROG_AVAILABLE_MODELS,
	ILeapfrogAIService,
	ILeapfrogApiKeyService,
	ILeapfrogChatMessage,
} from '../../common/leapfrog.js';
import { LeapfrogConfigurationKeys } from '../../common/leapfrogConfiguration.js';

interface ChatMessageElement {
	role: 'user' | 'assistant' | 'system';
	content: string;
	element: HTMLElement;
	contentElement: HTMLElement;
}

export class LeapfrogChatView extends ViewPane {

	static readonly ID: string = LEAPFROG_CHAT_VIEW_ID;
	static readonly NAME: ILocalizedString = nls.localize2('chat', "Chat");

	private messagesContainer: HTMLElement | undefined;
	private inputContainer: HTMLElement | undefined;
	private inputTextarea: HTMLTextAreaElement | undefined;
	private modelSelector: HTMLSelectElement | undefined;
	private welcomeElement: HTMLElement | undefined;
	private stopButton: HTMLButtonElement | undefined;
	private sendButton: HTMLButtonElement | undefined;
	private messages: ChatMessageElement[] = [];
	private isProcessing = false;
	private cancelStreaming = false;

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
		@ILeapfrogAIService private readonly aiService: ILeapfrogAIService,
		@ILeapfrogApiKeyService private readonly apiKeyService: ILeapfrogApiKeyService,
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

		this.sendButton = append(buttonContainer, $('button.leapfrog-chat-send')) as HTMLButtonElement;
		this.sendButton.textContent = nls.localize('leapfrogChatSend', "Send");
		this.sendButton.onclick = () => this.handleSend();

		this.stopButton = append(buttonContainer, $('button.leapfrog-chat-stop')) as HTMLButtonElement;
		this.stopButton.textContent = nls.localize('leapfrogChatStop', "Stop");
		this.stopButton.onclick = () => this.handleStop();
		this.stopButton.style.display = 'none';

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

	private handleStop(): void {
		this.cancelStreaming = true;
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
		this.setProcessingState(true);

		// Send to AI with streaming
		this.sendToAI();
	}

	private async sendToAI(): Promise<void> {
		// Determine the selected model's provider
		const selectedModelId = this.modelSelector?.value ?? 'gpt-4o';
		const modelInfo = LEAPFROG_AVAILABLE_MODELS.find(m => m.id === selectedModelId);
		const provider = modelInfo?.provider ?? 'openai';

		// Check if API key is configured
		const hasKey = await this.apiKeyService.hasApiKey(provider);
		if (!hasKey) {
			this.addMessage('system', `${provider === 'openai' ? 'OpenAI' : 'Anthropic'} API key is not configured. Please click "Configure API Keys" to set up your API key.`);
			this.setProcessingState(false);
			return;
		}

		// Build message history for the API
		const chatMessages: ILeapfrogChatMessage[] = this.messages
			.filter(m => m.role === 'user' || m.role === 'assistant')
			.map(m => ({
				role: m.role as 'user' | 'assistant',
				content: m.content,
			}));

		// Create assistant message element for streaming
		const assistantMsg = this.addMessage('assistant', '');

		// Add typing indicator
		const typingIndicator = this.addTypingIndicator();

		this.cancelStreaming = false;

		try {
			const stream = this.aiService.stream(chatMessages, {
				model: selectedModelId,
			});

			// Remove typing indicator when first chunk arrives
			let firstChunk = true;
			let fullContent = '';

			for await (const chunk of stream) {
				if (this.cancelStreaming) {
					break;
				}

				if (firstChunk && typingIndicator) {
					typingIndicator.remove();
					firstChunk = false;
				}

				if (chunk.content) {
					fullContent += chunk.content;
					assistantMsg.content = fullContent;
					assistantMsg.contentElement.textContent = fullContent;

					// Scroll to bottom
					if (this.messagesContainer) {
						this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
					}
				}

				if (chunk.done) {
					break;
				}
			}

			// Ensure typing indicator is removed even if no chunks arrived
			if (firstChunk && typingIndicator) {
				typingIndicator.remove();
			}

			// If nothing was streamed (cancelled before first chunk), show a note
			if (!fullContent && this.cancelStreaming) {
				assistantMsg.content = '(Generation stopped)';
				assistantMsg.contentElement.textContent = '(Generation stopped)';
			}

		} catch (err) {
			// Remove typing indicator on error
			if (typingIndicator) {
				typingIndicator.remove();
			}

			const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
			assistantMsg.content = `Error: ${errorMessage}`;
			assistantMsg.contentElement.textContent = `Error: ${errorMessage}`;
			assistantMsg.element.classList.add('error');
		} finally {
			this.setProcessingState(false);
		}
	}

	private setProcessingState(processing: boolean): void {
		this.isProcessing = processing;

		if (this.sendButton) {
			this.sendButton.style.display = processing ? 'none' : '';
		}
		if (this.stopButton) {
			this.stopButton.style.display = processing ? '' : 'none';
		}
		if (this.inputTextarea) {
			this.inputTextarea.disabled = processing;
		}
	}

	private addMessage(role: 'user' | 'assistant' | 'system', content: string): ChatMessageElement {
		if (!this.messagesContainer) {
			// Return a dummy element if container is not ready
			const dummy = document.createElement('div');
			return { role, content, element: dummy, contentElement: dummy };
		}

		const messageElement = append(this.messagesContainer, $(`.leapfrog-chat-message.${role}`));

		const avatar = append(messageElement, $('.leapfrog-chat-avatar'));
		if (role === 'user') {
			// allow-any-unicode-next-line
			avatar.textContent = '\u{1F464}';
		} else if (role === 'system') {
			// allow-any-unicode-next-line
			avatar.textContent = '\u{26A0}';
		} else {
			// allow-any-unicode-next-line
			avatar.textContent = '\u{1F438}';
		}

		const contentElement = append(messageElement, $('.leapfrog-chat-content'));
		contentElement.textContent = content;

		const messageData: ChatMessageElement = {
			role,
			content,
			element: messageElement,
			contentElement,
		};

		this.messages.push(messageData);

		// Scroll to bottom
		this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;

		return messageData;
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
		// Open VS Code settings filtered to leapfrog AI configuration.
		// Users can also open settings via Ctrl+, and search for "leapfrog.ai"
		this.openerService.open('command:workbench.action.openSettings?%22leapfrog.ai%22');
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}
