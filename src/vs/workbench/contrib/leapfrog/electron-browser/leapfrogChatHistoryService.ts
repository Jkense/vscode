/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Desktop implementation of ILeapfrogChatHistoryService.
 *
 * Wraps LeapfrogChatJsonDatabase, keeps an in-memory cache of sessions,
 * and fires events on mutations so the chat view updates.
 */

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import {
	ILeapfrogChatHistoryService,
	ILeapfrogChatSession,
	ILeapfrogChatMessageData,
} from '../common/leapfrog.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { LeapfrogChatJsonDatabase } from './leapfrogChatJsonDatabase.js';

export class LeapfrogChatHistoryService extends Disposable implements ILeapfrogChatHistoryService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeSessions = this._register(new Emitter<void>());
	readonly onDidChangeSessions: Event<void> = this._onDidChangeSessions.event;

	private readonly db: LeapfrogChatJsonDatabase;

	/** Cached sessions - invalidated on writes */
	private cachedSessions: ILeapfrogChatSession[] | undefined;
	private initialized = false;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IFileService fileService: IFileService,
	) {
		super();
		this.db = this._register(new LeapfrogChatJsonDatabase(fileService));
	}

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	async initialize(projectPath: string): Promise<void> {
		if (this.initialized) {
			await this.close();
		}
		await this.db.open(projectPath);
		this.initialized = true;
		this.cachedSessions = undefined;
		this.logService.info('[Leapfrog] Chat history service initialized at', projectPath);
	}

	async close(): Promise<void> {
		await this.db.close();
		this.initialized = false;
		this.cachedSessions = undefined;
	}

	override dispose(): void {
		this.close().catch(err => this.logService.error('[Leapfrog] Error closing chat DB', err));
		super.dispose();
	}

	// -----------------------------------------------------------------------
	// Session CRUD
	// -----------------------------------------------------------------------

	async getSessions(): Promise<ILeapfrogChatSession[]> {
		if (!this.cachedSessions) {
			this.cachedSessions = await this.db.getAllSessions();
		}
		return this.cachedSessions;
	}

	async getSession(id: string): Promise<ILeapfrogChatSession | undefined> {
		return this.db.getSession(id);
	}

	async createSession(title?: string): Promise<ILeapfrogChatSession> {
		const session: ILeapfrogChatSession = {
			id: generateUuid(),
			title: title || 'New Chat',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			messages: [],
		};

		await this.db.insertSession(session);
		this.cachedSessions = undefined;
		this._onDidChangeSessions.fire();

		return session;
	}

	async updateSession(id: string, data: Partial<ILeapfrogChatSession>): Promise<void> {
		await this.db.updateSession(id, {
			...data,
			updatedAt: new Date().toISOString(),
		});
		this.cachedSessions = undefined;
		this._onDidChangeSessions.fire();
	}

	async deleteSession(id: string): Promise<void> {
		await this.db.deleteSession(id);
		this.cachedSessions = undefined;
		this._onDidChangeSessions.fire();
	}

	// -----------------------------------------------------------------------
	// Message operations
	// -----------------------------------------------------------------------

	async addMessage(sessionId: string, message: ILeapfrogChatMessageData): Promise<void> {
		await this.db.addMessage(sessionId, message);
		this.cachedSessions = undefined;
		this._onDidChangeSessions.fire();
	}

	async updateMessage(sessionId: string, messageId: string, content: string): Promise<void> {
		await this.db.updateMessage(sessionId, messageId, content);
		this.cachedSessions = undefined;
		this._onDidChangeSessions.fire();
	}

	// -----------------------------------------------------------------------
	// Utility
	// -----------------------------------------------------------------------

	async setSessionTitle(sessionId: string, title: string): Promise<void> {
		await this.updateSession(sessionId, { title });
	}

	async generateSessionTitle(sessionId: string): Promise<string> {
		const session = await this.getSession(sessionId);
		if (!session) {
			return 'New Chat';
		}

		// Find the first user message
		const userMessage = session.messages.find(m => m.role === 'user');
		if (!userMessage) {
			return 'New Chat';
		}

		// Generate title from first 50 chars of first user message
		const title = userMessage.content.substring(0, 50).trim();
		if (title.length === 50) {
			return title + '...';
		}
		return title || 'New Chat';
	}
}
