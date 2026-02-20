/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Leapfrog Sync Service - syncs indexed chunks with backend using Merkle tree.
 * Computes Merkle tree, compares with backend, syncs only changed files.
 */

import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { type MerkleTree } from './leapfrogMerkleTree.js';
import { LeapfrogIndexJsonDatabase, type IIndexedChunkRow } from './leapfrogIndexJsonDatabase.js';
import type { ChunkSyncPayload, ILeapfrogIndexChunk } from '../common/leapfrog.js';

function getIndexingApiBase(): string {
	try {
		if (typeof globalThis !== 'undefined' && (globalThis as { process?: { env?: Record<string, string> } }).process?.env) {
			const env = (globalThis as { process: { env: Record<string, string> } }).process.env;
			return env.INDEXING_SERVICE_URL ?? env.NEXT_PUBLIC_API_URL ?? 'https://leapfrogapp.com';
		}
	} catch {
		// process not available (e.g. in sandboxed renderer)
	}
	return 'https://leapfrogapp.com';
}

export interface SyncResult {
	inserted: number;
	updated: number;
	deleted: number;
}

export interface ILeapfrogSyncService {
	getAuthToken(): Promise<string | undefined>;
	syncChangedChunks(projectId: string, changedFiles: ChunkSyncPayload[]): Promise<SyncResult>;
	fetchRemoteMerkleTree(projectId: string): Promise<MerkleTree | null>;
}

export class LeapfrogSyncService {

	constructor(
		_fileService: IFileService,
		private readonly logService: ILogService,
		private getAuthToken?: () => Promise<string | undefined>,
	) { }

	/**
	 * Convert DB row to API chunk format.
	 */
	private rowToChunk(row: IIndexedChunkRow): ILeapfrogIndexChunk {
		return {
			id: row.id,
			filePath: row.file_path,
			chunkType: row.chunk_type as ILeapfrogIndexChunk['chunkType'],
			content: row.content,
			startOffset: row.start_offset,
			endOffset: row.end_offset,
			headingPath: row.heading_path ?? undefined,
			speaker: row.speaker ?? undefined,
			startTime: row.start_time ?? undefined,
			endTime: row.end_time ?? undefined,
		};
	}

	/**
	 * Convert full path to relative path for cross-machine consistency.
	 */
	toRelativePath(projectPath: string, fullPath: string): string {
		const normalizedProject = projectPath.replace(/\\/g, '/').replace(/\/$/, '');
		const normalizedFull = fullPath.replace(/\\/g, '/');
		if (normalizedFull.startsWith(normalizedProject + '/')) {
			return normalizedFull.slice(normalizedProject.length + 1);
		}
		return fullPath;
	}

	/**
	 * Build ChunkSyncPayload[] for changed files from local DB.
	 * Uses relative paths for cross-machine consistency.
	 */
	buildChunkPayloads(
		projectPath: string,
		db: LeapfrogIndexJsonDatabase,
		changedPaths: Array<{ path: string; changeType: 'added' | 'modified' | 'removed'; hash?: string }>,
	): ChunkSyncPayload[] {
		const payloads: ChunkSyncPayload[] = [];

		for (const { path, changeType, hash } of changedPaths) {
			const relPath = this.toRelativePath(projectPath, path);
			if (changeType === 'removed') {
				payloads.push({ filePath: relPath, chunks: [] });
				continue;
			}

			const rows = db.getChunksForFile(path);
			const chunks = rows.map(r => {
				const c = this.rowToChunk(r);
				c.filePath = this.toRelativePath(projectPath, c.filePath);
				return c;
			});
			const fileHash = db.getFileHash(path)?.hash ?? hash;

			payloads.push({
				filePath: relPath,
				chunks,
				fileHash,
			});
		}

		return payloads;
	}

	/**
	 * Ensure project exists on backend (creates org + project if missing).
	 */
	async ensureProject(projectId: string, name?: string): Promise<void> {
		const token = this.getAuthToken ? await this.getAuthToken() : undefined;
		const url = `${getIndexingApiBase()}/api/indexing/projects/ensure`;

		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};
		if (token) {
			headers['Authorization'] = `Bearer ${token}`;
		}

