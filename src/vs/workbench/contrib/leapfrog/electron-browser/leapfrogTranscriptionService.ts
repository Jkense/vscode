/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Desktop implementation of ILeapfrogTranscriptionService.
 *
 * Wraps the AssemblyAI REST API directly (no shared @leapfrog/ai dependency at
 * the VS Code layer -- we keep the Electron side self-contained so that the
 * service can rely only on standard VS Code platform APIs and fetch).
 *
 * The heavy lifting (ms → s mapping, speaker extraction) mirrors
 * `@leapfrog/ai TranscriptionService` but re-uses the VS Code fork's own
 * `ILeapfrogTranscript` types.
 */

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import {
	ILeapfrogTranscriptionService,
	ILeapfrogTranscriptionOptions,
	ILeapfrogTranscript,
	ILeapfrogTranscriptSegment,
	ILeapfrogTranscriptWord,
	ILeapfrogSpeaker,
} from '../common/leapfrog.js';

const ASSEMBLYAI_BASE = 'https://api.assemblyai.com/v2';
const API_KEY_STORAGE_KEY = 'leapfrog.apiKey.assemblyai';
const POLLING_INTERVAL_MS = 3000;
const POLLING_TIMEOUT_MS = 600_000; // 10 minutes

/** Default speaker colours for UI highlighting */
const SPEAKER_COLORS = [
	'#3b82f6', '#ef4444', '#22c55e', '#f59e0b',
	'#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
];

export class LeapfrogTranscriptionService extends Disposable implements ILeapfrogTranscriptionService {

	declare readonly _serviceBrand: undefined;

	// Events
	private readonly _onDidTranscriptComplete = this._register(new Emitter<ILeapfrogTranscript>());
	readonly onDidTranscriptComplete: Event<ILeapfrogTranscript> = this._onDidTranscriptComplete.event;

	private readonly _onDidTranscriptError = this._register(new Emitter<{ transcriptId: string; error: string }>());
	readonly onDidTranscriptError: Event<{ transcriptId: string; error: string }> = this._onDidTranscriptError.event;

	/** In-memory store for speaker name overrides (transcriptId → speakerId → name) */
	private readonly speakerNames = new Map<string, Map<string, string>>();

	constructor(
		@ILogService private readonly logService: ILogService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();
		this.logService.info('[Leapfrog] Transcription Service initialized');
	}

	// -----------------------------------------------------------------------
	// Public API
	// -----------------------------------------------------------------------

	async transcribe(filePath: string, options?: ILeapfrogTranscriptionOptions): Promise<ILeapfrogTranscript> {
		const apiKey = await this.getApiKey();

		// Merge provided options with configuration defaults
		const mergedOptions = this.mergeWithConfigurationDefaults(options);

		const body: Record<string, unknown> = {
			audio_url: filePath,
			// Speaker diarization is ALWAYS enabled
			speaker_labels: true,
			language_detection: mergedOptions.language === 'auto' || mergedOptions.languageDetection,
			punctuate: mergedOptions.punctuate,
			format_text: mergedOptions.formatText,
			sentiment_analysis: mergedOptions.sentimentAnalysis,
			entity_detection: mergedOptions.entityDetection,
			auto_chapters: mergedOptions.autoChapters,
			auto_highlights: mergedOptions.autoHighlights,
			disfluencies: mergedOptions.disfluencies,
			filter_profanity: mergedOptions.filterProfanity,
		};

		// Set specific language if not auto
		if (mergedOptions.language && mergedOptions.language !== 'auto') {
			body.language_code = this.normalizeLanguage(mergedOptions.language);
		}

		const response = await this.request<RawTranscript>('POST', '/transcript', body, apiKey);

		const transcript = this.mapRaw(response);
		this.logService.info('[Leapfrog] Transcription submitted:', transcript.id, 'with options:', mergedOptions);

		// Start background polling
		this.pollUntilDone(transcript.id, apiKey);

		return transcript;
	}

	async getTranscript(transcriptId: string): Promise<ILeapfrogTranscript> {
		return this.getStatus(transcriptId);
	}

	async getStatus(transcriptId: string): Promise<ILeapfrogTranscript> {
		const apiKey = await this.getApiKey();
		const raw = await this.request<RawTranscript>('GET', `/transcript/${transcriptId}`, undefined, apiKey);
		return this.mapRaw(raw);
	}

