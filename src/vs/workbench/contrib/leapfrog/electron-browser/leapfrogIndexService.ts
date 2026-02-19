/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Leapfrog Index Service - semantic search over research project files.
 *
 * Orchestrates:
 *  1. File scanning & hash-based change detection
 *  2. Document chunking (markdown/transcript/plain text)
 *  3. Embedding generation via OpenAI
 *  4. Cosine-similarity search
 *
 * All data stored locally in `.leapfrog/index.json`.
 */

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
// import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import {
	ILeapfrogIndexService,
	ILeapfrogIndexProgress,
	ILeapfrogIndexChunk,
	ILeapfrogSearchResult,
	ILeapfrogSearchOptions,
	ILeapfrogApiKeyService,
} from '../common/leapfrog.js';
import { LeapfrogIndexJsonDatabase, type IIndexedChunkRow } from './leapfrogIndexJsonDatabase.js';
import { LeapfrogEmbeddingService, type IEmbeddingRequest } from './leapfrogEmbeddingService.js';
import { chunkFile } from './leapfrogChunker.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** File extensions to index */
const INDEXABLE_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.transcript.json']);

/** Files/folders to skip */
const IGNORE_PATTERNS = new Set(['.leapfrog', '.git', '.vscode', 'node_modules', '.DS_Store']);

