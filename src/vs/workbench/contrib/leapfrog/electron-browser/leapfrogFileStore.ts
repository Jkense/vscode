/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Per-entity file-backed store for Leapfrog project data.
 *
 * Each tag and tag application is stored as an individual JSON file under
 * `.leapfrog/tags/{uuid}.json` and `.leapfrog/applications/{uuid}.json`.
 * This produces clean git diffs and minimal merge conflicts.
 *
 * All data lives in memory; writes are debounced to disk via IFileService.
 */

import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { joinPath } from '../../../../base/common/resources.js';
import { ITagRow, ITagApplicationRow, ITagWithCountRow, ITagApplicationWithTagRow } from './sqliteDatabase.js';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ILeapfrogMeta {
	version: number;
}

interface ILegacyStore {
	version: number;
	tags: ITagRow[];
	tag_applications: ITagApplicationRow[];
}

// ---------------------------------------------------------------------------
// File Store
// ---------------------------------------------------------------------------

export class LeapfrogFileStore extends Disposable {

	private readonly tags = new Map<string, ITagRow>();
	private readonly applications = new Map<string, ITagApplicationRow>();

	private readonly dirtyTags = new Set<string>();
	private readonly dirtyApps = new Set<string>();
	private readonly deletedTags = new Set<string>();
	private readonly deletedApps = new Set<string>();

	private leapfrogDir: URI | undefined;
	private tagsDir: URI | undefined;
	private appsDir: URI | undefined;
	private opened = false;

	private lastFlushDescription = '';

	private readonly saveScheduler = this._register(new RunOnceScheduler(() => this.flush(), 500));

	constructor(
		private readonly fileService: IFileService,
	) {
		super();
	}

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	async open(projectPath: string): Promise<void> {
		const projectUri = URI.file(projectPath);
		this.leapfrogDir = joinPath(projectUri, '.leapfrog');
		this.tagsDir = joinPath(this.leapfrogDir, 'tags');
		this.appsDir = joinPath(this.leapfrogDir, 'applications');

		const metaUri = joinPath(this.leapfrogDir, 'meta.json');

		// Check for meta.json (v2+)
		let migrated = false;
		try {
			const metaContent = await this.fileService.readFile(metaUri);
			const meta: ILeapfrogMeta = JSON.parse(metaContent.value.toString());
			if (meta.version >= 2) {
				await this.loadPerEntityFiles();
			}
		} catch {
			// meta.json doesn't exist - check for legacy leapfrog.json
			const legacyUri = joinPath(this.leapfrogDir, 'leapfrog.json');
			try {
				const legacyContent = await this.fileService.readFile(legacyUri);
				const legacy: ILegacyStore = JSON.parse(legacyContent.value.toString());
				await this.migrateFromLegacy(legacy, legacyUri);
				migrated = true;
			} catch {
				// Neither exists - fresh project
				await this.createFreshProject();
			}
		}

		if (!migrated) {
			// Ensure dirs exist (idempotent)
			await this.ensureDirs();
		}

		// Write .gitignore for .leapfrog/
		await this.ensureGitIgnore();

		this.opened = true;
	}

	async close(): Promise<void> {
		if (this.hasDirtyData()) {
			this.saveScheduler.cancel();
			await this.flush();
		}
		this.tags.clear();
		this.applications.clear();
		this.dirtyTags.clear();
		this.dirtyApps.clear();
		this.deletedTags.clear();
		this.deletedApps.clear();
		this.opened = false;
	}

	private assertOpen(): void {
		if (!this.opened) {
			throw new Error('LeapfrogFileStore not open');
		}
	}

	// -----------------------------------------------------------------------
	// Persistence
	// -----------------------------------------------------------------------

