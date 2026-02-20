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
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { IStatusbarService, IStatusbarEntryAccessor, StatusbarAlignment, IStatusbarEntry } from '../../../services/statusbar/browser/statusbar.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IFileService, FileOperation } from '../../../../platform/files/common/files.js';
import { ILeapfrogApiKeyService, ILeapfrogTagService, ILeapfrogTranscriptionService, ILeapfrogTranscriptionOptions, ILeapfrogChatHistoryService, ILeapfrogAIService, ILeapfrogIndexService, ILeapfrogIndexPreferencesService, LEAPFROG_PREFERENCES_VIEWLET_ID } from '../common/leapfrog.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkingCopyFileService } from '../../../services/workingCopy/common/workingCopyFileService.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { localize } from '../../../../nls.js';
import { LeapfrogTagService } from './leapfrogTagService.js';
import { LeapfrogTranscriptionService } from './leapfrogTranscriptionService.js';
import { LeapfrogChatHistoryService } from './leapfrogChatHistoryService.js';
import { LeapfrogAIService } from './leapfrogAIService.js';
import { LeapfrogChatService } from './leapfrogChatService.js';
import { IChatService } from '../../../../workbench/contrib/chat/common/chatService/chatService.js';
import { LeapfrogIndexService } from './leapfrogIndexService.js';
import { LeapfrogIndexPreferencesService } from './leapfrogIndexPreferencesService.js';
import { LeapfrogSyncService } from './leapfrogSyncService.js';
import { LeapfrogProjectConfig } from './leapfrogProjectConfig.js';
import { LeapfrogConfigurationKeys } from '../common/leapfrogConfiguration.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';

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
		// Env var fallback for development (OPENAI_API_KEY, ANTHROPIC_API_KEY)
		const envKey = provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
		const env = typeof process !== 'undefined' ? process.env : undefined;
		const envValue = env?.[envKey]?.trim();
		if (envValue) {
			return envValue;
		}
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
registerSingleton(ILeapfrogChatHistoryService, LeapfrogChatHistoryService, InstantiationType.Delayed);
registerSingleton(ILeapfrogAIService, LeapfrogAIService, InstantiationType.Delayed);
registerSingleton(IChatService, LeapfrogChatService, InstantiationType.Delayed);
registerSingleton(ILeapfrogIndexService, LeapfrogIndexService, InstantiationType.Delayed);
registerSingleton(ILeapfrogIndexPreferencesService, LeapfrogIndexPreferencesService, InstantiationType.Delayed);

// ---------------------------------------------------------------------------
// Transcription Commands
// ---------------------------------------------------------------------------

