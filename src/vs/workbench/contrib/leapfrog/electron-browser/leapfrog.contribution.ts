/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Leapfrog Desktop (Electron) specific contributions
 *
 * This file contains contributions that are only available in the desktop version:
 * - SQLite database service
 * - AI service (wraps @leapfrog/ai providers)
 * - API key service (uses native secret storage)
 * - File system integrations
 */

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ILeapfrogApiKeyService, ILeapfrogTagService } from '../common/leapfrog.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { LeapfrogTagService } from './leapfrogTagService.js';

/**
 * Leapfrog API Key Service - Desktop implementation using native secret storage
 */
class LeapfrogApiKeyService extends Disposable implements ILeapfrogApiKeyService {
	declare readonly _serviceBrand: undefined;

	private static readonly KEY_PREFIX = 'leapfrog.apiKey.';

	constructor(
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.logService.info('[Leapfrog] API Key Service initialized');
	}

	async setApiKey(provider: 'openai' | 'anthropic', key: string): Promise<void> {
		const storageKey = LeapfrogApiKeyService.KEY_PREFIX + provider;
		await this.secretStorageService.set(storageKey, key);
		this.logService.info(`[Leapfrog] API key stored for provider: ${provider}`);
	}

	async getApiKey(provider: 'openai' | 'anthropic'): Promise<string | undefined> {
		const storageKey = LeapfrogApiKeyService.KEY_PREFIX + provider;
		return this.secretStorageService.get(storageKey);
	}

	async deleteApiKey(provider: 'openai' | 'anthropic'): Promise<void> {
		const storageKey = LeapfrogApiKeyService.KEY_PREFIX + provider;
		await this.secretStorageService.delete(storageKey);
		this.logService.info(`[Leapfrog] API key deleted for provider: ${provider}`);
	}

	async hasApiKey(provider: 'openai' | 'anthropic'): Promise<boolean> {
		const key = await this.getApiKey(provider);
		return !!key;
	}
}

// Register services
registerSingleton(ILeapfrogApiKeyService, LeapfrogApiKeyService, InstantiationType.Delayed);
registerSingleton(ILeapfrogTagService, LeapfrogTagService, InstantiationType.Delayed);

/**
 * Contribution that initializes Leapfrog desktop services
 */
class LeapfrogDesktopContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.leapfrogDesktop';

	constructor(
		@ILogService private readonly logService: ILogService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ILeapfrogTagService private readonly tagService: ILeapfrogTagService,
	) {
		super();
		this.logService.info('[Leapfrog] Desktop contribution initialized');
		this.initializeTagDatabase();
	}

	private async initializeTagDatabase(): Promise<void> {
		const folders = this.workspaceContextService.getWorkspace().folders;
		if (folders.length > 0) {
			const projectPath = folders[0].uri.fsPath;
			try {
				await this.tagService.initialize(projectPath);
				this.logService.info('[Leapfrog] Tag database initialized for workspace:', projectPath);
			} catch (err) {
				this.logService.error('[Leapfrog] Failed to initialize tag database', err);
			}
		}
	}

	override dispose(): void {
		this.tagService.close().catch(err =>
			this.logService.error('[Leapfrog] Error closing tag database', err)
		);
		super.dispose();
	}
}

// Register contributions
registerWorkbenchContribution2(LeapfrogDesktopContribution.ID, LeapfrogDesktopContribution, WorkbenchPhase.AfterRestored);