	async flush(): Promise<string> {
		if (!this.leapfrogDir || !this.tagsDir || !this.appsDir) {
			return '';
		}

		const descriptions: string[] = [];

		// Write dirty tags
		for (const id of this.dirtyTags) {
			const tag = this.tags.get(id);
			if (tag) {
				const uri = joinPath(this.tagsDir, `${id}.json`);
				await this.fileService.writeFile(uri, VSBuffer.fromString(JSON.stringify(tag, null, '\t')));
			}
		}
		if (this.dirtyTags.size > 0) {
			descriptions.push(`Updated ${this.dirtyTags.size} tag(s)`);
		}

		// Delete removed tags
		for (const id of this.deletedTags) {
			const uri = joinPath(this.tagsDir, `${id}.json`);
			try {
				await this.fileService.del(uri);
			} catch {
				// File may not exist
			}
		}
		if (this.deletedTags.size > 0) {
			descriptions.push(`Deleted ${this.deletedTags.size} tag(s)`);
		}

		// Write dirty applications
		for (const id of this.dirtyApps) {
			const app = this.applications.get(id);
			if (app) {
				const uri = joinPath(this.appsDir, `${id}.json`);
				await this.fileService.writeFile(uri, VSBuffer.fromString(JSON.stringify(app, null, '\t')));
			}
		}
		if (this.dirtyApps.size > 0) {
			descriptions.push(`Updated ${this.dirtyApps.size} application(s)`);
		}

		// Delete removed applications
		for (const id of this.deletedApps) {
			const uri = joinPath(this.appsDir, `${id}.json`);
			try {
				await this.fileService.del(uri);
			} catch {
				// File may not exist
			}
		}
		if (this.deletedApps.size > 0) {
			descriptions.push(`Deleted ${this.deletedApps.size} application(s)`);
		}

		this.dirtyTags.clear();
		this.dirtyApps.clear();
		this.deletedTags.clear();
		this.deletedApps.clear();

		this.lastFlushDescription = descriptions.join('; ');
		return this.lastFlushDescription;
	}

	getLastFlushDescription(): string {
		return this.lastFlushDescription;
	}

	private hasDirtyData(): boolean {
		return this.dirtyTags.size > 0 || this.dirtyApps.size > 0 ||
			this.deletedTags.size > 0 || this.deletedApps.size > 0;
	}

	private scheduleSave(): void {
		this.saveScheduler.schedule();
	}

	// -----------------------------------------------------------------------
	// Tag CRUD
	// -----------------------------------------------------------------------

	async getAllTags(): Promise<ITagRow[]> {
		this.assertOpen();
		return Array.from(this.tags.values())
			.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
	}

	async getAllTagsWithCounts(): Promise<ITagWithCountRow[]> {
		this.assertOpen();
		const countMap = new Map<string, number>();
		for (const app of this.applications.values()) {
			countMap.set(app.tag_id, (countMap.get(app.tag_id) ?? 0) + 1);
		}

		return Array.from(this.tags.values())
			.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
			.map(tag => ({
				...tag,
				application_count: countMap.get(tag.id) ?? 0,
			}));
	}

	async getTag(id: string): Promise<ITagRow | undefined> {
		this.assertOpen();
		return this.tags.get(id);
	}

	async insertTag(tag: {
		id: string;
		name: string;
		description?: string;
		color: string;
		parent_id?: string;
		sort_order?: number;
	}): Promise<void> {
		this.assertOpen();
		const now = new Date().toISOString();
		const row: ITagRow = {
			id: tag.id,
			name: tag.name,
			description: tag.description ?? null,
			color: tag.color,
			parent_id: tag.parent_id ?? null,
			sort_order: tag.sort_order ?? 0,
			created_at: now,
			updated_at: now,
		};
		this.tags.set(tag.id, row);
		this.dirtyTags.add(tag.id);
		this.scheduleSave();
	}

	async updateTag(id: string, data: {
		name?: string;
		description?: string | null;
		color?: string;
		parent_id?: string | null;
		sort_order?: number;
	}): Promise<void> {
		this.assertOpen();
		const tag = this.tags.get(id);
		if (!tag) {
			return;
		}

		if (data.name !== undefined) { tag.name = data.name; }
		if (data.description !== undefined) { tag.description = data.description; }
		if (data.color !== undefined) { tag.color = data.color; }
		if (data.parent_id !== undefined) { tag.parent_id = data.parent_id; }
		if (data.sort_order !== undefined) { tag.sort_order = data.sort_order; }

		tag.updated_at = new Date().toISOString();
		this.dirtyTags.add(id);
		this.scheduleSave();
	}