/** Number of files to process per event loop tick during chunking */
const CHUNK_BATCH_SIZE = 10;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class LeapfrogIndexService extends Disposable implements ILeapfrogIndexService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeIndexProgress = this._register(new Emitter<ILeapfrogIndexProgress>());
	readonly onDidChangeIndexProgress: Event<ILeapfrogIndexProgress> = this._onDidChangeIndexProgress.event;

	private readonly _onDidIndexComplete = this._register(new Emitter<void>());
	readonly onDidIndexComplete: Event<void> = this._onDidIndexComplete.event;

	private readonly db: LeapfrogIndexJsonDatabase;
	private readonly embeddingService: LeapfrogEmbeddingService;

	private projectPath: string | undefined;
	private initialized = false;
	private indexingCts: CancellationTokenSource | undefined;

	private progress: ILeapfrogIndexProgress = {
		status: 'idle',
		totalFiles: 0,
		processedFiles: 0,
		totalChunks: 0,
		embeddedChunks: 0,
	};

	constructor(
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService,
		@ILeapfrogApiKeyService apiKeyService: ILeapfrogApiKeyService,
	) {
		super();
		this.db = this._register(new LeapfrogIndexJsonDatabase(fileService));
		this.embeddingService = new LeapfrogEmbeddingService(apiKeyService, logService);
	}

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	async initialize(projectPath: string): Promise<void> {
		if (this.initialized) {
			await this.close();
		}

		this.projectPath = projectPath;
		await this.db.open(projectPath);
		this.initialized = true;

		// Update progress from stored data
		this.progress = {
			...this.progress,
			status: this.db.getEmbeddingCount() > 0 ? 'ready' : 'idle',
			totalChunks: this.db.getChunkCount(),
			embeddedChunks: this.db.getEmbeddingCount(),
		};

		this.logService.info('[Leapfrog] Index service initialized at', projectPath);

		// Auto-index on startup
		this.indexWorkspace().catch(err => {
			this.logService.error('[Leapfrog] Auto-index failed:', err);
		});
	}

	async close(): Promise<void> {
		this.cancelIndexing();
		await this.db.close();
		this.initialized = false;
		this.projectPath = undefined;
	}

	override dispose(): void {
		this.close().catch(err => this.logService.error('[Leapfrog] Error closing index service', err));
		super.dispose();
	}

	// -----------------------------------------------------------------------
	// Progress
	// -----------------------------------------------------------------------

	getProgress(): ILeapfrogIndexProgress {
		return { ...this.progress };
	}

	isReady(): boolean {
		return this.progress.status === 'ready';
	}

	private updateProgress(update: Partial<ILeapfrogIndexProgress>): void {
		this.progress = { ...this.progress, ...update };
		this._onDidChangeIndexProgress.fire(this.progress);
	}

	// -----------------------------------------------------------------------
	// Indexing
	// -----------------------------------------------------------------------

	async indexWorkspace(): Promise<void> {
		if (!this.initialized || !this.projectPath) {
			return;
		}

		// Cancel any in-progress indexing
		this.cancelIndexing();
		this.indexingCts = new CancellationTokenSource();
		const token = this.indexingCts.token;

		try {
			// Phase 1: Scan files
			this.updateProgress({ status: 'scanning', processedFiles: 0 });
			const files = await this.scanWorkspace(this.projectPath);
			this.updateProgress({ totalFiles: files.length });

			if (token.isCancellationRequested) { return; }

			// Phase 2: Detect changes (hash comparison)
			const storedHashes = this.db.getAllFileHashes();
			const currentPaths = new Set(files.map(f => f.path));

			const toIndex: { path: string; content: string }[] = [];
			const toRemove: string[] = [];

			// Find deleted files
			for (const storedPath of Object.keys(storedHashes)) {
				if (!currentPaths.has(storedPath)) {
					toRemove.push(storedPath);
				}
			}

			// Check new/changed files
			for (const file of files) {
				if (token.isCancellationRequested) { return; }

				const hash = await this.hashContent(file.content);
				const stored = storedHashes[file.path];

				if (!stored || stored.hash !== hash) {
					toIndex.push(file);
				}
			}

			this.logService.info(`[Leapfrog] Index scan: ${toIndex.length} to index, ${toRemove.length} to remove, ${files.length - toIndex.length} unchanged`);

			// Phase 3: Remove deleted files
			for (const path of toRemove) {
				this.db.removeChunksForFile(path);
				this.db.removeFileHash(path);
			}

			if (toIndex.length === 0) {
				this.updateProgress({
					status: 'ready',
					totalChunks: this.db.getChunkCount(),
					embeddedChunks: this.db.getEmbeddingCount(),
				});
				this._onDidIndexComplete.fire();
				return;
			}

			// Phase 4: Chunk new/changed files
			this.updateProgress({ status: 'chunking', processedFiles: 0 });
			const allNewChunks: ILeapfrogIndexChunk[] = [];

			for (let i = 0; i < toIndex.length; i += CHUNK_BATCH_SIZE) {
				if (token.isCancellationRequested) { return; }

				const batch = toIndex.slice(i, i + CHUNK_BATCH_SIZE);
				for (const file of batch) {
					// Remove old chunks for this file first
					this.db.removeChunksForFile(file.path);

					// Generate new chunks
					const chunks = chunkFile(file.path, file.content);
					allNewChunks.push(...chunks);

					// Convert to DB rows and insert
					const rows: IIndexedChunkRow[] = chunks.map(c => ({
						id: c.id,
						file_path: c.filePath,
						chunk_type: c.chunkType,
						content: c.content,
						start_offset: c.startOffset,
						end_offset: c.endOffset,
						heading_path: c.headingPath ?? null,
						speaker: c.speaker ?? null,
						start_time: c.startTime ?? null,
						end_time: c.endTime ?? null,
						created_at: new Date().toISOString(),
					}));
					this.db.insertChunks(rows);

					// Update file hash
					const hash = await this.hashContent(file.content);
					this.db.setFileHash(file.path, hash, chunks.length);
				}

				this.updateProgress({
					processedFiles: Math.min(i + CHUNK_BATCH_SIZE, toIndex.length),
					totalChunks: this.db.getChunkCount(),
					currentFile: batch[batch.length - 1]?.path,
				});

				// Yield to event loop
				await this.yieldTick();
			}

			// Phase 5: Embed new chunks
			const unembedded = this.db.getChunksWithoutEmbeddings();
			if (unembedded.length > 0) {
				this.updateProgress({ status: 'embedding', embeddedChunks: 0, totalChunks: this.db.getChunkCount() });

				const requests: IEmbeddingRequest[] = unembedded.map(c => ({
					id: c.id,
					text: c.content,
				}));

				const result = await this.embeddingService.embedChunks(
					requests,
					(embedded, total) => {
						this.updateProgress({ embeddedChunks: embedded, totalChunks: total });
					},
					token,
				);

				// Store successful embeddings
				if (Object.keys(result.embeddings).length > 0) {
					this.db.setEmbeddings(result.embeddings);
				}

				if (result.failed.length > 0) {
					this.logService.warn(`[Leapfrog] ${result.failed.length} chunks failed to embed`);
				}
			}

			// Done
			this.updateProgress({
				status: 'ready',
				totalChunks: this.db.getChunkCount(),
				embeddedChunks: this.db.getEmbeddingCount(),
				currentFile: undefined,
			});
			this._onDidIndexComplete.fire();

			this.logService.info(`[Leapfrog] Indexing complete: ${this.db.getChunkCount()} chunks, ${this.db.getEmbeddingCount()} embeddings`);

		} catch (err) {
			this.logService.error('[Leapfrog] Indexing error:', err);
			this.updateProgress({
				status: 'error',
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	async indexFile(filePath: string): Promise<void> {
		if (!this.initialized || !this.projectPath) {
			return;
		}

		if (!this.isIndexableFile(filePath)) {
			return;
		}

		try {
			const uri = URI.file(filePath);
			const fileContent = await this.fileService.readFile(uri);
			const content = fileContent.value.toString();

			// Remove old chunks
			this.db.removeChunksForFile(filePath);

			// Re-chunk
			const chunks = chunkFile(filePath, content);
			const rows: IIndexedChunkRow[] = chunks.map(c => ({
				id: c.id,
				file_path: c.filePath,
				chunk_type: c.chunkType,
				content: c.content,
				start_offset: c.startOffset,
				end_offset: c.endOffset,
				heading_path: c.headingPath ?? null,
				speaker: c.speaker ?? null,
				start_time: c.startTime ?? null,
				end_time: c.endTime ?? null,
				created_at: new Date().toISOString(),
			}));
			this.db.insertChunks(rows);

			// Update hash
			const hash = await this.hashContent(content);
			this.db.setFileHash(filePath, hash, chunks.length);

			// Re-embed the new chunks
			const requests: IEmbeddingRequest[] = chunks.map(c => ({ id: c.id, text: c.content }));
			const result = await this.embeddingService.embedChunks(requests);
			if (Object.keys(result.embeddings).length > 0) {
				this.db.setEmbeddings(result.embeddings);
			}

			this.updateProgress({
				totalChunks: this.db.getChunkCount(),
				embeddedChunks: this.db.getEmbeddingCount(),
			});

			this.logService.info(`[Leapfrog] Re-indexed file: ${filePath} (${chunks.length} chunks)`);
		} catch (err) {
			this.logService.error(`[Leapfrog] Failed to index file: ${filePath}`, err);
		}
	}

	async removeFile(filePath: string): Promise<void> {
		if (!this.initialized) {
			return;
		}

		this.db.removeChunksForFile(filePath);
		this.db.removeFileHash(filePath);

		this.updateProgress({
			totalChunks: this.db.getChunkCount(),
			embeddedChunks: this.db.getEmbeddingCount(),
		});

		this.logService.info(`[Leapfrog] Removed file from index: ${filePath}`);
	}

	// -----------------------------------------------------------------------
	// Search
	// -----------------------------------------------------------------------

	async search(query: string, options?: ILeapfrogSearchOptions): Promise<ILeapfrogSearchResult[]> {
		if (!this.initialized) {
			return [];
		}

		const limit = options?.limit ?? 10;
		const minScore = options?.minScore ?? 0.3;
		const fileTypes = options?.fileTypes;

		// Try semantic search first
		const queryEmbedding = await this.embeddingService.embedQuery(query);
		if (queryEmbedding) {
			return this.semanticSearch(queryEmbedding, limit, minScore, fileTypes);
		}

		// Fallback to keyword search
		return this.keywordSearch(query, limit, fileTypes);
	}

	private semanticSearch(
		queryEmbedding: number[],
		limit: number,
		minScore: number,
		fileTypes?: string[],
	): ILeapfrogSearchResult[] {
		const chunks = this.db.getAllChunks();
		const embeddings = this.db.getAllEmbeddings();

		const scored: ILeapfrogSearchResult[] = [];

		for (const chunk of chunks) {
			const embedding = embeddings[chunk.id];
			if (!embedding) {
				continue;
			}

			// Filter by file type if specified
			if (fileTypes && fileTypes.length > 0) {
				const ext = '.' + (chunk.file_path.split('.').pop() ?? '');
				if (!fileTypes.includes(ext)) {
					continue;
				}
			}

			const score = cosineSimilarity(queryEmbedding, embedding);
			if (score >= minScore) {
				scored.push({
					chunk: rowToChunk(chunk),
					score,
				});
			}
		}

		// Sort by score descending and take top-K
		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, limit);
	}

	private keywordSearch(
		query: string,
		limit: number,
		fileTypes?: string[],
	): ILeapfrogSearchResult[] {
		const chunks = this.db.getAllChunks();
		const queryLower = query.toLowerCase();
		const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2);

		const scored: ILeapfrogSearchResult[] = [];

		for (const chunk of chunks) {
			// Filter by file type
			if (fileTypes && fileTypes.length > 0) {
				const ext = '.' + (chunk.file_path.split('.').pop() ?? '');
				if (!fileTypes.includes(ext)) {
					continue;
				}
			}

			const contentLower = chunk.content.toLowerCase();
			let matchCount = 0;
			for (const term of queryTerms) {
				if (contentLower.includes(term)) {
					matchCount++;
				}
			}

			if (matchCount > 0) {
				const score = matchCount / queryTerms.length;
				scored.push({
					chunk: rowToChunk(chunk),
					score,
				});
			}
		}

		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, limit);
	}

	// -----------------------------------------------------------------------
	// File scanning
	// -----------------------------------------------------------------------

	private async scanWorkspace(projectPath: string): Promise<{ path: string; content: string }[]> {
		const files: { path: string; content: string }[] = [];
		await this.scanDirectory(URI.file(projectPath), files);
		return files;
	}

	private async scanDirectory(dirUri: URI, results: { path: string; content: string }[]): Promise<void> {
		try {
			const entries = await this.fileService.resolve(dirUri);
			if (!entries.children) {
				return;
			}

			for (const child of entries.children) {
				const name = child.name;

				// Skip ignored patterns
				if (IGNORE_PATTERNS.has(name)) {
					continue;
				}

				if (child.isDirectory) {
					await this.scanDirectory(child.resource, results);
				} else if (this.isIndexableFile(child.resource.fsPath)) {
					try {
						const content = await this.fileService.readFile(child.resource);
						results.push({
							path: child.resource.fsPath,
							content: content.value.toString(),
						});
					} catch {
						// Skip files that can't be read
					}
				}
			}
		} catch {
			// Directory doesn't exist or can't be read
		}
	}

	private isIndexableFile(filePath: string): boolean {
		const lower = filePath.toLowerCase();
		if (lower.endsWith('.transcript.json')) {
			return true;
		}
		const ext = '.' + (lower.split('.').pop() ?? '');
		return INDEXABLE_EXTENSIONS.has(ext);
	}

	// -----------------------------------------------------------------------
	// Utilities
	// -----------------------------------------------------------------------

	private async hashContent(content: string): Promise<string> {
		const encoder = new TextEncoder();
		const data = encoder.encode(content);
		const hashBuffer = await crypto.subtle.digest('SHA-256', data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
	}

	private cancelIndexing(): void {
		if (this.indexingCts) {
			this.indexingCts.cancel();
			this.indexingCts.dispose();
			this.indexingCts = undefined;
		}
	}

	private yieldTick(): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, 0));
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i]! * b[i]!;
		normA += a[i]! * a[i]!;
		normB += b[i]! * b[i]!;
	}
	if (normA === 0 || normB === 0) {
		return 0;
	}
	return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function rowToChunk(row: IIndexedChunkRow): ILeapfrogIndexChunk {
	return {
		id: row.id,
		filePath: row.file_path,
		chunkType: row.chunk_type,
		content: row.content,
		startOffset: row.start_offset,
		endOffset: row.end_offset,
		headingPath: row.heading_path ?? undefined,
		speaker: row.speaker ?? undefined,
		startTime: row.start_time ?? undefined,
		endTime: row.end_time ?? undefined,
	};
}
