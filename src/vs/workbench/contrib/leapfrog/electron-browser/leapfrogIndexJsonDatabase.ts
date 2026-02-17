/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * JSON-file-backed database for Leapfrog semantic index data.
 *
 * All data lives in memory; writes are debounced to `.leapfrog/index.json`
 * via IFileService. Stores document chunks and their embedding vectors.
 */

import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { joinPath } from '../../../../base/common/resources.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IIndexedChunkRow {
	id: string;
	file_path: string;
	chunk_type: 'markdown_heading' | 'transcript_speaker_turn' | 'plaintext_paragraph';
	content: string;
	start_offset: number;
	end_offset: number;
	heading_path: string | null;
	speaker: string | null;
	start_time: number | null;
	end_time: number | null;
	created_at: string;
}

export interface IFileHashRow {
	hash: string;
	modified_at: string;
	chunk_count: number;
}

// ---------------------------------------------------------------------------
// Internal store shape
// ---------------------------------------------------------------------------

interface ILeapfrogIndexStore {
	version: number;
	file_hashes: Record<string, IFileHashRow>;
	chunks: IIndexedChunkRow[];
	embeddings: Record<string, number[]>; // chunkId → float32 vector
}

// ---------------------------------------------------------------------------
// Database wrapper
// ---------------------------------------------------------------------------

export class LeapfrogIndexJsonDatabase extends Disposable {

	private store: ILeapfrogIndexStore | undefined;
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
		this.fileUri = joinPath(leapfrogDir, 'index.json');

		try {
			const content = await this.fileService.readFile(this.fileUri);
			this.store = JSON.parse(content.value.toString());
		} catch {
			// File doesn't exist or is invalid - start fresh
			this.store = { version: 1, file_hashes: {}, chunks: [], embeddings: {} };
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

	private get data(): ILeapfrogIndexStore {
		if (!this.store) {
			throw new Error('Index database not open');
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
	// File Hashes (for incremental indexing)
	// -----------------------------------------------------------------------

	getFileHash(filePath: string): IFileHashRow | undefined {
		return this.data.file_hashes[filePath];
	}

	getAllFileHashes(): Record<string, IFileHashRow> {
		return { ...this.data.file_hashes };
	}

	setFileHash(filePath: string, hash: string, chunkCount: number): void {
		this.data.file_hashes[filePath] = {
			hash,
			modified_at: new Date().toISOString(),
			chunk_count: chunkCount,
		};
		this.scheduleSave();
	}

	removeFileHash(filePath: string): void {
		delete this.data.file_hashes[filePath];
		this.scheduleSave();
	}

	// -----------------------------------------------------------------------
	// Chunk CRUD
	// -----------------------------------------------------------------------

	getAllChunks(): IIndexedChunkRow[] {
		return this.data.chunks;
	}

	getChunksForFile(filePath: string): IIndexedChunkRow[] {
		return this.data.chunks.filter(c => c.file_path === filePath);
	}

	insertChunks(chunks: IIndexedChunkRow[]): void {
		this.data.chunks.push(...chunks);
		this.scheduleSave();
	}

	removeChunksForFile(filePath: string): string[] {
		const removed: string[] = [];
		this.data.chunks = this.data.chunks.filter(c => {
			if (c.file_path === filePath) {
				removed.push(c.id);
				return false;
			}
			return true;
		});
		// Also remove associated embeddings
		for (const id of removed) {
			delete this.data.embeddings[id];
		}
		this.scheduleSave();
		return removed;
	}

	// -----------------------------------------------------------------------
	// Embedding CRUD
	// -----------------------------------------------------------------------

	getEmbedding(chunkId: string): number[] | undefined {
		return this.data.embeddings[chunkId];
	}

	getAllEmbeddings(): Record<string, number[]> {
		return this.data.embeddings;
	}

	setEmbeddings(embeddings: Record<string, number[]>): void {
		Object.assign(this.data.embeddings, embeddings);
		this.scheduleSave();
	}

	getChunksWithoutEmbeddings(): IIndexedChunkRow[] {
		return this.data.chunks.filter(c => !this.data.embeddings[c.id]);
	}

	getEmbeddingCount(): number {
		return Object.keys(this.data.embeddings).length;
	}

	getChunkCount(): number {
		return this.data.chunks.length;
	}
}