	async deleteTag(id: string): Promise<void> {
		this.assertOpen();

		// Cascade: remove all applications for this tag
		const appsToDelete: string[] = [];
		for (const [appId, app] of this.applications) {
			if (app.tag_id === id) {
				appsToDelete.push(appId);
			}
		}
		for (const appId of appsToDelete) {
			this.applications.delete(appId);
			this.dirtyApps.delete(appId);
			this.deletedApps.add(appId);
		}

		// SET NULL parent_id refs
		for (const tag of this.tags.values()) {
			if (tag.parent_id === id) {
				tag.parent_id = null;
				this.dirtyTags.add(tag.id);
			}
		}

		// Remove the tag itself
		this.tags.delete(id);
		this.dirtyTags.delete(id);
		this.deletedTags.add(id);

		this.scheduleSave();
	}

	// -----------------------------------------------------------------------
	// Tag Application CRUD
	// -----------------------------------------------------------------------

	async getApplicationsForTag(tagId: string): Promise<ITagApplicationRow[]> {
		this.assertOpen();
		return Array.from(this.applications.values())
			.filter(a => a.tag_id === tagId)
			.sort((a, b) => a.file_path.localeCompare(b.file_path) || a.start_offset - b.start_offset);
	}

	async getApplicationsForFile(filePath: string): Promise<ITagApplicationWithTagRow[]> {
		this.assertOpen();

		return Array.from(this.applications.values())
			.filter(a => a.file_path === filePath)
			.sort((a, b) => a.start_offset - b.start_offset)
			.map(a => {
				const tag = this.tags.get(a.tag_id);
				return {
					...a,
					tag_name: tag?.name ?? '',
					tag_color: tag?.color ?? '#22c55e',
					tag_description: tag?.description ?? null,
				};
			});
	}

	async getApplicationCountForTag(tagId: string): Promise<number> {
		this.assertOpen();
		let count = 0;
		for (const app of this.applications.values()) {
			if (app.tag_id === tagId) {
				count++;
			}
		}
		return count;
	}

	async insertTagApplication(app: {
		id: string;
		tag_id: string;
		file_path: string;
		start_offset: number;
		end_offset: number;
		selected_text: string;
		prefix?: string;
		suffix?: string;
		note?: string;
		created_by?: string;
	}): Promise<void> {
		this.assertOpen();
		const row: ITagApplicationRow = {
			id: app.id,
			tag_id: app.tag_id,
			file_path: app.file_path,
			start_offset: app.start_offset,
			end_offset: app.end_offset,
			selected_text: app.selected_text,
			prefix: app.prefix ?? null,
			suffix: app.suffix ?? null,
			note: app.note ?? null,
			created_by: app.created_by ?? 'user',
			created_at: new Date().toISOString(),
		};
		this.applications.set(app.id, row);
		this.dirtyApps.add(app.id);
		this.scheduleSave();
	}

	async removeTagApplication(id: string): Promise<void> {
		this.assertOpen();
		this.applications.delete(id);
		this.dirtyApps.delete(id);
		this.deletedApps.add(id);
		this.scheduleSave();
	}

	async removeApplicationsForFile(filePath: string): Promise<void> {
		this.assertOpen();
		const toDelete: string[] = [];
		for (const [id, app] of this.applications) {
			if (app.file_path === filePath) {
				toDelete.push(id);
			}
		}
		for (const id of toDelete) {
			this.applications.delete(id);
			this.dirtyApps.delete(id);
			this.deletedApps.add(id);
		}
		if (toDelete.length > 0) {
			this.scheduleSave();
		}
	}

