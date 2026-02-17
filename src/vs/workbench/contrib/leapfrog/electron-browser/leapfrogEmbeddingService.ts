/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Embedding service for Leapfrog semantic search.
 *
 * Generates embeddings via OpenAI's text-embedding-3-small model (1536 dimensions).
 * Uses the OpenAI SDK when available, with HTTP fallback.
 * Batches requests (up to 100 per call) with rate limiting and retry logic.
 */

import { ILogService } from '../../../../platform/log/common/log.js';
import { ILeapfrogApiKeyService } from '../common/leapfrog.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;
const BATCH_SIZE = 100;
const BATCH_DELAY_MS = 200;
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IEmbeddingResult {
	/** chunkId → embedding vector */
	embeddings: Record<string, number[]>;
	/** chunkIds that failed to embed */
	failed: string[];
}

export interface IEmbeddingRequest {
	id: string;
	text: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class LeapfrogEmbeddingService {

	constructor(
		private readonly apiKeyService: ILeapfrogApiKeyService,
		private readonly logService: ILogService,
	) { }

	/**
	 * Embed a list of text chunks. Returns embeddings keyed by chunk ID.
	 */
	async embedChunks(
		chunks: IEmbeddingRequest[],
		onProgress?: (embedded: number, total: number) => void,
		cancelToken?: CancellationToken,
	): Promise<IEmbeddingResult> {
		const result: IEmbeddingResult = { embeddings: {}, failed: [] };

		if (chunks.length === 0) {
			return result;
		}

		const apiKey = await this.apiKeyService.getApiKey('openai');
		if (!apiKey) {
			this.logService.warn('[Leapfrog] No OpenAI API key - skipping embedding');
			result.failed = chunks.map(c => c.id);
			return result;
		}

		// Process in batches
		const batches = this.createBatches(chunks, BATCH_SIZE);
		let embedded = 0;

		for (let i = 0; i < batches.length; i++) {
			if (cancelToken?.isCancellationRequested) {
				// Mark remaining as failed
				for (let j = i; j < batches.length; j++) {
					result.failed.push(...batches[j]!.map(c => c.id));
				}
				break;
			}

			const batch = batches[i]!;
			try {
				const vectors = await this.embedBatchWithRetry(apiKey, batch);
				for (let k = 0; k < batch.length; k++) {
					result.embeddings[batch[k]!.id] = vectors[k]!;
				}
				embedded += batch.length;
			} catch (err) {
				this.logService.error(`[Leapfrog] Embedding batch ${i + 1}/${batches.length} failed:`, err);
				result.failed.push(...batch.map(c => c.id));
			}

			onProgress?.(embedded, chunks.length);

			// Delay between batches to avoid rate limiting
			if (i < batches.length - 1) {
				await this.delay(BATCH_DELAY_MS);
			}
		}

		this.logService.info(`[Leapfrog] Embedded ${embedded}/${chunks.length} chunks (${result.failed.length} failed)`);
		return result;
	}

	/**
	 * Embed a single query string for search.
	 */
	async embedQuery(query: string): Promise<number[] | undefined> {
		const apiKey = await this.apiKeyService.getApiKey('openai');
		if (!apiKey) {
			return undefined;
		}

		try {
			const vectors = await this.callEmbeddingAPI(apiKey, [query]);
			return vectors[0];
		} catch (err) {
			this.logService.error('[Leapfrog] Query embedding failed:', err);
			return undefined;
		}
	}

	/**
	 * Get the expected embedding dimensions.
	 */
	getDimensions(): number {
		return EMBEDDING_DIMENSIONS;
	}

	// -----------------------------------------------------------------------
	// Internals
	// -----------------------------------------------------------------------

	private createBatches(items: IEmbeddingRequest[], batchSize: number): IEmbeddingRequest[][] {
		const batches: IEmbeddingRequest[][] = [];
		for (let i = 0; i < items.length; i += batchSize) {
			batches.push(items.slice(i, i + batchSize));
		}
		return batches;
	}

	private async embedBatchWithRetry(apiKey: string, batch: IEmbeddingRequest[]): Promise<number[][]> {
		let delay = INITIAL_RETRY_DELAY_MS;

		for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
			try {
				return await this.callEmbeddingAPI(apiKey, batch.map(c => c.text));
			} catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
				const isRateLimit = err?.status === 429 || err?.message?.includes('429');
				const isRetryable = isRateLimit || err?.status === 500 || err?.status === 503;

				if (!isRetryable || attempt === MAX_RETRIES - 1) {
					throw err;
				}

				// Use Retry-After header if available
				const retryAfter = err?.headers?.get?.('retry-after');
				const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : delay;

				this.logService.warn(`[Leapfrog] Embedding API rate limited, retrying in ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
				await this.delay(Math.min(waitMs, MAX_RETRY_DELAY_MS));
				delay *= 2; // Exponential backoff
			}
		}

		throw new Error('Exhausted retries');
	}

	private async callEmbeddingAPI(apiKey: string, texts: string[]): Promise<number[][]> {
		// Try SDK first, fall back to HTTP
		try {
			const OpenAI = await this.loadOpenAISDK();
			if (OpenAI) {
				return await this.callWithSDK(OpenAI, apiKey, texts);
			}
		} catch {
			// Fall through to HTTP
		}

		return await this.callWithHTTP(apiKey, texts);
	}

	private async callWithSDK(OpenAI: any, apiKey: string, texts: string[]): Promise<number[][]> { // eslint-disable-line @typescript-eslint/no-explicit-any
		const client = new OpenAI({ apiKey });
		const response = await client.embeddings.create({
			model: EMBEDDING_MODEL,
			input: texts,
		});

		// Sort by index to ensure correct ordering
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const sorted = response.data.sort((a: any, b: any) => a.index - b.index);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return sorted.map((d: any) => d.embedding as number[]);
	}

	private async callWithHTTP(apiKey: string, texts: string[]): Promise<number[][]> {
		const response = await fetch('https://api.openai.com/v1/embeddings', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: EMBEDDING_MODEL,
				input: texts,
			}),
		});

		if (!response.ok) {
			const errorText = await response.text();
			const err: any = new Error(`OpenAI Embeddings API error: ${response.status} ${errorText}`); // eslint-disable-line @typescript-eslint/no-explicit-any
			err.status = response.status;
			err.headers = response.headers;
			throw err;
		}

		const data = await response.json();
		const sorted = data.data.sort((a: any, b: any) => a.index - b.index); // eslint-disable-line @typescript-eslint/no-explicit-any
		return sorted.map((d: any) => d.embedding as number[]); // eslint-disable-line @typescript-eslint/no-explicit-any
	}

	private async loadOpenAISDK(): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
		try {
			const module = await import('openai');
			return module.default;
		} catch {
			return undefined;
		}
	}

	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}
