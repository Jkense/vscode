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
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { URI } from '../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';

const CONNECT_ERROR = 'Transcription requires a Leapfrog account';

/** Minimal workspace mock - cast to IWorkspaceContextService at use site */
type WorkspaceMock = { folders: { uri: URI }[] };

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

class MockWorkspaceContextService {
	private folders: { uri: URI }[] = [{ uri: URI.file('/tmp/test-workspace') }];

	getWorkspace(): WorkspaceMock {
		return { folders: this.folders };
	}
}

/** Minimal file service mock for LeapfrogProjectConfig - cast to IFileService at use site */
class MockFileService {
	private files = new Map<string, string>();

	async readFile(resource: URI) {
		const key = resource.toString();
		const content = this.files.get(key);
		if (!content) {
			const err = new Error('File not found') as Error & { code: string };
			err.code = 'ENOENT';
			throw err;
		}
		return { value: VSBuffer.fromString(content), etag: '' };
	}

	async writeFile(resource: URI, content: VSBuffer) {
		this.files.set(resource.toString(), content.toString());
	}

	async createFolder(_resource: URI) {
		// No-op for tests
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
	let workspaceService: MockWorkspaceContextService;
	let fileService: MockFileService;

	setup(() => {
		secretStorage = new InMemorySecretStorageService();
		configService = new MockConfigurationService();
		workspaceService = new MockWorkspaceContextService();
		fileService = new MockFileService();
		service = store.add(new LeapfrogTranscriptionService(
			new NullLogService() as unknown as ILogService,
			secretStorage as unknown as ISecretStorageService,
			configService as unknown as IConfigurationService,
			workspaceService as unknown as IWorkspaceContextService,
			fileService as unknown as IFileService,
		));
	});

	// -----------------------------------------------------------------------
	// Backend flow requirements (no direct AssemblyAI)
	// -----------------------------------------------------------------------

	test('transcribe throws when not connected to Leapfrog', async () => {
		await assert.rejects(
			() => service.transcribe('https://example.com/audio.mp3'),
			(err: Error) => err.message.includes(CONNECT_ERROR),
		);
	});

	test('transcribe throws when backendUrl is missing', async () => {
		secretStorage.seed('leapfrog.auth.clerkToken', 'token-123');
		secretStorage.seed('leapfrog.project.id', 'proj-456');
		configService.setConfig({});
		// No NEXT_PUBLIC_API_URL env and no leapfrog.api.url config
		await assert.rejects(
			() => service.transcribe('https://example.com/audio.mp3'),
			(err: Error) => err.message.includes(CONNECT_ERROR),
		);
	});

	test('getStatus throws when not connected to Leapfrog', async () => {
		await assert.rejects(
			() => service.getStatus('abc'),
			(err: Error) => err.message.includes(CONNECT_ERROR),
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
	// Configuration-based transcription options (backend flow)
	// -----------------------------------------------------------------------

	test('uses leapfrog.api.url from config when env is empty', async () => {
		configService.setConfig({ 'leapfrog.api.url': 'https://api.example.com' });
		secretStorage.seed('leapfrog.auth.clerkToken', 'token');
		secretStorage.seed('leapfrog.project.id', 'proj');
		// Will fail at fetch (no real server) but proves we passed the credentials check
		await assert.rejects(
			() => service.transcribe('https://example.com/audio.mp3'),
			(err: Error) => !err.message.includes(CONNECT_ERROR),
		);
	});
});