CommandsRegistry.registerCommand('leapfrog.transcribe', async (accessor: ServicesAccessor, filePath: string, options?: ILeapfrogTranscriptionOptions) => {
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

CommandsRegistry.registerCommand('leapfrog.indexWorkspace', async (accessor: ServicesAccessor) => {
	const indexService = accessor.get(ILeapfrogIndexService);
	await indexService.indexWorkspace();
});

CommandsRegistry.registerCommand({
	id: 'leapfrog.resetIndex',
	metadata: {
		description: localize('leapfrogResetIndex', 'Leapfrog: Reset index and merkle tree. Forces full re-index.')
	},
	handler: async (accessor: ServicesAccessor) => {
		const indexService = accessor.get(ILeapfrogIndexService);
		const notificationService = accessor.get(INotificationService);
		try {
			await indexService.resetIndex();
			notificationService.info(localize('leapfrogResetIndexComplete', 'Index reset. Re-indexing workspace...'));
		} catch (err) {
			notificationService.error(localize('leapfrogResetIndexFailed', 'Failed to reset index: {0}', String(err)));
		}
	}
});

CommandsRegistry.registerCommand({
	id: 'leapfrog.configureApiKey',
	metadata: {
		description: localize('leapfrogConfigureApiKey', 'Leapfrog: Configure API Key')
	},
	handler: async (accessor: ServicesAccessor) => {
		const apiKeyService = accessor.get(ILeapfrogApiKeyService);
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);

		const provider = await quickInputService.pick(
			[
				{ label: 'OpenAI', value: 'openai' as const },
				{ label: 'Anthropic', value: 'anthropic' as const },
			],
			{ placeHolder: localize('leapfrogSelectProvider', 'Select AI provider') }
		);

		if (!provider?.value) {
			return;
		}

		const key = await quickInputService.input({
			placeHolder: localize('leapfrogApiKeyPlaceholder', 'Paste your API key'),
			prompt: provider.value === 'openai'
				? localize('leapfrogOpenAiKeyPrompt', 'Enter your OpenAI API key (starts with sk-)')
				: localize('leapfrogAnthropicKeyPrompt', 'Enter your Anthropic API key (starts with sk-ant-)'),
			validateInput: async (value) => {
				if (!value?.trim()) {
					return localize('leapfrogApiKeyRequired', 'API key is required');
				}
				return undefined;
			},
		});

		if (key?.trim()) {
			await apiKeyService.setApiKey(provider.value, key.trim());
			notificationService.info(localize('leapfrogApiKeyStored', 'API key stored for {0}', provider.value === 'openai' ? 'OpenAI' : 'Anthropic'));
		}
	}
});

// ---------------------------------------------------------------------------
// Connect to Leapfrog (auth flow for transcription, etc.)
// ---------------------------------------------------------------------------

function getBackendUrl(accessor: ServicesAccessor): string | undefined {
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
	const configService = accessor.get(IConfigurationService);
	const configUrl = configService.getValue<string>(LeapfrogConfigurationKeys.ApiUrl);
	return typeof configUrl === 'string' && configUrl.trim() ? configUrl.trim() : undefined;
}

CommandsRegistry.registerCommand({
	id: 'leapfrog.connect',
	metadata: {
		description: localize('leapfrogConnect', 'Leapfrog: Connect to Leapfrog - Sign in to enable transcription and sync')
	},
	handler: async (accessor: ServicesAccessor) => {
		const openerService = accessor.get(IOpenerService);
		const workspaceContextService = accessor.get(IWorkspaceContextService);
		const fileService = accessor.get(IFileService);
		const notificationService = accessor.get(INotificationService);

		const backendUrl = getBackendUrl(accessor);
		if (!backendUrl) {
			notificationService.error(localize('leapfrogConnectNoBackend', 'Leapfrog API URL not configured. Set leapfrog.api.url in settings or NEXT_PUBLIC_API_URL / LEAPFROG_API_URL.'));
			return;
		}

		const folders = workspaceContextService.getWorkspace().folders;
		if (folders.length === 0) {
			notificationService.warn(localize('leapfrogConnectNoWorkspace', 'Open a workspace folder first, then run Connect to Leapfrog.'));
			return;
		}

		const projectPath = folders[0].uri.fsPath;
		const projectConfig = new LeapfrogProjectConfig(fileService);
		const projectId = await projectConfig.getOrCreateProjectId(projectPath);

		const connectUrl = `${backendUrl.replace(/\/$/, '')}/dashboard/connect-desktop?projectId=${encodeURIComponent(projectId)}`;
		await openerService.open(URI.parse(connectUrl), { openExternal: true });
		notificationService.info(localize('leapfrogConnectOpened', 'Browser opened. Sign in to Leapfrog, then return to the desktop.'));
	}
});

/**
 * Contribution that initializes Leapfrog desktop services
 */
const INDEXING_STATUS_BAR_ID = 'leapfrog.indexing';
const INDEXING_BUSY_STATUSES = ['scanning', 'chunking', 'embedding'] as const;

class LeapfrogDesktopContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.leapfrogDesktop';

	private indexDebounceTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly indexingStatusBarEntry = this._register(new MutableDisposable<IStatusbarEntryAccessor>());

	constructor(
		@ILogService private readonly logService: ILogService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@INotificationService private readonly notificationService: INotificationService,
		@IFileService private readonly fileService: IFileService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@ILeapfrogTagService private readonly tagService: ILeapfrogTagService,
		@ILeapfrogChatHistoryService private readonly chatHistoryService: ILeapfrogChatHistoryService,
		@ILeapfrogIndexService private readonly indexService: ILeapfrogIndexService,
		@IWorkingCopyFileService private readonly workingCopyFileService: IWorkingCopyFileService,
	) {
		super();
		this.logService.info('[Leapfrog] Desktop contribution initialized');
		this.initializeTagDatabase();
		this.initializeChatDatabase();
		this.initializeIndexService();
		this._register(this.indexService.onDidChangeIndexProgress(p => this.updateIndexingStatusBar(p)));
		this._register(this.indexService.onDidIndexComplete(() => {
			this.hideIndexingStatusBar();
			this.checkAndShowIndexToast();
		}));
		// Show status bar if indexing already in progress (e.g. from auto-index on startup)
		this.updateIndexingStatusBar(this.indexService.getProgress());

		// Duplicate tag applications when files are copied
		this._register(this.workingCopyFileService.onDidRunWorkingCopyFileOperation(e => {
			if (e.operation === FileOperation.COPY) {
				this.handleFileCopy(e.files);
			}
			// Re-index on file create/save
			if (e.operation === FileOperation.CREATE || e.operation === FileOperation.COPY) {
				for (const { target } of e.files) {
					this.scheduleFileReindex(target.fsPath);
				}
			}
			// Remove from index on file delete
			if (e.operation === FileOperation.DELETE) {
				for (const { target } of e.files) {
					this.indexService.removeFile(target.fsPath).catch(err =>
						this.logService.error('[Leapfrog] Failed to remove file from index', err)
					);
				}
			}
			// Handle file move/rename
			if (e.operation === FileOperation.MOVE) {
				for (const { source, target } of e.files) {
					if (source) {
						this.indexService.removeFile(source.fsPath).catch(() => { });
					}
					this.scheduleFileReindex(target.fsPath);
				}
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

	private async initializeChatDatabase(): Promise<void> {
		const folders = this.workspaceContextService.getWorkspace().folders;
		if (folders.length > 0) {
			const projectPath = folders[0].uri.fsPath;
			try {
				await this.chatHistoryService.initialize(projectPath);
				this.logService.info('[Leapfrog] Chat history service initialized for workspace:', projectPath);
			} catch (err) {
				this.logService.error('[Leapfrog] Failed to initialize chat history service', err);
			}
		}
	}

	private async initializeIndexService(): Promise<void> {
		const folders = this.workspaceContextService.getWorkspace().folders;
		if (folders.length > 0) {
			const projectPath = folders[0].uri.fsPath;
			try {
				await this.indexService.initialize(projectPath);
				this.logService.info('[Leapfrog] Index service initialized for workspace:', projectPath);
			} catch (err) {
				this.logService.error('[Leapfrog] Failed to initialize index service', err);
			}
		}
	}

	private updateIndexingStatusBar(progress: { status: string; processedFiles?: number; totalFiles?: number; currentFile?: string }): void {
		const isBusy = INDEXING_BUSY_STATUSES.includes(progress.status as typeof INDEXING_BUSY_STATUSES[number]);
		if (!isBusy) {
			this.hideIndexingStatusBar();
			return;
		}
		// Show notification toast when indexing starts (first busy status)
		if (!this.indexingStatusBarEntry.value) {
			this.notificationService.info(localize('leapfrogIndexingStarted', 'Indexing workspace...'));
		}
		const statusLabel = progress.status === 'scanning' ? 'Scanning' : progress.status === 'chunking' ? 'Chunking' : 'Embedding';
		const detail = progress.totalFiles
			? ` ${progress.processedFiles ?? 0}/${progress.totalFiles} files`
			: progress.currentFile
				? ` ${(progress.currentFile.split(/[/\\]/).pop() ?? '')}`
				: '';
		const text = `$(sync~spin) ${statusLabel}${detail}`;
		const tooltip = localize('leapfrogIndexingStatus', 'Leapfrog: Indexing workspace{0}', detail || '...');
		const entry: IStatusbarEntry = {
			name: localize('leapfrogIndexing', 'Leapfrog Indexing'),
			text,
			ariaLabel: tooltip,
			tooltip,
			showProgress: 'loading',
			command: LEAPFROG_PREFERENCES_VIEWLET_ID,
		};
		try {
			if (!this.indexingStatusBarEntry.value) {
				this.indexingStatusBarEntry.value = this.statusbarService.addEntry(
					entry,
					INDEXING_STATUS_BAR_ID,
					StatusbarAlignment.LEFT,
					100
				);
			} else {
				this.indexingStatusBarEntry.value.update(entry);
			}
		} catch (err) {
			this.logService.warn('[Leapfrog] Failed to update indexing status bar:', err);
		}
	}

	private hideIndexingStatusBar(): void {
		this.indexingStatusBarEntry.clear();
	}

	/**
	 * Check merkle tree on every startup (runs after index completes).
	 * Compares local vs remote; automatically syncs changed files to backend.
	 */
	private async checkAndShowIndexToast(): Promise<void> {
		const folders = this.workspaceContextService.getWorkspace().folders;
		if (folders.length === 0) {
			this.logService.info('[Leapfrog] Index toast: no workspace folders');
			return;
		}

		const projectPath = folders[0].uri.fsPath;
		const projectConfig = new LeapfrogProjectConfig(this.fileService);
		const projectId = await projectConfig.getOrCreateProjectId(projectPath);
		this.logService.info(`[Leapfrog] checkAndShowIndexToast: projectId=${projectId}`);

		try {
			const syncService = new LeapfrogSyncService(this.fileService, this.logService);
			this.logService.info('[Leapfrog] Ensuring project exists on backend');
			await syncService.ensureProject(projectId, projectPath.split(/[/\\]/).pop() ?? 'Workspace');

			this.logService.info('[Leapfrog] Fetching remote merkle tree');
			const remote = await syncService.fetchRemoteMerkleTree(projectId);

			const indexSvc = this.indexService as LeapfrogIndexService;
			const localTree = await indexSvc.getMerkleTreeForSync();
			if (!localTree) {
				this.logService.info('[Leapfrog] No local merkle tree (no indexed files yet)');
				return;
			}

			const merkleTree = indexSvc.getMerkleTreeService();
			const changed = merkleTree.compareTrees(localTree, remote);
			this.logService.info(`[Leapfrog] Merkle tree comparison: ${changed.length} changed files`);

			if (changed.length === 0) {
				this.logService.info('[Leapfrog] No changes (local matches remote)');
				return;
			}

			// Automatically trigger sync without waiting for user input
			this.logService.info(`[Leapfrog] Auto-syncing ${changed.length} changed files to backend`);
			this.notificationService.info(localize('leapfrogSyncing', 'Syncing {0} files to cloud index...', String(changed.length)));

			try {
				const result = await this.indexService.syncToBackend(projectId);
				if (result) {
					this.logService.info(`[Leapfrog] Sync complete: ${result.changedCount} files synced`);
					this.notificationService.info(localize('leapfrogSyncComplete', 'Synced {0} files to cloud index.', String(result.changedCount)));
				}
			} catch (err) {
				const msg = LeapfrogSyncService.getSyncErrorMessage(err);
				this.logService.error(`[Leapfrog] Sync failed: ${msg}`, err);
				this.notificationService.error(localize('leapfrogSyncFailed', 'Failed to sync: {0}', msg));
			}
		} catch (err) {
			this.logService.warn('[Leapfrog] Index toast check failed:', err);
		}
	}

	private scheduleFileReindex(filePath: string): void {
		// Debounce re-indexing for 2 seconds
		if (this.indexDebounceTimer) {
			clearTimeout(this.indexDebounceTimer);
		}
		this.indexDebounceTimer = setTimeout(() => {
			this.indexService.indexFile(filePath).catch(err =>
				this.logService.error('[Leapfrog] Failed to re-index file', err)
			);
		}, 2000);
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
		if (this.indexDebounceTimer) {
			clearTimeout(this.indexDebounceTimer);
		}
		this.tagService.close().catch(err =>
			this.logService.error('[Leapfrog] Error closing tag database', err)
		);
		this.chatHistoryService.close().catch(err =>
			this.logService.error('[Leapfrog] Error closing chat history database', err)
		);
		this.indexService.close().catch(err =>
			this.logService.error('[Leapfrog] Error closing index service', err)
		);
		super.dispose();
	}
}

// Register contributions
registerWorkbenchContribution2(LeapfrogDesktopContribution.ID, LeapfrogDesktopContribution, WorkbenchPhase.AfterRestored);