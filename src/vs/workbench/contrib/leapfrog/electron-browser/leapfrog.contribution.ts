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

import { URI } from '../../../../base/common/uri.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ILeapfrogApiKeyService, ILeapfrogTagService, ILeapfrogTranscriptionService } from '../common/leapfrog.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { FileOperation } from '../../../../platform/files/common/files.js';
import { IWorkingCopyFileService } from '../../../services/workingCopy/common/workingCopyFileService.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { LeapfrogTagService } from './leapfrogTagService.js';
import { LeapfrogTranscriptionService } from './leapfrogTranscriptionService.js';

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
registerSingleton(ILeapfrogTranscriptionService, LeapfrogTranscriptionService, InstantiationType.Delayed);

// ---------------------------------------------------------------------------
// Transcription Commands
// ---------------------------------------------------------------------------

CommandsRegistry.registerCommand('leapfrog.transcribe', async (accessor: ServicesAccessor, filePath: string, options?: { language?: string; diarization?: boolean }) => {
	const transcriptionService = accessor.get(ILeapfrogTranscriptionService);
	const transcript = await transcriptionService.transcribe(filePath, options);
	return { transcriptId: transcript.id, status: transcript.status };
});

CommandsRegistry.registerCommand('leapfrog.getTranscriptStatus', async (accessor: ServicesAccessor, transcriptId: string) => {
	const transcriptionService = accessor.get(ILeapfrogTranscriptionService);
	const transcript = await transcriptionService.getStatus(transcriptId);
	return transcript;
});

CommandsRegistry.registerCommand('leapfrog.renameSpeaker', async (accessor: ServicesAccessor, transcriptId: string, speakerId: string, newName: string) => {
	const transcriptionService = accessor.get(ILeapfrogTranscriptionService);
	await transcriptionService.renameSpeaker(transcriptId, speakerId, newName);
});

/**
 * Contribution that initializes Leapfrog desktop services
 */
class LeapfrogDesktopContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.leapfrogDesktop';

	constructor(
		@ILogService private readonly logService: ILogService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ILeapfrogTagService private readonly tagService: ILeapfrogTagService,
		@IWorkingCopyFileService private readonly workingCopyFileService: IWorkingCopyFileService,
	) {
		super();
		this.logService.info('[Leapfrog] Desktop contribution initialized');
		this.initializeTagDatabase();

		// Duplicate tag applications when files are copied
		this._register(this.workingCopyFileService.onDidRunWorkingCopyFileOperation(e => {
			if (e.operation === FileOperation.COPY) {
				this.handleFileCopy(e.files);
			}
		}));
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

	private async handleFileCopy(files: readonly { source?: URI; target: URI }[]): Promise<void> {
		for (const { source, target } of files) {
			if (!source) {
				continue;
			}
			try {
				const sourceApps = await this.tagService.getApplicationsForFile(source.fsPath);
				for (const app of sourceApps) {
					await this.tagService.applyTag(
						app.tagId,
						target.fsPath,
						{
							startOffset: app.startOffset,
							endOffset: app.endOffset,
							selectedText: app.selectedText,
						},
						app.note,
					);
				}
			} catch (err) {
				this.logService.error('[Leapfrog] Failed to duplicate tag applications on file copy', err);
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