	async renameSpeaker(transcriptId: string, speakerId: string, newName: string): Promise<void> {
		let map = this.speakerNames.get(transcriptId);
		if (!map) {
			map = new Map();
			this.speakerNames.set(transcriptId, map);
		}
		map.set(speakerId, newName);
		this.logService.info(`[Leapfrog] Speaker ${speakerId} renamed to "${newName}" in transcript ${transcriptId}`);
	}

	// -----------------------------------------------------------------------
	// Internal helpers
	// -----------------------------------------------------------------------

	private async getApiKey(): Promise<string> {
		// First check VS Code secret storage (user-provided key)
		const key = await this.secretStorageService.get(API_KEY_STORAGE_KEY);
		if (key) {
			return key;
		}

		// Fallback to environment variable (guard against sandboxed renderer where process may be undefined)
		const env = typeof process !== 'undefined' ? process.env : undefined;
		const envKey = env?.['ASSEMBLYAI_API_KEY'];
		if (envKey) {
			return envKey;
		}

		throw new Error('AssemblyAI API key not configured. Please set ASSEMBLYAI_API_KEY environment variable or configure it in Leapfrog settings.');
	}

	private async request<T>(method: string, path: string, body?: Record<string, unknown>, apiKey?: string): Promise<T> {
		const url = `${ASSEMBLYAI_BASE}${path}`;
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};

		if (apiKey) {
			headers['Authorization'] = apiKey;
		}

		const options: RequestInit = {
			method,
			headers,
		};

		if (body) {
			options.body = JSON.stringify(body);
		}

		const res = await fetch(url, options);

		if (!res.ok) {
			const text = await res.text().catch(() => 'Unknown error');
			throw new Error(`AssemblyAI API error ${res.status}: ${text}`);
		}