	async updateApplicationAnchors(updates: { id: string; start_offset: number; end_offset: number; selected_text: string }[]): Promise<void> {
		this.assertOpen();
		for (const u of updates) {
			const app = this.applications.get(u.id);
			if (app) {
				app.start_offset = u.start_offset;
				app.end_offset = u.end_offset;
				app.selected_text = u.selected_text;
				this.dirtyApps.add(u.id);
			}
		}
		if (updates.length > 0) {
			this.scheduleSave();
		}
	}

	// -----------------------------------------------------------------------
	// Init helpers
	// -----------------------------------------------------------------------

	private async ensureDirs(): Promise<void> {
		if (!this.leapfrogDir || !this.tagsDir || !this.appsDir) {
			return;
		}
		for (const dir of [this.leapfrogDir, this.tagsDir, this.appsDir]) {
			try {
				await this.fileService.createFolder(dir);
			} catch {
				// Folder may already exist
			}
		}
	}

	private async ensureGitIgnore(): Promise<void> {
		if (!this.leapfrogDir) {
			return;
		}
		const gitignoreUri = joinPath(this.leapfrogDir, '.gitignore');
		try {
			await this.fileService.readFile(gitignoreUri);
			// Already exists
		} catch {
			await this.fileService.writeFile(gitignoreUri, VSBuffer.fromString('*.backup\n'));
		}
	}

	private async loadPerEntityFiles(): Promise<void> {
		if (!this.tagsDir || !this.appsDir) {
			return;
		}

		await this.ensureDirs();

		// Load tags
		try {
			const tagFiles = await this.fileService.resolve(this.tagsDir);
			if (tagFiles.children) {
				for (const child of tagFiles.children) {
					if (child.name.endsWith('.json')) {
						try {
							const content = await this.fileService.readFile(child.resource);
							const tag: ITagRow = JSON.parse(content.value.toString());
							this.tags.set(tag.id, tag);
						} catch {
							// Skip malformed files
						}
					}
				}
			}
		} catch {
			// Tags dir may be empty
		}

		// Load applications
		try {
			const appFiles = await this.fileService.resolve(this.appsDir);
			if (appFiles.children) {
				for (const child of appFiles.children) {
					if (child.name.endsWith('.json')) {
						try {
							const content = await this.fileService.readFile(child.resource);
							const app: ITagApplicationRow = JSON.parse(content.value.toString());
							this.applications.set(app.id, app);
						} catch {
							// Skip malformed files
						}
					}
				}
			}
		} catch {
			// Applications dir may be empty
		}
	}

	private async migrateFromLegacy(legacy: ILegacyStore, legacyUri: URI): Promise<void> {
		if (!this.leapfrogDir || !this.tagsDir || !this.appsDir) {
			return;
		}

		await this.ensureDirs();

		// Populate in-memory maps
		for (const tag of legacy.tags) {
			this.tags.set(tag.id, tag);
			this.dirtyTags.add(tag.id);
		}
		for (const app of legacy.tag_applications) {
			this.applications.set(app.id, app);
			this.dirtyApps.add(app.id);
		}

		// Write all per-entity files
		await this.flush();

		// Write meta.json
		const metaUri = joinPath(this.leapfrogDir, 'meta.json');
		await this.fileService.writeFile(metaUri, VSBuffer.fromString(JSON.stringify({ version: 2 }, null, '\t')));

		// Rename old file to backup
		const backupUri = joinPath(this.leapfrogDir, 'leapfrog.json.backup');
		try {
			await this.fileService.move(legacyUri, backupUri, true);
		} catch {
			// If move fails, try copy + delete
			try {
				await this.fileService.copy(legacyUri, backupUri, true);
				await this.fileService.del(legacyUri);
			} catch {
				// Best effort - old file remains
			}
		}
	}

	private async createFreshProject(): Promise<void> {
		if (!this.leapfrogDir) {
			return;
		}

		await this.ensureDirs();

		// Write meta.json
		const metaUri = joinPath(this.leapfrogDir, 'meta.json');
		await this.fileService.writeFile(metaUri, VSBuffer.fromString(JSON.stringify({ version: 2 }, null, '\t')));
	}
}
