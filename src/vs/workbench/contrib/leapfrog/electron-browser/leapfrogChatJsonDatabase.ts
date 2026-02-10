/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * JSON-file-backed database for Leapfrog chat history.
 *
 * All data lives in memory; writes are debounced to `.leapfrog/chat.json`
 * via IFileService (which works in the renderer via DI).
 */

import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { joinPath } from '../../../../base/common/resources.js';
import { ILeapfrogChatSession, ILeapfrogChatMessageData } from '../common/leapfrog.js';

// ---------------------------------------------------------------------------
// Internal store shape
// ---------------------------------------------------------------------------

interface ILeapfrogChatStore {
	version: number;
	sessions: ILeapfrogChatSession[];
}

// ---------------------------------------------------------------------------
// Database wrapper
// ---------------------------------------------------------------------------

export class LeapfrogChatJsonDatabase extends Disposable {

	private store: ILeapfrogChatStore | undefined;
	private fileUri: URI | undefined;
	private dirty = false;

	private readonly saveScheduler = this._register(new RunOnceScheduler(() => this.flush(), 500));

	constructor(
		private readonly fileService: IFileService,
	) {
		super();
	}

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	async open(projectPath: string): Promise<void> {
		const projectUri = URI.file(projectPath);
		const leapfrogDir = joinPath(projectUri, '.leapfrog');
		this.fileUri = joinPath(leapfrogDir, 'chat.json');

		try {
			const content = await this.fileService.readFile(this.fileUri);
			this.store = JSON.parse(content.value.toString());
		} catch {
			// File doesn't exist or is invalid - start fresh
			this.store = { version: 1, sessions: [] };
			try {
				await this.fileService.createFolder(leapfrogDir);
			} catch {
				// Folder may already exist
			}
			await this.flush();
		}
	}

	async close(): Promise<void> {
		if (this.dirty) {
			this.saveScheduler.cancel();
			await this.flush();
		}
		this.store = undefined;
		this.fileUri = undefined;
	}

	private get data(): ILeapfrogChatStore {
		if (!this.store) {
			throw new Error('Database not open');
		}
		return this.store;
	}

	// -----------------------------------------------------------------------
	// Persistence
	// -----------------------------------------------------------------------

	private async flush(): Promise<void> {
		if (!this.store || !this.fileUri) {
			return;
		}
		const json = JSON.stringify(this.store, null, '\t');
		await this.fileService.writeFile(this.fileUri, VSBuffer.fromString(json));
		this.dirty = false;
	}

	private scheduleSave(): void {
		this.dirty = true;
		this.saveScheduler.schedule();
	}

	// -----------------------------------------------------------------------
	// Session CRUD
	// -----------------------------------------------------------------------

	async getAllSessions(): Promise<ILeapfrogChatSession[]> {
		// Return in reverse order (most recent first)
		return this.data.sessions
			.slice()
			.reverse();
	}

	async getSession(id: string): Promise<ILeapfrogChatSession | undefined> {
		return this.data.sessions.find(s => s.id === id);
	}

	async insertSession(session: ILeapfrogChatSession): Promise<void> {
		this.data.sessions.push(session);
		this.scheduleSave();
	}

	async updateSession(id: string, data: Partial<ILeapfrogChatSession>): Promise<void> {
		const session = this.data.sessions.find(s => s.id === id);
		if (!session) {
			return;
		}

		if (data.title !== undefined) { session.title = data.title; }
		if (data.messages !== undefined) { session.messages = data.messages; }
		if (data.model !== undefined) { session.model = data.model; }
		if (data.updatedAt !== undefined) { session.updatedAt = data.updatedAt; }

		this.scheduleSave();
	}

	async deleteSession(id: string): Promise<void> {
		this.data.sessions = this.data.sessions.filter(s => s.id !== id);
		this.scheduleSave();
	}

	// -----------------------------------------------------------------------
	// Message operations
	// -----------------------------------------------------------------------

	async addMessage(sessionId: string, message: ILeapfrogChatMessageData): Promise<void> {
		const session = this.data.sessions.find(s => s.id === sessionId);
		if (!session) {
			return;
		}

		session.messages.push(message);
		session.updatedAt = new Date().toISOString();
		this.scheduleSave();
	}

	async updateMessage(sessionId: string, messageId: string, content: string): Promise<void> {
		const session = this.data.sessions.find(s => s.id === sessionId);
		if (!session) {
			return;
		}

		const message = session.messages.find(m => m.id === messageId);
		if (!message) {
			return;
		}

		message.content = content;
		session.updatedAt = new Date().toISOString();
		this.scheduleSave();
	}
}
