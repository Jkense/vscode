/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { LeapfrogTranscriptionService } from '../../electron-browser/leapfrogTranscriptionService.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { ISecretStorageService } from '../../../../../platform/secrets/common/secrets.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { ILeapfrogAutoCommitService } from '../../common/leapfrog.js';

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

const NullFileService = {} as unknown as IFileService;

const NullAutoCommitService: ILeapfrogAutoCommitService = {
	_serviceBrand: undefined,
	initialize: async () => { },
	notifyChange: () => { },
	commitNow: async () => { },
	enabled: false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

suite('LeapfrogTranscriptionService', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	let service: LeapfrogTranscriptionService;
	let secretStorage: InMemorySecretStorageService;

	setup(() => {
		secretStorage = new InMemorySecretStorageService();
		service = store.add(new LeapfrogTranscriptionService(
			new NullLogService() as unknown as ILogService,
			secretStorage as unknown as ISecretStorageService,
			NullFileService,
			NullAutoCommitService,
		));
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
});
