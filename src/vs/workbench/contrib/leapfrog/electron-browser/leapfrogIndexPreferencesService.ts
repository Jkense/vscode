/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Leapfrog Index Preferences Service - manages file indexing preferences and scanning.
 *
 * Scans workspace to identify which files match the indexing patterns,
 * tracking which files are indexed vs. should be indexed.
 */

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { URI } from '../../../../base/common/uri.js';
import {
	ILeapfrogIndexPreferencesService,
	ILeapfrogIndexPreferences,
	IIndexableFile,
} from '../common/leapfrog.js';
import { LeapfrogIndexJsonDatabase } from './leapfrogIndexJsonDatabase.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default patterns to include in indexing */
const DEFAULT_INCLUDE_PATTERNS = ['**/*.md', '**/*.markdown', '**/*.txt', '**/*.transcript.json'];

/** Default patterns to exclude from indexing */
const DEFAULT_EXCLUDE_PATTERNS = ['.git', '.leapfrog', '.vscode', 'node_modules', '.DS_Store'];

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class LeapfrogIndexPreferencesService extends Disposable implements ILeapfrogIndexPreferencesService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangePreferences = this._register(new Emitter<void>());
	readonly onDidChangePreferences: Event<void> = this._onDidChangePreferences.event;

	private projectPath: string | undefined;
	private initialized = false;

	private preferences: ILeapfrogIndexPreferences = {
		includePatterns: [...DEFAULT_INCLUDE_PATTERNS],
		excludePatterns: [...DEFAULT_EXCLUDE_PATTERNS],
		autoIndex: true,
		totalFiles: 0,
		indexedFiles: 0,
		shouldIndexFiles: 0,
	};

	private indexedFilesSet: Set<string> = new Set();
	private db: LeapfrogIndexJsonDatabase | undefined;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		// Listen for configuration changes
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('leapfrog.index')) {
				this.loadPreferences();
				this._onDidChangePreferences.fire();
			}
		}));
	}

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	async initialize(projectPath: string): Promise<void> {
		if (this.initialized) {
			await this.close();
		}

		this.projectPath = projectPath;
		this.db = new LeapfrogIndexJsonDatabase(this.fileService);
		await this.db.open(projectPath);
		await this.loadPreferences();
		await this.loadIndexedFiles();
		this.initialized = true;
		this.logService.info('[Leapfrog] Index Preferences Service initialized');
	}

	async close(): Promise<void> {
		if (this.db) {
			await this.db.close();
			this.db = undefined;
		}
		this.initialized = false;
	}

	// -----------------------------------------------------------------------
	// Preferences
	// -----------------------------------------------------------------------

	private loadPreferences(): void {
		const config = this.configurationService.getValue('leapfrog.index') as { includePatterns?: string[]; excludePatterns?: string[]; autoIndex?: boolean } | undefined;

		if (config) {
			this.preferences.includePatterns = config.includePatterns || DEFAULT_INCLUDE_PATTERNS;
			this.preferences.excludePatterns = config.excludePatterns || DEFAULT_EXCLUDE_PATTERNS;
			this.preferences.autoIndex = config.autoIndex !== false;
		} else {
			this.preferences.includePatterns = DEFAULT_INCLUDE_PATTERNS;
			this.preferences.excludePatterns = DEFAULT_EXCLUDE_PATTERNS;
			this.preferences.autoIndex = true;
		}
	}

	async getPreferences(): Promise<ILeapfrogIndexPreferences> {
		return Promise.resolve({ ...this.preferences });
	}

	async updatePreferences(data: { includePatterns?: string[]; excludePatterns?: string[]; autoIndex?: boolean }): Promise<void> {
		if (data.includePatterns !== undefined) {
			await this.configurationService.updateValue('leapfrog.index.includePatterns', data.includePatterns);
		}
		if (data.excludePatterns !== undefined) {
			await this.configurationService.updateValue('leapfrog.index.excludePatterns', data.excludePatterns);
		}
		if (data.autoIndex !== undefined) {
			await this.configurationService.updateValue('leapfrog.index.autoIndex', data.autoIndex);
		}

		if (Object.keys(data).length > 0) {
			await this.loadPreferences();
			this._onDidChangePreferences.fire();
		}
	}

	// -----------------------------------------------------------------------
	// File Scanning
	// -----------------------------------------------------------------------

	private async loadIndexedFiles(): Promise<void> {
		if (!this.db) {
			return;
		}

		try {
			// Get all indexed files from the database
			const chunks = this.db.getAllChunks();
			this.indexedFilesSet.clear();

			for (const chunk of chunks) {
				this.indexedFilesSet.add(chunk.file_path);
			}

			this.logService.debug(`[Leapfrog] Loaded ${this.indexedFilesSet.size} indexed files`);
		} catch (error) {
			this.logService.error('[Leapfrog] Error loading indexed files:', error);
		}
	}

	async scanWorkspace(): Promise<IIndexableFile[]> {
		if (!this.projectPath) {
			return [];
		}

		const projectUri = URI.file(this.projectPath);
		const files: IIndexableFile[] = [];

		try {
			await this.scanRecursive(projectUri, files);
			this.updateStats(files);
		} catch (error) {
			this.logService.error('[Leapfrog] Error scanning workspace:', error);
		}

		return files;
	}

	private async scanRecursive(uri: URI, files: IIndexableFile[]): Promise<void> {
		try {
			const entries = await this.fileService.resolve(uri, { resolveMetadata: true });

			if (!entries.children) {
				return;
			}

			for (const child of entries.children) {
				if (this.shouldExclude(child.resource)) {
					continue;
				}

				if (child.isDirectory) {
					await this.scanRecursive(child.resource, files);
				} else {
					const isIndexed = this.indexedFilesSet.has(child.resource.fsPath);
					const shouldIndex = this.matchesIncludePattern(child.resource);

					files.push({
						path: child.resource.fsPath,
						fileName: child.name,
						size: child.size ?? 0,
						mtime: child.mtime ?? 0,
						isIndexed,
						shouldIndex,
						reason: this.getReasonForFile(child.resource, shouldIndex),
					});
				}
			}
		} catch (error) {
			this.logService.debug('[Leapfrog] Error scanning directory:', error);
		}
	}

	private shouldExclude(uri: URI): boolean {
		const path = uri.fsPath;

		for (const pattern of this.preferences.excludePatterns) {
			if (this.matchesPattern(path, pattern)) {
				return true;
			}
		}

		return false;
	}

	private matchesIncludePattern(uri: URI): boolean {
		const path = uri.fsPath;

		for (const pattern of this.preferences.includePatterns) {
			if (this.matchesPattern(path, pattern)) {
				return true;
			}
		}

		return false;
	}

	private matchesPattern(path: string, pattern: string): boolean {
		// Simple glob matching
		// Converts patterns like "**/*.md" to regex

		// Normalize separators
		const normalizedPath = path.replace(/\\/g, '/');
		const normalizedPattern = pattern.replace(/\\/g, '/');

		// Handle ** (match any number of directories)
		let regex = normalizedPattern
			.replace(/\./g, '\\.')
			.replace(/\*/g, '[^/]*')
			.replace(/\[\^\/\]\*\[\^\/\]\*/g, '.*');

		// Handle ** more correctly
		regex = regex.replace(/\/\.\*\//g, '(/.*)?/');

		const fullRegex = new RegExp(`(^|/)${regex}$`, 'i');
		return fullRegex.test(normalizedPath);
	}

	private getReasonForFile(uri: URI, shouldIndex: boolean): string | undefined {
		if (shouldIndex && !this.indexedFilesSet.has(uri.fsPath)) {
			return 'Matches indexing pattern';
		}
		if (!shouldIndex) {
			for (const pattern of this.preferences.excludePatterns) {
				if (this.matchesPattern(uri.fsPath, pattern)) {
					return `Excluded by pattern: ${pattern}`;
				}
			}
			const ext = uri.path.substring(uri.path.lastIndexOf('.'));
			return `File extension not in indexing patterns (${ext})`;
		}
		return undefined;
	}

	async getIndexableFiles(): Promise<IIndexableFile[]> {
		const files = await this.scanWorkspace();
		return files.filter(f => f.shouldIndex);
	}

	async getIndexedFiles(): Promise<IIndexableFile[]> {
		const files = await this.scanWorkspace();
		return files.filter(f => f.isIndexed);
	}

	async getShouldIndexFiles(): Promise<IIndexableFile[]> {
		const files = await this.scanWorkspace();
		return files.filter(f => f.shouldIndex && !f.isIndexed);
	}

	// -----------------------------------------------------------------------
	// Statistics
	// -----------------------------------------------------------------------

	private updateStats(files: IIndexableFile[]): void {
		this.preferences.totalFiles = files.length;
		this.preferences.indexedFiles = files.filter(f => f.isIndexed).length;
		this.preferences.shouldIndexFiles = files.filter(f => f.shouldIndex && !f.isIndexed).length;
	}

	async getStats(): Promise<{ total: number; indexed: number; shouldIndex: number }> {
		const files = await this.scanWorkspace();
		return {
			total: files.length,
			indexed: files.filter(f => f.isIndexed).length,
			shouldIndex: files.filter(f => f.shouldIndex && !f.isIndexed).length,
		};
	}
}