		const res = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify({ projectId, name: name ?? 'Workspace' }),
		});

		if (!res.ok) {
			const text = await res.text();
			this.logService.warn('[Leapfrog] ensureProject failed:', res.status, text);
			throw new Error(`Failed to ensure project: ${res.status}`);
		}
	}

	/**
	 * Fetch remote Merkle tree from backend.
	 */
	async fetchRemoteMerkleTree(projectId: string): Promise<MerkleTree | null> {
		const token = this.getAuthToken ? await this.getAuthToken() : undefined;
		const url = `${getIndexingApiBase()}/api/indexing/projects/${projectId}/merkle`;

		try {
			const headers: Record<string, string> = {}; // TODO: add Authorization when auth is wired
			if (token) {
				headers['Authorization'] = `Bearer ${token}`;
			}

			const res = await fetch(url, { headers });
			if (!res.ok) {
				if (res.status === 404) return null;
				throw new Error(`Failed to fetch Merkle tree: ${res.status}`);
			}

			const data = await res.json();
			if (data.error) return null;
			return data as MerkleTree;
		} catch (err) {
			this.logService.warn('[Leapfrog] Failed to fetch remote Merkle tree:', err);
			return null;
		}
	}

	/**
	 * Get user-friendly error message for sync failures.
	 */
	static getSyncErrorMessage(err: unknown): string {
		if (err instanceof TypeError && err.message.includes('fetch')) {
			return 'Failed to sync. Check your connection.';
		}
		if (err instanceof Error) {
			return err.message;
		}
		return 'An unexpected error occurred. Please try again.';
	}

	/**
	 * Sync changed chunks to backend.
	 */
	async syncChangedChunks(
		projectId: string,
		merkleTree: MerkleTree,
		changedFiles: ChunkSyncPayload[],
	): Promise<SyncResult> {
		const token = this.getAuthToken ? await this.getAuthToken() : undefined;
		const url = `${getIndexingApiBase()}/api/indexing/projects/${projectId}/chunks`;

		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};
		if (token) {
			headers['Authorization'] = `Bearer ${token}`;
		}

		const res = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				merkleTree,
				changedFiles,
			}),
		});

		if (!res.ok) {
			const text = await res.text();
			if (res.status === 409) {
				throw new Error('File changed during sync. Please try again.');
			}
			if (res.status === 429) {
				throw new Error('Rate limit exceeded. Please try again later.');
			}
			if (res.status >= 500) {
				throw new Error('Server error. Please try again later.');
			}
			if (res.status === 401 || res.status === 403) {
				throw new Error('Authentication failed. Please sign in again.');
			}
			throw new Error(text || `Sync failed: ${res.status}`);
		}

		return res.json() as Promise<SyncResult>;
	}

	/**
	 * Trigger indexing on backend.
	 */
	async triggerIndex(projectId: string, filePaths?: string[]): Promise<{ jobId: string }> {
		const token = this.getAuthToken ? await this.getAuthToken() : undefined;
		const url = `${getIndexingApiBase()}/api/indexing/projects/${projectId}/index`;

		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};
		if (token) {
			headers['Authorization'] = `Bearer ${token}`;
		}

		const res = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify({ filePaths: filePaths ?? [] }),
		});

		if (!res.ok) {
			const text = await res.text();
			throw new Error(`Trigger index failed: ${res.status} ${text}`);
		}

		return res.json() as Promise<{ jobId: string }>;
	}

	/**
	 * Get indexing status from backend.
	 */
	async getStatus(projectId: string): Promise<{
		status: string;
		progress: number;
		totalFiles: number;
		indexedFiles: number;
		totalChunks: number;
	}> {
		const token = this.getAuthToken ? await this.getAuthToken() : undefined;
		const url = `${getIndexingApiBase()}/api/indexing/projects/${projectId}/status`;

		const headers: Record<string, string> = {};
		if (token) {
			headers['Authorization'] = `Bearer ${token}`;
		}

		const res = await fetch(url, { headers });
		if (!res.ok) {
			throw new Error(`Status fetch failed: ${res.status}`);
		}

		return res.json();
	}
}
