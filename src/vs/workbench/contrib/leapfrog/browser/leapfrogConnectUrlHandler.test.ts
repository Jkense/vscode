/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { LeapfrogConnectUrlHandler } from './leapfrogConnectUrlHandler.js';
import { ILogService, NullLogService } from '../../../../platform/log/common/log.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IURLService } from '../../../../platform/url/common/url.js';
import { LEAPFROG_CLERK_TOKEN_KEY, LEAPFROG_PROJECT_ID_KEY, LEAPFROG_USER_EMAIL_KEY, LEAPFROG_USER_IMAGE_URL_KEY, LEAPFROG_USER_NAME_KEY } from '../common/leapfrogAuthKeys.js';
import { TestNotificationService } from '../../../../platform/notification/test/common/testNotificationService.js';

class InMemorySecretStorage implements ISecretStorageService {
	declare readonly _serviceBrand: undefined;
	readonly onDidChangeSecret = () => ({ dispose: () => { } });
	type = 'in-memory' as const;
	private data = new Map<string, string>();

	async get(key: string): Promise<string | undefined> {
		return this.data.get(key);
	}
	async set(key: string, value: string): Promise<void> {
		this.data.set(key, value);
	}
	async delete(key: string): Promise<void> {
		this.data.delete(key);
	}
}

/** Minimal storage mock - only store/get are used by LeapfrogConnectUrlHandler */
class InMemoryStorageService {
	private data = new Map<string, string>();

	store(key: string, value: string, scope: StorageScope, _target: StorageTarget): void {
		this.data.set(`${scope}:${key}`, value);
	}
	get(key: string, scope: StorageScope): string | undefined {
		return this.data.get(`${scope}:${key}`);
	}
}

class MockURLService implements IURLService {
	declare readonly _serviceBrand: undefined;
	registerHandler(_handler: import('../../../../platform/url/common/url.js').IURLHandler) {
		return { dispose: () => { } };
	}
	open(_uri: URI) {
		return Promise.resolve(true);
	}
	create() {
		return URI.parse('leapfrog://connect');
	}
}

suite('LeapfrogConnectUrlHandler', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	let handler: LeapfrogConnectUrlHandler;
	let secretStorage: InMemorySecretStorage;
	let storageService: InMemoryStorageService;

	setup(() => {
		secretStorage = new InMemorySecretStorage();
		storageService = new InMemoryStorageService();
		handler = store.add(new LeapfrogConnectUrlHandler(
			new MockURLService() as unknown as IURLService,
			secretStorage as unknown as ISecretStorageService,
			storageService as unknown as IStorageService,
			new NullLogService() as unknown as ILogService,
			new TestNotificationService() as unknown as INotificationService,
		));
	});

	test('handles leapfrog://connect and stores token and projectId', async () => {
		const uri = URI.parse('leapfrog://connect?token=tk-123&projectId=proj-456');
		const result = await handler.handleURL(uri);
		assert.strictEqual(result, true);

		assert.strictEqual(await secretStorage.get(LEAPFROG_CLERK_TOKEN_KEY), 'tk-123');
		assert.strictEqual(await secretStorage.get(LEAPFROG_PROJECT_ID_KEY), 'proj-456');
	});

	test('stores email, imageUrl, and name when present', async () => {
		const uri = URI.parse('leapfrog://connect?token=tk&projectId=proj&email=u%40x.com&imageUrl=https%3A%2F%2Fimg.com%2Fa.png&name=Alice');
		await handler.handleURL(uri);

		assert.strictEqual(storageService.get(LEAPFROG_USER_EMAIL_KEY, StorageScope.PROFILE), 'u@x.com');
		assert.strictEqual(storageService.get(LEAPFROG_USER_IMAGE_URL_KEY, StorageScope.PROFILE), 'https://img.com/a.png');
		assert.strictEqual(storageService.get(LEAPFROG_USER_NAME_KEY, StorageScope.PROFILE), 'Alice');
	});

	test('returns false for non-leapfrog scheme', async () => {
		const uri = URI.parse('https://example.com/connect?token=x&projectId=y');
		const result = await handler.handleURL(uri);
		assert.strictEqual(result, false);
	});

	test('returns true but does not store when token or projectId missing', async () => {
		const uri = URI.parse('leapfrog://connect?token=tk');
		const result = await handler.handleURL(uri);
		assert.strictEqual(result, true);
		assert.strictEqual(await secretStorage.get(LEAPFROG_CLERK_TOKEN_KEY), undefined);
	});
});
