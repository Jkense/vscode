/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Leapfrog Chat Service Implementation
 *
 * Adapts Leapfrog's chat history and session data to VS Code's IChatService interface.
 * This service bridges .leapfrog/chat.json to VS Code's ChatModel, handling session lifecycle,
 * message persistence, and in-memory model management with reference counting.
 *
 * Architecture:
 * - Loads sessions from ILeapfrogChatHistoryService
 * - Converts ILeapfrogChatSession ↔ IChatModel on-demand
 * - Manages ChatModel instances with reference counting
 * - Persists changes back to .leapfrog/chat.json
 * - Provides sessions as URI resources (vscode-chat://leapfrog/session/{id})
 */

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { URI } from '../../../../base/common/uri.js';
import { observableValue, IObservable } from '../../../../base/common/observable.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';

import {
	ILeapfrogChatHistoryService,
	ILeapfrogChatSession,
	ILeapfrogChatMessageData,
} from '../common/leapfrog.js';

import {
	IChatService,
	IChatModelReference,
	IChatSendRequestOptions,
	IChatSendRequestData,
	IChatSessionStartOptions,
	IChatCompleteResponse,
	IChatUserActionEvent,
	IChatSessionContext,
	IChatDetail,
	IChatProgress,
} from '../../../../workbench/contrib/chat/common/chatService/chatService.js';

import {
	ChatModel,
} from '../../../../workbench/contrib/chat/common/model/chatModel.js';

import { ChatAgentLocation } from '../../../../workbench/contrib/chat/common/constants.js';

/**
 * Reference wrapper for ChatModel to support reference counting
 */
class ChatModelReference implements IChatModelReference {
	constructor(
		private model: ChatModel,
		private disposeCallback: () => void,
	) { }

	get object(): ChatModel {
		return this.model;
	}

	dispose(): void {
		this.disposeCallback();
	}
}

export class LeapfrogChatService extends Disposable implements IChatService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidSubmitRequest = this._register(new Emitter<{ readonly chatSessionResource: URI }>());
	readonly onDidSubmitRequest: Event<{ readonly chatSessionResource: URI }> = this._onDidSubmitRequest.event;

	private readonly _onDidCreateModel = this._register(new Emitter<ChatModel>());
	readonly onDidCreateModel: Event<ChatModel> = this._onDidCreateModel.event;

	private readonly _onDidPerformUserAction = this._register(new Emitter<IChatUserActionEvent>());
	readonly onDidPerformUserAction: Event<IChatUserActionEvent> = this._onDidPerformUserAction.event;

	private readonly _onDidReceiveQuestionCarouselAnswer = this._register(new Emitter<{ requestId: string; resolveId: string; answers: Record<string, unknown> | undefined }>());
	readonly onDidReceiveQuestionCarouselAnswer: Event<{ requestId: string; resolveId: string; answers: Record<string, unknown> | undefined }> = this._onDidReceiveQuestionCarouselAnswer.event;

	private readonly _onDidDisposeSession = this._register(new Emitter<{ readonly sessionResource: URI[]; readonly reason: 'cleared' }>());
	readonly onDidDisposeSession: Event<{ readonly sessionResource: URI[]; readonly reason: 'cleared' }> = this._onDidDisposeSession.event;

	private readonly _models = new Map<string, { model: ChatModel; refCount: number }>();
	private readonly _chatModelsObs = observableValue<Iterable<ChatModel>>('chatModels', []);
	readonly chatModels: IObservable<Iterable<ChatModel>> = this._chatModelsObs;

	private readonly _requestInProgressObs = observableValue<boolean>('requestInProgress', false);
	readonly requestInProgressObs: IObservable<boolean> = this._requestInProgressObs;

	private readonly _persistenceScheduler: RunOnceScheduler;
	private initialized = false;

	transferredSessionResource: URI | undefined;
	edits2Enabled = false;
	editingSessions: any[] = [];

	constructor(
		@ILeapfrogChatHistoryService private readonly historyService: ILeapfrogChatHistoryService,
		@ILogService private readonly logService: ILogService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();

		this._persistenceScheduler = this._register(new RunOnceScheduler(() => {
			this.persistAllModels().catch(err =>
				this.logService.error('[Leapfrog] Error persisting chat models:', err)
			);
		}, 1000));

		this.logService.info('[Leapfrog] Chat Service initialized');

		// Initialize sessions asynchronously
		this.initialize().catch(err =>
			this.logService.error('[Leapfrog] Error initializing chat sessions:', err)
		);
	}

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	async initialize(): Promise<void> {
		if (this.initialized) {
			return;
		}

		try {
			// Load all existing sessions from history service
			const sessions = await this.historyService.getSessions();
			const models: ChatModel[] = [];

			for (const session of sessions) {
				try {
					const model = this.createModelFromSession(session);
					this.registerModel(model);
					models.push(model);
					this._onDidCreateModel.fire(model);
				} catch (err) {
					this.logService.warn(`[Leapfrog] Failed to load session ${session.id}:`, err);
				}
			}

			// Update the observable with all loaded models
			(this._chatModelsObs as any).set(models as any);

			this.logService.info(`[Leapfrog] Chat Service initialized with ${models.length} sessions`);
		} catch (err) {
			this.logService.error('[Leapfrog] Error initializing chat service:', err);
		}

		this.initialized = true;
	}

	override dispose(): void {
		// Dispose all models
		for (const { model } of this._models.values()) {
			model.dispose();
		}
		this._models.clear();
		super.dispose();
	}

	// -----------------------------------------------------------------------
	// Session Management
	// -----------------------------------------------------------------------

	isEnabled(location: ChatAgentLocation): boolean {
		return location === ChatAgentLocation.Chat;
	}

	hasSessions(): boolean {
		return this._models.size > 0;
	}

	startSession(location: ChatAgentLocation, options?: IChatSessionStartOptions): IChatModelReference {
		// Create a new empty ChatModel for a new session
		const sessionId = this.generateSessionId();
		const sessionResource = URI.from({ scheme: 'vscode-chat', path: `/leapfrog/session/${sessionId}` });

		const model = this.instantiationService.createInstance(
			ChatModel,
			undefined, // dataRef - no existing data
			{
				initialLocation: location,
				canUseTools: options?.canUseTools ?? true,
				resource: sessionResource,
				sessionId,
				disableBackgroundKeepAlive: options?.disableBackgroundKeepAlive ?? false,
			}
		);

		this.registerModel(model);
		this._onDidCreateModel.fire(model);

		return this.createReference(sessionId);
	}

	getSession(sessionResource: URI): ChatModel | undefined {
		const sessionId = this.extractSessionIdFromUri(sessionResource);
		if (!sessionId) return undefined;

		return this._models.get(sessionId)?.model;
	}

	getActiveSessionReference(sessionResource: URI): IChatModelReference | undefined {
		const model = this.getSession(sessionResource);
		if (!model) return undefined;

		const sessionId = this.extractSessionIdFromUri(sessionResource);
		if (!sessionId) return undefined;

		return this.createReference(sessionId);
	}

	async getOrRestoreSession(sessionResource: URI): Promise<IChatModelReference | undefined> {
		const sessionId = this.extractSessionIdFromUri(sessionResource);
		if (!sessionId) return undefined;

		// Check if already loaded
		if (this._models.has(sessionId)) {
			return this.createReference(sessionId);
		}

		// Try to load from history
		try {
			const session = await this.historyService.getSession(sessionId);
			if (!session) return undefined;

			const model = this.createModelFromSession(session);
			this.registerModel(model);
			this._onDidCreateModel.fire(model);

			return this.createReference(sessionId);
		} catch (err) {
			this.logService.error(`[Leapfrog] Error restoring session ${sessionId}:`, err);
			return undefined;
		}
	}

	getSessionTitle(sessionResource: URI): string | undefined {
		const model = this.getSession(sessionResource);
		return model?.title;
	}

	loadSessionFromContent(data: unknown): IChatModelReference | undefined {
		// For future use - load from exported data
		// For now, not implemented as Leapfrog manages its own serialization
		return undefined;
	}

	async loadSessionForResource(resource: URI, location: ChatAgentLocation, _token: CancellationToken): Promise<IChatModelReference | undefined> {
		// Not applicable for Leapfrog
		return undefined;
	}

	getChatSessionFromInternalUri(sessionResource: URI): IChatSessionContext | undefined {
		const model = this.getSession(sessionResource);
		if (!model) return undefined;

		return {
			chatSessionType: 'leapfrog',
			chatSessionResource: sessionResource,
			isUntitled: false,
		};
	}

	async sendRequest(sessionResource: URI, message: string, options?: IChatSendRequestOptions): Promise<IChatSendRequestData | undefined> {
		const model = this.getSession(sessionResource);
		if (!model) {
			this.logService.warn(`[Leapfrog] sendRequest called on non-existent session: ${sessionResource}`);
			return undefined;
		}

		this._onDidSubmitRequest.fire({ chatSessionResource: sessionResource });
		(this._requestInProgressObs as any).set(true);

		try {
			// Create a user request in the model
			const request = (model as any).addRequest({
				text: message,
				parts: [],
				attempt: 0,
			});

			// Add the message to history for persistence
			const sessionId = this.extractSessionIdFromUri(sessionResource);
			if (sessionId) {
				const userMessage: ILeapfrogChatMessageData = {
					id: request.id,
					role: 'user',
					content: message,
					timestamp: Date.now(),
					attachments: [],
				};

				await this.historyService.addMessage(sessionId, userMessage);
			}

			return {} as IChatSendRequestData;
		} finally {
			(this._requestInProgressObs as any).set(false);
		}
	}

	setTitle(sessionResource: URI, title: string): void {
		const model = this.getSession(sessionResource);
		if (model) {
			(model as any).setCustomTitle(title);
		}
	}

	appendProgress(_request: unknown, _progress: IChatProgress): void {
		// VS Code handles this through the model's response
		// We just need to ensure persistence happens
		this._persistenceScheduler.schedule();
	}

	async resendRequest(_request: unknown, _options?: IChatSendRequestOptions): Promise<void> {
		// TODO: Implement resend logic
	}

	async adoptRequest(_sessionResource: URI, _request: unknown): Promise<void> {
		// Not applicable for Leapfrog
	}

	async removeRequest(sessionResource: URI, requestId: string): Promise<void> {
		const model = this.getSession(sessionResource);
		if (!model) return;

		// Remove from the model (VS Code API)
		(model as any).removeRequest(requestId);

		// Trigger persistence
		this._persistenceScheduler.schedule();
	}

	cancelCurrentRequestForSession(sessionResource: URI): void {
		const model = this.getSession(sessionResource);
		if (!model) return;

		(model as any).cancelRequest();
	}

	addCompleteRequest(
		sessionResource: URI,
		_message: unknown,
		_variableData: unknown,
		_attempt: unknown,
		_response: IChatCompleteResponse
	): void {
		const model = this.getSession(sessionResource);
		if (!model) return;

		// This is called when a complete exchange is added externally
		// For Leapfrog, we handle request/response through sendRequest
		// but this provides another integration point
	}

	setChatSessionTitle(sessionResource: URI, title: string): void {
		const sessionId = this.extractSessionIdFromUri(sessionResource);
		if (!sessionId) return;

		const model = this.getSession(sessionResource);
		if (model) {
			(model as any).setCustomTitle(title);
		}

		// Persist to history
		this.historyService.setSessionTitle(sessionId, title).catch(err =>
			this.logService.error('[Leapfrog] Error setting session title:', err)
		);
	}

	async getLocalSessionHistory(): Promise<IChatDetail[]> {
		// Return all available sessions as chat details
		try {
			const sessions = await this.historyService.getSessions();
			return sessions.map(s => {
				const sessionResource = URI.from({ scheme: 'vscode-chat', path: `/leapfrog/session/${s.id}` });
				return {
					sessionResource,
					title: s.title,
					isActive: false,
					isTemporary: false,
					createdAt: new Date(s.createdAt).getTime(),
					lastMessageDate: new Date(s.updatedAt).getTime(),
					timing: undefined,
					lastResponseState: undefined,
				} as unknown as IChatDetail;
			});
		} catch (err) {
			this.logService.error('[Leapfrog] Error getting session history:', err);
			return [];
		}
	}

	async clearAllHistoryEntries(): Promise<void> {
		// Dispose all models
		for (const [, { model }] of this._models) {
			model.dispose();
		}
		this._models.clear();
		this._updateChatModelsObservable();
	}

	async removeHistoryEntry(sessionResource: URI): Promise<void> {
		const sessionId = this.extractSessionIdFromUri(sessionResource);
		if (!sessionId) return;

		const entry = this._models.get(sessionId);
		if (entry) {
			entry.model.dispose();
			this._models.delete(sessionId);
		}

		// Remove from history
		await this.historyService.deleteSession(sessionId);
		this._updateChatModelsObservable();
	}

	getChatStorageFolder(): URI {
		// Return a URI representing where chat data is stored
		return URI.from({ scheme: 'vscode-chat', path: '/leapfrog/storage' });
	}

	logChatIndex(): void {
		// No-op for Leapfrog
	}

	async getLiveSessionItems(): Promise<IChatDetail[]> {
		// Return currently loaded models
		const items: IChatDetail[] = [];
		for (const [sessionId, { model }] of this._models) {
			const sessionResource = URI.from({ scheme: 'vscode-chat', path: `/leapfrog/session/${sessionId}` });
			items.push({
				sessionResource,
				title: model.title,
				isActive: false,
				isTemporary: false,
				createdAt: (model as any)._timestamp,
				lastMessageDate: (model as any).lastMessageDate,
				timing: undefined,
				lastResponseState: undefined,
			} as unknown as IChatDetail);
		}
		return items;
	}

	async getHistorySessionItems(): Promise<IChatDetail[]> {
		// Same as local session history for Leapfrog
		return this.getLocalSessionHistory();
	}

	async getMetadataForSession(sessionResource: URI): Promise<IChatDetail | undefined> {
		const sessionId = this.extractSessionIdFromUri(sessionResource);
		if (!sessionId) return undefined;

		const model = this.getSession(sessionResource);
		if (!model) {
			// Try to load from history
			try {
				const session = await this.historyService.getSession(sessionId);
				if (!session) return undefined;

				return {
					sessionResource,
					title: session.title,
					isActive: false,
					isTemporary: false,
					createdAt: new Date(session.createdAt).getTime(),
					lastMessageDate: new Date(session.updatedAt).getTime(),
					timing: undefined,
					lastResponseState: undefined,
				} as unknown as IChatDetail;
			} catch (err) {
				return undefined;
			}
		}

		return {
			sessionResource,
			title: model.title,
			isActive: false,
			isTemporary: false,
			createdAt: (model as any)._timestamp,
			lastMessageDate: (model as any).lastMessageDate,
			timing: undefined,
			lastResponseState: undefined,
		} as unknown as IChatDetail;
	}

	notifyUserAction(event: IChatUserActionEvent): void {
		this._onDidPerformUserAction.fire(event);
	}

	notifyQuestionCarouselAnswer(requestId: string, resolveId: string, answers: Record<string, unknown> | undefined): void {
		this._onDidReceiveQuestionCarouselAnswer.fire({ requestId, resolveId, answers });
	}

	async transferChatSession(transferredSessionResource: URI, toWorkspace: URI): Promise<void> {
		// Not applicable for Leapfrog
	}

	async activateDefaultAgent(location: ChatAgentLocation): Promise<void> {
		// No-op for Leapfrog
	}

	setSaveModelsEnabled(enabled: boolean): void {
		// No-op for Leapfrog
	}

	async waitForModelDisposals(): Promise<void> {
		// No-op for Leapfrog
	}

	// -----------------------------------------------------------------------
	// Private Helpers
	// -----------------------------------------------------------------------

	private generateSessionId(): string {
		// In real implementation, could use generateUuid() from base/common/uuid
		return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
	}

	private extractSessionIdFromUri(sessionResource: URI): string | undefined {
		// Parse vscode-chat://leapfrog/session/{id}
		if (sessionResource.scheme === 'vscode-chat') {
			const match = sessionResource.path.match(/\/session\/(.+)$/);
			if (match) return match[1];
		}

		// Also handle LocalChatSessionUri format
		const path = sessionResource.path;
		if (path.includes('/sessions/')) {
			const match = path.match(/\/sessions\/(.+)$/);
			if (match) return match[1];
		}

		return undefined;
	}

	private createModelFromSession(session: ILeapfrogChatSession): ChatModel {
		const sessionId = session.id;
		const sessionResource = URI.from({ scheme: 'vscode-chat', path: `/leapfrog/session/${sessionId}` });

		const model = this.instantiationService.createInstance(
			ChatModel,
			undefined,
			{
				initialLocation: ChatAgentLocation.Chat,
				canUseTools: true,
				resource: sessionResource,
				sessionId: sessionId,
			}
		);

		// Set title
		(model as any).setCustomTitle(session.title);

		// TODO: Populate requests and responses from stored messages
		// This requires understanding ChatModel's API for adding historical requests
		// For now, we'll populate dynamically when the model is used
		// The session data is preserved in ILeapfrogChatHistoryService

		return model;
	}

	private registerModel(model: ChatModel): void {
		const sessionId = model.sessionId;
		this._models.set(sessionId, { model, refCount: 0 });
		this._updateChatModelsObservable();

		// Listen for changes to schedule persistence
		this._register(model.onDidChange(() => {
			this._persistenceScheduler.schedule();
		}));
	}

	private createReference(sessionId: string): IChatModelReference {
		const entry = this._models.get(sessionId);
		if (!entry) {
			throw new Error(`Session ${sessionId} not found`);
		}

		entry.refCount++;

		return new ChatModelReference(entry.model, () => {
			entry.refCount--;
			// Don't dispose model when refCount reaches 0
			// Keep it in memory for the session lifetime
		});
	}

	private _updateChatModelsObservable(): void {
		const models = Array.from(this._models.values()).map(e => e.model);
		(this._chatModelsObs as any).set(models as any);
	}


	private async persistAllModels(): Promise<void> {
		const sessionId = Array.from(this._models.keys())[0];
		if (!sessionId) return;

		try {
			const model = this._models.get(sessionId)?.model;
			if (!model) return;

			// Convert model back to Leapfrog session format
			const session = this.convertModelToSession(model, sessionId);

			// Persist to history service
			await this.historyService.updateSession(sessionId, session);
		} catch (err) {
			this.logService.error('[Leapfrog] Error persisting chat models:', err);
		}
	}

	private convertModelToSession(model: ChatModel, _sessionId: string): Partial<ILeapfrogChatSession> {
		const messages: ILeapfrogChatMessageData[] = [];

		// Extract messages from model
		for (const request of (model as any)._requests || []) {
			messages.push({
				id: request.id,
				role: 'user',
				content: typeof request.message === 'string' ? request.message : request.message.text,
				timestamp: request.timestamp,
				attachments: request.attachedContext,
			});

			if (request.response) {
				const responseText = request.response.response?.toString() || '';
				messages.push({
					id: request.response.id,
					role: 'assistant',
					content: responseText,
					timestamp: request.response.timestamp,
					model: 'leapfrog-ai',
				});
			}
		}

		return {
			title: model.title,
			updatedAt: new Date().toISOString(),
			messages,
		};
	}
}
