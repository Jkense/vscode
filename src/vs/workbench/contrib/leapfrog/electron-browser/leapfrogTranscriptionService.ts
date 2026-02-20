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
import { ILeapfrogConfiguration } from '../common/leapfrogConfiguration.js';

const ASSEMBLYAI_BASE = 'https://api.assemblyai.com/v2';
const API_KEY_STORAGE_KEY = 'leapfrog.apiKey.assemblyai';
const CLERK_TOKEN_STORAGE_KEY = 'leapfrog.auth.clerkToken';
const PROJECT_ID_STORAGE_KEY = 'leapfrog.project.id';
const POLLING_INTERVAL_MS = 3000;
const BACKEND_POLLING_INTERVAL_MS = 5000;
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
		// Try backend-orchestrated flow first if configured
		const backendUrl = this.getBackendUrl();
		const projectId = await this.secretStorageService.get(PROJECT_ID_STORAGE_KEY);
		const clerkToken = await this.secretStorageService.get(CLERK_TOKEN_STORAGE_KEY);

		if (backendUrl && projectId && clerkToken) {
			try {
				return await this.transcribeViaBackend(filePath, options, backendUrl, projectId, clerkToken);
			} catch (err) {
				this.logService.warn('[Leapfrog] Backend transcription failed, falling back to direct flow:', err);
			}
		}

		// Fallback: direct AssemblyAI flow
		return this.transcribeDirectly(filePath, options);
	}

	private async transcribeViaBackend(
		filePath: string,
		options: ILeapfrogTranscriptionOptions | undefined,
		backendUrl: string,
		projectId: string,
		clerkToken: string,
	): Promise<ILeapfrogTranscript> {
		const mergedOptions = this.mergeWithConfigurationDefaults(options);

		this.logService.info(`[Leapfrog] Transcription: initiating via backend backendUrl=${backendUrl} projectId=${projectId} file=${filePath}`);

		// 1. Initiate transcription on backend → get AssemblyAI upload endpoint + token
		const initiateRes = await fetch(`${backendUrl}/api/projects/${projectId}/transcriptions/initiate`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${clerkToken}`,
			},
			body: JSON.stringify({
				filePath,
				language: mergedOptions.language ?? 'auto',
				options: {
					speaker_labels: true,
					punctuate: mergedOptions.punctuate,
					format_text: mergedOptions.formatText,
					sentiment_analysis: mergedOptions.sentimentAnalysis,
					entity_detection: mergedOptions.entityDetection,
					filter_profanity: mergedOptions.filterProfanity,
				},
			}),
		});

		if (!initiateRes.ok) {
			const body = await initiateRes.json().catch(() => ({ error: initiateRes.statusText })) as { error?: string };
			const reason = body?.error ?? initiateRes.statusText;
			this.logService.error(`[Leapfrog] Transcription initiate failed (${initiateRes.status}): ${reason}`);
			throw new Error(`Could not start transcription: ${reason}`);
		}

		const { jobId, assemblyaiUploadEndpoint, assemblyaiToken } = await initiateRes.json() as {
			jobId: string;
			assemblyaiUploadEndpoint: string;
			assemblyaiToken: string;
		};

		this.logService.info(`[Leapfrog] Transcription job created jobId=${jobId}, uploading audio to AssemblyAI...`);

		// 2. Upload audio file DIRECTLY to AssemblyAI (audio never touches our servers)
		const audioUrl = await this.uploadAudioToAssemblyAI(filePath, assemblyaiUploadEndpoint, assemblyaiToken);
		this.logService.info(`[Leapfrog] Audio uploaded to AssemblyAI audioUrl=${audioUrl}`);

		// 3. Register the audio URL with the backend to trigger processing
		this.logService.info(`[Leapfrog] Submitting audioUrl to backend for jobId=${jobId}`);
		const submitRes = await fetch(`${backendUrl}/api/projects/${projectId}/transcriptions/${jobId}/submit`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${clerkToken}`,
			},
			body: JSON.stringify({ audioUrl }),
		});

		if (!submitRes.ok) {
			const body = await submitRes.json().catch(() => ({ error: submitRes.statusText })) as { error?: string };
			const reason = body?.error ?? submitRes.statusText;
			this.logService.error(`[Leapfrog] Transcription submit failed (${submitRes.status}): ${reason}`);
			throw new Error(`Could not submit transcription job: ${reason}`);
		}

		this.logService.info(`[Leapfrog] Transcription job ${jobId} submitted, polling for completion...`);

		// Return a pending transcript and start background polling
		const pendingTranscript: ILeapfrogTranscript = {
			id: jobId,
			fileId: generateUuid(),
			projectId,
			sourcePath: filePath,
			status: 'pending',
			segments: [],
			speakers: [],
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};

		// Poll backend for completion
		this.pollBackendUntilDone(backendUrl, projectId, jobId, clerkToken);

		return pendingTranscript;
	}

	private async uploadAudioToAssemblyAI(filePath: string, uploadEndpoint: string, apiKey: string): Promise<string> {
		// Read the file from disk via Node.js fs
		const fs = await import('fs').catch(() => null);
		if (!fs) { throw new Error('Cannot read audio file: Node.js fs unavailable'); }
		const audioData = fs.readFileSync(filePath);

		// POST file to AssemblyAI upload endpoint → returns { upload_url }
		const uploadRes = await fetch(uploadEndpoint, {
			method: 'POST',
			headers: {
				'Authorization': apiKey,
				'Content-Type': 'application/octet-stream',
				'Transfer-Encoding': 'chunked',
			},
			body: audioData,
		});

		if (!uploadRes.ok) {
			const text = await uploadRes.text().catch(() => '');
			throw new Error(`AssemblyAI upload failed ${uploadRes.status}: ${text}`);
		}

		const { upload_url } = await uploadRes.json() as { upload_url: string };
		return upload_url;
	}

	private async pollBackendUntilDone(backendUrl: string, projectId: string, jobId: string, clerkToken: string): Promise<void> {
		const start = Date.now();

		while (Date.now() - start < POLLING_TIMEOUT_MS) {
			await this.sleep(BACKEND_POLLING_INTERVAL_MS);

			try {
				const res = await fetch(`${backendUrl}/api/projects/${projectId}/transcriptions/${jobId}`, {
					headers: { 'Authorization': `Bearer ${clerkToken}` },
				});

				if (!res.ok) { continue; }

				const job = await res.json() as {
					status: string;
					errorMessage?: string;
					transcript?: {
						text: string;
						segments: string;
						speakers: string;
						language: string;
						confidenceScore: number;
						durationSeconds: number;
					};
				};

				if (job.status === 'completed' && job.transcript) {
					const transcript = this.formatBackendTranscript(jobId, job.transcript);
					this._onDidTranscriptComplete.fire(transcript);
					return;
				}

				if (job.status === 'error') {
					this._onDidTranscriptError.fire({ transcriptId: jobId, error: job.errorMessage ?? 'Transcription failed' });
					return;
				}
			} catch (err) {
				this.logService.error('[Leapfrog] Backend polling error for job', jobId, err);
			}
		}

		this._onDidTranscriptError.fire({ transcriptId: jobId, error: 'Transcription timed out' });
	}

	private formatBackendTranscript(jobId: string, data: {
		text: string;
		segments: string;
		speakers: string;
		language: string;
		confidenceScore: number;
		durationSeconds: number;
	}): ILeapfrogTranscript {
		const rawSegments = JSON.parse(data.segments) as Array<{
			speaker: string; text: string; startTime: number; endTime: number; confidence: number;
		}>;
		const rawSpeakers = JSON.parse(data.speakers) as Array<{ id: string; name: string }>;

		const segments: ILeapfrogTranscriptSegment[] = rawSegments.map((s, i) => ({
			id: `seg_${i}`,
			speakerId: s.speaker,
			text: s.text,
			startTime: s.startTime,
			endTime: s.endTime,
			confidence: s.confidence,
			words: [],
		}));

		const speakers: ILeapfrogSpeaker[] = rawSpeakers.map((s, i) => ({
			id: s.id,
			name: s.name,
			color: SPEAKER_COLORS[i % SPEAKER_COLORS.length],
		}));

		return {
			id: jobId,
			fileId: generateUuid(),
			projectId: '',
			sourcePath: '',
			status: 'completed',
			segments,
			speakers,
			duration: data.durationSeconds,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};
	}

	private getBackendUrl(): string | undefined {
		try {
			const g = globalThis as { process?: { env?: Record<string, string> } };
			if (g.process?.env) {
				return g.process.env['NEXT_PUBLIC_API_URL'] ?? g.process.env['LEAPFROG_API_URL'];
			}
		} catch {
			// process not available in sandboxed renderer
		}
		return undefined;
	}

	private async transcribeDirectly(filePath: string, options?: ILeapfrogTranscriptionOptions): Promise<ILeapfrogTranscript> {
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
		this.logService.info('[Leapfrog] Transcription submitted directly:', transcript.id, 'with options:', mergedOptions);

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
		const config = this.configurationService.getValue('leapfrog') as ILeapfrogConfiguration;
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
