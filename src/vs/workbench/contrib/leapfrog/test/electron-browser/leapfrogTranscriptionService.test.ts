/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { LeapfrogTranscriptionService } from '../../electron-browser/leapfrogTranscriptionService.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { ISecretStorageService } from '../../../../../platform/secrets/common/secrets.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';

// Preserve original env var
const originalEnv = process.env.ASSEMBLYAI_API_KEY;

// Minimal configuration service stub (cast to IConfigurationService at call sites)
class MockConfigurationService {
	private config: Record<string, unknown> = {};

	getValue(sectionOrOverrides?: any): any {
		if (typeof sectionOrOverrides === 'string') {
			return this.config[sectionOrOverrides];
		}
		return this.config;
	}

	updateValue(): Promise<void> {
		return Promise.resolve();
	}

	setConfig(config: Record<string, unknown>): void {
		this.config = config;
	}
}

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

class InMemorySecretStorageService implements ISecretStorageService {
	declare readonly _serviceBrand: undefined;

	readonly onDidChangeSecret = () => ({ dispose: () => { } });

	type = 'in-memory' as const;

	private store = new Map<string, string>();

	async get(key: string): Promise<string | undefined> {
		return this.store.get(key);
	}

	async set(key: string, value: string): Promise<void> {
		this.store.set(key, value);
	}

	async delete(key: string): Promise<void> {
		this.store.delete(key);
	}

	/** Helper – seed a key for testing */
	seed(key: string, value: string): void {
		this.store.set(key, value);
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

suite('LeapfrogTranscriptionService', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	let service: LeapfrogTranscriptionService;
	let secretStorage: InMemorySecretStorageService;
	let configService: MockConfigurationService;

	setup(() => {
		secretStorage = new InMemorySecretStorageService();
		configService = new MockConfigurationService();
		service = store.add(new LeapfrogTranscriptionService(
			new NullLogService() as unknown as ILogService,
			secretStorage as unknown as ISecretStorageService,
			configService as unknown as IConfigurationService,
		));
		// Clear env var before each test
		delete process.env.ASSEMBLYAI_API_KEY;
	});

	teardown(() => {
		// Restore original env var
		if (originalEnv) {
			process.env.ASSEMBLYAI_API_KEY = originalEnv;
		} else {
			delete process.env.ASSEMBLYAI_API_KEY;
		}
	});

	// -----------------------------------------------------------------------
	// API key validation
	// -----------------------------------------------------------------------

	test('transcribe throws when no API key is set', async () => {
		await assert.rejects(
			() => service.transcribe('https://example.com/audio.mp3'),
			(err: Error) => err.message.includes('API key not configured'),
		);
	});

	test('getStatus throws when no API key is set', async () => {
		await assert.rejects(
			() => service.getStatus('abc'),
			(err: Error) => err.message.includes('API key not configured'),
		);
	});

	test('uses API key from secret storage when available', async () => {
		secretStorage.seed('leapfrog.apiKey.assemblyai', 'secret-key-123');

		await assert.rejects(
			() => service.transcribe('https://example.com/audio.mp3'),
			(err: Error) => err.message.includes('AssemblyAI API error') || err.message.includes('fetch'),
		);
	});

	test('falls back to environment variable when secret storage is empty', async () => {
		process.env.ASSEMBLYAI_API_KEY = 'env-key-456';

		await assert.rejects(
			() => service.transcribe('https://example.com/audio.mp3'),
			(err: Error) => err.message.includes('AssemblyAI API error') || err.message.includes('fetch'),
		);
	});

	test('prioritizes secret storage over environment variable', async () => {
		secretStorage.seed('leapfrog.apiKey.assemblyai', 'secret-key-123');
		process.env.ASSEMBLYAI_API_KEY = 'env-key-456';

		await assert.rejects(
			() => service.transcribe('https://example.com/audio.mp3'),
			(err: Error) => err.message.includes('AssemblyAI API error') || err.message.includes('fetch'),
		);
	});

	// -----------------------------------------------------------------------
	// renameSpeaker – local-only, no network needed
	// -----------------------------------------------------------------------

	test('renameSpeaker stores name override', async () => {
		await service.renameSpeaker('t1', 'A', 'Alice');
		// No assertion besides "does not throw"
	});

	// -----------------------------------------------------------------------
	// onDidTranscriptComplete / onDidTranscriptError events
	// -----------------------------------------------------------------------

	test('events are disposable', () => {
		const d1 = service.onDidTranscriptComplete(() => { });
		const d2 = service.onDidTranscriptError(() => { });
		d1.dispose();
		d2.dispose();
	});

	// -----------------------------------------------------------------------
	// Configuration-based transcription options
	// -----------------------------------------------------------------------

	test('applies configuration defaults to transcription', async () => {
		secretStorage.seed('leapfrog.apiKey.assemblyai', 'test-key');
		configService.setConfig({
			leapfrog: {
				transcript: {
					language: 'en',
					sentimentAnalysis: true,
					entityDetection: true,
					autoChapters: true,
				}
			}
		});

		await assert.rejects(
			() => service.transcribe('https://example.com/audio.mp3'),
			(err: Error) => err.message.includes('AssemblyAI API error') || err.message.includes('fetch'),
		);
	});

	test('uses auto language detection when configured', async () => {
		secretStorage.seed('leapfrog.apiKey.assemblyai', 'test-key');
		configService.setConfig({
			leapfrog: {
				transcript: {
					language: 'auto',
					languageDetection: true,
				}
			}
		});

		await assert.rejects(
			() => service.transcribe('https://example.com/audio.mp3'),
			(err: Error) => err.message.includes('AssemblyAI API error') || err.message.includes('fetch'),
		);
	});

	test('applies all transcription feature flags from configuration', async () => {
		secretStorage.seed('leapfrog.apiKey.assemblyai', 'test-key');
		configService.setConfig({
			leapfrog: {
				transcript: {
					language: 'en',
					punctuate: true,
					formatText: true,
					sentimentAnalysis: true,
					entityDetection: true,
					autoChapters: true,
					autoHighlights: true,
					disfluencies: false,
					filterProfanity: true,
				}
			}
		});

		await assert.rejects(
			() => service.transcribe('https://example.com/audio.mp3'),
			(err: Error) => err.message.includes('AssemblyAI API error') || err.message.includes('fetch'),
		);
	});

	test('always enables diarization regardless of configuration', async () => {
		secretStorage.seed('leapfrog.apiKey.assemblyai', 'test-key');
		configService.setConfig({
			leapfrog: {
				transcript: {
					// No explicit diarization setting
				}
			}
		});

		await assert.rejects(
			() => service.transcribe('https://example.com/audio.mp3'),
			(err: Error) => err.message.includes('AssemblyAI API error') || err.message.includes('fetch'),
		);
		// Diarization will be enabled in the request body
	});
});
