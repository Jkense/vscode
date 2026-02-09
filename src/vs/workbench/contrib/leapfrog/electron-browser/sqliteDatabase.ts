/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * JSON-file-backed database for Leapfrog project data.
 *
 * All data lives in memory; writes are debounced to `.leapfrog/leapfrog.json`
 * via IFileService (which works in the renderer via DI).
 */

import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { joinPath } from '../../../../base/common/resources.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ITagRow {
	id: string;
	name: string;
	description: string | null;
	color: string;
	parent_id: string | null;
	sort_order: number;
	created_at: string;
	updated_at: string;
}

export interface ITagApplicationRow {
	id: string;
	tag_id: string;
	file_path: string;
	start_offset: number;
	end_offset: number;
	selected_text: string;
	prefix: string | null;
	suffix: string | null;
	note: string | null;
	created_by: string;
	created_at: string;
}

export interface ITagApplicationWithTagRow extends ITagApplicationRow {
	tag_name: string;
	tag_color: string;
	tag_description: string | null;
}

export interface ITagWithCountRow extends ITagRow {
	application_count: number;
}

// ---------------------------------------------------------------------------
// Internal store shape
// ---------------------------------------------------------------------------

interface ILeapfrogStore {
	version: number;
	tags: ITagRow[];
	tag_applications: ITagApplicationRow[];
}

// ---------------------------------------------------------------------------
// Database wrapper
// ---------------------------------------------------------------------------

export class LeapfrogJsonDatabase extends Disposable {

	private store: ILeapfrogStore | undefined;
	private fileUri: URI | undefined;
	private dirty = false;

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
		const leapfrogDir = joinPath(projectUri, '.leapfrog');
		this.fileUri = joinPath(leapfrogDir, 'leapfrog.json');

		try {
			const content = await this.fileService.readFile(this.fileUri);
			this.store = JSON.parse(content.value.toString());
		} catch {
			// File doesn't exist or is invalid - start fresh
			this.store = { version: 1, tags: [], tag_applications: [] };
			try {
				await this.fileService.createFolder(leapfrogDir);
			} catch {
				// Folder may already exist
			}
			await this.flush();
		}
	}

	async close(): Promise<void> {
		if (this.dirty) {
			this.saveScheduler.cancel();
			await this.flush();
		}
		this.store = undefined;
		this.fileUri = undefined;
	}

	private get data(): ILeapfrogStore {
		if (!this.store) {
			throw new Error('Database not open');
		}
		return this.store;
	}

	// -----------------------------------------------------------------------
	// Persistence
	// -----------------------------------------------------------------------

	private async flush(): Promise<void> {
		if (!this.store || !this.fileUri) {
			return;
		}
		const json = JSON.stringify(this.store, null, '\t');
		await this.fileService.writeFile(this.fileUri, VSBuffer.fromString(json));
		this.dirty = false;
	}

	private scheduleSave(): void {
		this.dirty = true;
		this.saveScheduler.schedule();
	}

	// -----------------------------------------------------------------------
	// Tag CRUD
	// -----------------------------------------------------------------------

	async getAllTags(): Promise<ITagRow[]> {
		return this.data.tags
			.slice()
			.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
	}

	async getAllTagsWithCounts(): Promise<ITagWithCountRow[]> {
		const apps = this.data.tag_applications;
		const countMap = new Map<string, number>();
		for (const app of apps) {
			countMap.set(app.tag_id, (countMap.get(app.tag_id) ?? 0) + 1);
		}

		return this.data.tags
			.slice()
			.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
			.map(tag => ({
				...tag,
				application_count: countMap.get(tag.id) ?? 0,
			}));
	}

	async getTag(id: string): Promise<ITagRow | undefined> {
		return this.data.tags.find(t => t.id === id);
	}

	async insertTag(tag: {
		id: string;
		name: string;
		description?: string;
		color: string;
		parent_id?: string;
		sort_order?: number;
	}): Promise<void> {
		const now = new Date().toISOString();
		this.data.tags.push({
			id: tag.id,
			name: tag.name,
			description: tag.description ?? null,
			color: tag.color,
			parent_id: tag.parent_id ?? null,
			sort_order: tag.sort_order ?? 0,
			created_at: now,
			updated_at: now,
		});
		this.scheduleSave();
	}

	async updateTag(id: string, data: {
		name?: string;
		description?: string | null;
		color?: string;
		parent_id?: string | null;
		sort_order?: number;
	}): Promise<void> {
		const tag = this.data.tags.find(t => t.id === id);
		if (!tag) {
			return;
		}

		if (data.name !== undefined) { tag.name = data.name; }
		if (data.description !== undefined) { tag.description = data.description; }
		if (data.color !== undefined) { tag.color = data.color; }
		if (data.parent_id !== undefined) { tag.parent_id = data.parent_id; }
		if (data.sort_order !== undefined) { tag.sort_order = data.sort_order; }

		tag.updated_at = new Date().toISOString();
		this.scheduleSave();
	}

	async deleteTag(id: string): Promise<void> {
		// Cascade: remove all applications for this tag
		this.data.tag_applications = this.data.tag_applications.filter(a => a.tag_id !== id);

		// SET NULL parent_id refs
		for (const tag of this.data.tags) {
			if (tag.parent_id === id) {
				tag.parent_id = null;
			}
		}

		// Remove the tag itself
		this.data.tags = this.data.tags.filter(t => t.id !== id);

		this.scheduleSave();
	}

	// -----------------------------------------------------------------------
	// Tag Application CRUD
	// -----------------------------------------------------------------------

	async getApplicationsForTag(tagId: string): Promise<ITagApplicationRow[]> {
		return this.data.tag_applications
			.filter(a => a.tag_id === tagId)
			.sort((a, b) => a.file_path.localeCompare(b.file_path) || a.start_offset - b.start_offset);
	}

	async getApplicationsForFile(filePath: string): Promise<ITagApplicationWithTagRow[]> {
		const tagMap = new Map<string, ITagRow>();
		for (const tag of this.data.tags) {
			tagMap.set(tag.id, tag);
		}

		return this.data.tag_applications
			.filter(a => a.file_path === filePath)
			.sort((a, b) => a.start_offset - b.start_offset)
			.map(a => {
				const tag = tagMap.get(a.tag_id);
				return {
					...a,
					tag_name: tag?.name ?? '',
					tag_color: tag?.color ?? '#22c55e',
					tag_description: tag?.description ?? null,
				};
			});
	}

	async getApplicationCountForTag(tagId: string): Promise<number> {
		return this.data.tag_applications.filter(a => a.tag_id === tagId).length;
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
		this.data.tag_applications.push({
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
		});
		this.scheduleSave();
	}

	async removeTagApplication(id: string): Promise<void> {
		this.data.tag_applications = this.data.tag_applications.filter(a => a.id !== id);
		this.scheduleSave();
	}

	async removeApplicationsForFile(filePath: string): Promise<void> {
		this.data.tag_applications = this.data.tag_applications.filter(a => a.file_path !== filePath);
		this.scheduleSave();
	}

	async updateApplicationAnchors(updates: { id: string; start_offset: number; end_offset: number; selected_text: string }[]): Promise<void> {
		for (const u of updates) {
			const app = this.data.tag_applications.find(a => a.id === u.id);
			if (app) {
				app.start_offset = u.start_offset;
				app.end_offset = u.end_offset;
				app.selected_text = u.selected_text;
			}
		}
		if (updates.length > 0) {
			this.scheduleSave();
		}
	}
}
