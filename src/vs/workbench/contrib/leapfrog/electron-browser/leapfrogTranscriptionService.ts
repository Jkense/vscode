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
	ILeapfrogSpeaker,
} from '../common/leapfrog.js';
import { ILeapfrogConfiguration, LeapfrogConfigurationKeys } from '../common/leapfrogConfiguration.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { LeapfrogProjectConfig } from './leapfrogProjectConfig.js';

const CLERK_TOKEN_STORAGE_KEY = 'leapfrog.auth.clerkToken';
const PROJECT_ID_STORAGE_KEY = 'leapfrog.project.id';
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
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
	) {
		super();
		this.logService.info('[Leapfrog] Transcription Service initialized');
	}

	// -----------------------------------------------------------------------
	// Public API
	// -----------------------------------------------------------------------

	async transcribe(filePath: string, options?: ILeapfrogTranscriptionOptions): Promise<ILeapfrogTranscript> {
		const backendUrl = this.getBackendUrl();
		let projectId = await this.secretStorageService.get(PROJECT_ID_STORAGE_KEY);
		const clerkToken = await this.secretStorageService.get(CLERK_TOKEN_STORAGE_KEY);

		// Use LeapfrogProjectConfig for projectId when secret storage is empty
		if (!projectId) {
			const folders = this.workspaceContextService.getWorkspace().folders;
			if (folders.length > 0) {
				const projectPath = folders[0].uri.fsPath;
				const projectConfig = new LeapfrogProjectConfig(this.fileService);
				projectId = await projectConfig.getOrCreateProjectId(projectPath);
			}
		}

		if (backendUrl && projectId && clerkToken) {
			try {
				return await this.transcribeViaBackend(filePath, options, backendUrl, projectId, clerkToken);
			} catch (err) {
				this.logService.error('[Leapfrog] Backend transcription failed:', err);
				throw err;
			}
		}

		throw new Error('Transcription requires a Leapfrog account. Run **Leapfrog: Connect to Leapfrog** to sign in and link your workspace.');
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
				const envUrl = g.process.env['NEXT_PUBLIC_API_URL'] ?? g.process.env['LEAPFROG_API_URL'];
				if (envUrl) {
					return envUrl;
				}
			}
		} catch {
			// process not available in sandboxed renderer
		}
		const configUrl = this.configurationService.getValue<string>(LeapfrogConfigurationKeys.ApiUrl);
		return typeof configUrl === 'string' && configUrl.trim() ? configUrl.trim() : undefined;
	}

	async getTranscript(transcriptId: string): Promise<ILeapfrogTranscript> {
		return this.getStatus(transcriptId);
	}

	async getStatus(transcriptId: string): Promise<ILeapfrogTranscript> {
		const backendUrl = this.getBackendUrl();
		const clerkToken = await this.secretStorageService.get(CLERK_TOKEN_STORAGE_KEY);
		let projectId = await this.secretStorageService.get(PROJECT_ID_STORAGE_KEY);
		if (!projectId) {
			const folders = this.workspaceContextService.getWorkspace().folders;
			if (folders.length > 0) {
				const projectConfig = new LeapfrogProjectConfig(this.fileService);
				projectId = await projectConfig.getOrCreateProjectId(folders[0].uri.fsPath);
			}
		}
		if (backendUrl && projectId && clerkToken) {
			const res = await fetch(`${backendUrl}/api/projects/${projectId}/transcriptions/${transcriptId}`, {
				headers: { 'Authorization': `Bearer ${clerkToken}` },
			});
			if (!res.ok) {
				throw new Error(`Failed to get transcript status: ${res.status}`);
			}
			const job = await res.json() as {
				status: string;
				transcript?: { text: string; segments: string; speakers: string; language: string; confidenceScore: number; durationSeconds: number };
			};
			if (job.status === 'completed' && job.transcript) {
				return this.formatBackendTranscript(transcriptId, job.transcript);
			}
			return {
				id: transcriptId,
				fileId: generateUuid(),
				projectId: projectId ?? '',
				sourcePath: '',
				status: job.status === 'error' ? 'error' : job.status === 'processing' ? 'processing' : 'pending',
				segments: [],
				speakers: [],
				createdAt: Date.now(),
				updatedAt: Date.now(),
			};
		}
		throw new Error('Transcription requires a Leapfrog account. Run **Leapfrog: Connect to Leapfrog** to sign in and link your workspace.');
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