		return res.json() as Promise<T>;
	}

	private async pollUntilDone(transcriptId: string, apiKey: string): Promise<void> {
		const start = Date.now();

		while (Date.now() - start < POLLING_TIMEOUT_MS) {
			await this.sleep(POLLING_INTERVAL_MS);

			try {
				const raw = await this.request<RawTranscript>('GET', `/transcript/${transcriptId}`, undefined, apiKey);
				const transcript = this.mapRaw(raw);

				if (transcript.status === 'completed') {
					this._onDidTranscriptComplete.fire(transcript);
					return;
				}

				if (transcript.status === 'error') {
					this._onDidTranscriptError.fire({
						transcriptId,
						error: raw.error ?? 'Transcription failed',
					});
					return;
				}
			} catch (err) {
				this.logService.error('[Leapfrog] Polling error for transcript', transcriptId, err);
			}
		}

		this._onDidTranscriptError.fire({
			transcriptId,
			error: 'Transcription timed out',
		});
	}

	private mapRaw(raw: RawTranscript): ILeapfrogTranscript {
		const utterances = raw.utterances ?? [];
		const sentimentResults = raw.sentiment_analysis_results ?? [];
		const speakers = this.extractSpeakers(utterances, raw.id);
		const segments = this.mapUtterances(utterances, sentimentResults);

		return {
			id: raw.id,
			fileId: generateUuid(),
			projectId: '',
			sourcePath: raw.audio_url ?? '',
			status: this.mapStatus(raw.status),
			segments,
			speakers,
			duration: raw.audio_duration ?? undefined,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};
	}

	private mapStatus(status: string): ILeapfrogTranscript['status'] {
		switch (status) {
			case 'queued': return 'pending';
			case 'processing': return 'processing';
			case 'completed': return 'completed';
			case 'error': return 'error';
			default: return 'pending';
		}
	}

	private extractSpeakers(utterances: RawUtterance[], transcriptId: string): ILeapfrogSpeaker[] {
		const ids = new Set<string>();
		for (const u of utterances) {
			if (u.speaker) {
				ids.add(u.speaker);
			}
		}

		const nameOverrides = this.speakerNames.get(transcriptId);

		return Array.from(ids).sort().map((id, i) => ({
			id,
			name: nameOverrides?.get(id) ?? `Speaker ${i + 1}`,
			color: SPEAKER_COLORS[i % SPEAKER_COLORS.length],
		}));
	}

	private mapUtterances(utterances: RawUtterance[], sentimentResults: RawSentimentResult[]): ILeapfrogTranscriptSegment[] {
		return utterances.map((u, i) => {
			// Match sentiment by finding a result whose time range overlaps this utterance
			const sentiment = this.matchSentiment(u.start, u.end, sentimentResults);

			return {
				id: `seg_${i}`,
				speakerId: u.speaker ?? undefined,
				text: u.text,
				startTime: u.start / 1000,
				endTime: u.end / 1000,
				confidence: u.confidence ?? undefined,
				sentiment: sentiment?.sentiment as ILeapfrogTranscriptSegment['sentiment'],
				sentimentConfidence: sentiment?.confidence ?? undefined,
				words: (u.words ?? []).map(this.mapWord),
			};
		});
	}

	private matchSentiment(startMs: number, endMs: number, results: RawSentimentResult[]): RawSentimentResult | undefined {
		// Find the sentiment result that best overlaps with this utterance
		let best: RawSentimentResult | undefined;
		let bestOverlap = 0;

		for (const r of results) {
			const overlapStart = Math.max(startMs, r.start);
			const overlapEnd = Math.min(endMs, r.end);
			const overlap = overlapEnd - overlapStart;
			if (overlap > bestOverlap) {
				bestOverlap = overlap;
				best = r;
			}
		}

		return best;
	}

	private mapWord(w: RawWord): ILeapfrogTranscriptWord {
		return {
			text: w.text,
			startTime: w.start / 1000,
			endTime: w.end / 1000,
			confidence: w.confidence ?? undefined,
		};
	}

	private sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	/**
	 * Merge provided transcription options with configuration defaults.
	 * Configuration settings act as defaults; provided options override them.
	 */
	private mergeWithConfigurationDefaults(provided?: ILeapfrogTranscriptionOptions): ILeapfrogTranscriptionOptions {
		const config = this.configurationService.getValue('leapfrog') as any;
		const transcript = config?.transcript ?? {};

		return {
			// Diarization is ALWAYS true
			diarization: true,

			// Language settings
			language: provided?.language ?? this.normalizeLanguage(transcript.language ?? 'auto'),
			languageDetection: provided?.languageDetection ?? (transcript.language === 'auto' ? true : (transcript.languageDetection ?? true)),

			// Text processing - apply config defaults
			punctuate: provided?.punctuate ?? (transcript.punctuate ?? true),
			formatText: provided?.formatText ?? (transcript.formatText ?? true),
			disfluencies: provided?.disfluencies ?? (transcript.disfluencies ?? false),
			filterProfanity: provided?.filterProfanity ?? (transcript.filterProfanity ?? false),

			// AI features - apply config defaults
			sentimentAnalysis: provided?.sentimentAnalysis ?? (transcript.sentimentAnalysis ?? true),
			entityDetection: provided?.entityDetection ?? (transcript.entityDetection ?? false),
			autoChapters: provided?.autoChapters ?? (transcript.autoChapters ?? false),
			autoHighlights: provided?.autoHighlights ?? (transcript.autoHighlights ?? false),
		};
	}

	/**
	 * Normalize language code to AssemblyAI format.
	 * Maps short codes (e.g., 'en') to full codes (e.g., 'en_us').
	 */
	private normalizeLanguage(lang: string | 'auto'): string | 'auto' {
		if (lang === 'auto') {
			return 'auto';
		}

		const mapping: Record<string, string> = {
			'en': 'en_us',
			'es': 'es',
			'fr': 'fr',
			'de': 'de',
			'it': 'it',
			'pt': 'pt',
			'nl': 'nl',
			'pl': 'pl',
			'ru': 'ru',
			'zh': 'zh',
			'ja': 'ja',
			'ko': 'ko',
		};

		return mapping[lang] ?? lang;
	}
}

// ---------------------------------------------------------------------------
// Raw response shapes (internal)
// ---------------------------------------------------------------------------

interface RawTranscript {
	id: string;
	status: string;
	audio_url?: string;
	text?: string;
	error?: string;
	audio_duration?: number;
	utterances?: RawUtterance[];
	words?: RawWord[];
	sentiment_analysis_results?: RawSentimentResult[];
}

interface RawSentimentResult {
	text: string;
	sentiment: string;
	confidence: number;
	start: number;
	end: number;
}

interface RawUtterance {
	speaker: string;
	text: string;
	start: number;
	end: number;
	confidence?: number;
	words?: RawWord[];
}

interface RawWord {
	text: string;
	start: number;
	end: number;
	confidence?: number;
	speaker?: string;
}
