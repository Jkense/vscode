/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Desktop implementation of ILeapfrogTagService.
 *
 * Wraps LeapfrogSQLiteDatabase, keeps an in-memory cache of the tag tree,
 * and fires events on mutations so the Tags view refreshes.
 */

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { basename } from '../../../../base/common/path.js';
import {
	ILeapfrogTagService,
	ILeapfrogTagWithCount,
	ILeapfrogTagFileGroup,
	ILeapfrogTagApplication,
	ITextAnchor,
} from '../common/leapfrog.js';
import { LeapfrogSQLiteDatabase, ITagWithCountRow } from './sqliteDatabase.js';

export class LeapfrogTagService extends Disposable implements ILeapfrogTagService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeTags = this._register(new Emitter<void>());
	readonly onDidChangeTags: Event<void> = this._onDidChangeTags.event;

	private readonly _onDidChangeTagApplications = this._register(new Emitter<void>());
	readonly onDidChangeTagApplications: Event<void> = this._onDidChangeTagApplications.event;

	private readonly db = new LeapfrogSQLiteDatabase();

	/** Cached tag tree - invalidated on writes */
	private cachedTags: ILeapfrogTagWithCount[] | undefined;
	private initialized = false;

	constructor(
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	async initialize(projectPath: string): Promise<void> {
		if (this.initialized) {
			await this.close();
		}
		await this.db.open(projectPath);
		this.initialized = true;
		this.cachedTags = undefined;
		this.logService.info('[Leapfrog] Tag service database initialized at', projectPath);
	}

	async close(): Promise<void> {
		await this.db.close();
		this.initialized = false;
		this.cachedTags = undefined;
	}

	override dispose(): void {
		this.db.close().catch(err => this.logService.error('[Leapfrog] Error closing tag DB', err));
		super.dispose();
	}

	// -----------------------------------------------------------------------
	// Tag CRUD
	// -----------------------------------------------------------------------

	async getTags(): Promise<ILeapfrogTagWithCount[]> {
		if (this.cachedTags) {
			return this.cachedTags;
		}

		const rows = await this.db.getAllTagsWithCounts();
		this.cachedTags = this.buildTree(rows);
		return this.cachedTags;
	}

	async createTag(
		name: string,
		color: string,
		description?: string,
		parentId?: string,
	): Promise<ILeapfrogTagWithCount> {
		const id = generateUuid();

		// Determine sort_order: place at end of siblings
		const tags = await this.db.getAllTags();
		const siblings = tags.filter(t => (t.parent_id ?? undefined) === parentId);
		const sortOrder = siblings.length > 0
			? Math.max(...siblings.map(t => t.sort_order)) + 1
			: 0;

		await this.db.insertTag({ id, name, color, description, parent_id: parentId, sort_order: sortOrder });

		this.invalidateCache();
		this._onDidChangeTags.fire();

		return {
			id,
			name,
			description,
			color,
			parentId,
			sortOrder,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			applicationCount: 0,
			children: [],
		};
	}

	async updateTag(
		id: string,
		data: { name?: string; description?: string | null; color?: string; parentId?: string | null; sortOrder?: number },
	): Promise<void> {
		await this.db.updateTag(id, {
			name: data.name,
			description: data.description,
			color: data.color,
			parent_id: data.parentId,
			sort_order: data.sortOrder,
		});

		this.invalidateCache();
		this._onDidChangeTags.fire();
	}

	async deleteTag(id: string): Promise<void> {
		await this.db.deleteTag(id);

		this.invalidateCache();
		this._onDidChangeTags.fire();
		this._onDidChangeTagApplications.fire();
	}

	// -----------------------------------------------------------------------
	// Tag Applications
	// -----------------------------------------------------------------------

	async applyTag(
		tagId: string,
		filePath: string,
		anchor: ITextAnchor,
		note?: string,
	): Promise<ILeapfrogTagApplication> {
		const id = generateUuid();

		await this.db.insertTagApplication({
			id,
			tag_id: tagId,
			file_path: filePath,
			start_offset: anchor.startOffset,
			end_offset: anchor.endOffset,
			selected_text: anchor.selectedText,
			prefix: anchor.prefix,
			suffix: anchor.suffix,
			note,
			created_by: 'user',
		});

		this.invalidateCache();
		this._onDidChangeTagApplications.fire();
		this._onDidChangeTags.fire(); // count changed

		return {
			id,
			tagId,
			fileId: filePath,
			startOffset: anchor.startOffset,
			endOffset: anchor.endOffset,
			selectedText: anchor.selectedText,
			createdBy: 'user',
			createdAt: Date.now(),
		};
	}

	async removeTagApplication(id: string): Promise<void> {
		await this.db.removeTagApplication(id);

		this.invalidateCache();
		this._onDidChangeTagApplications.fire();
		this._onDidChangeTags.fire(); // count changed
	}

	async getApplicationsForTag(tagId: string): Promise<ILeapfrogTagFileGroup[]> {
		const rows = await this.db.getApplicationsForTag(tagId);

		// Group by file
		const groupMap = new Map<string, ILeapfrogTagFileGroup>();
		for (const row of rows) {
			let group = groupMap.get(row.file_path);
			if (!group) {
				group = {
					filePath: row.file_path,
					fileName: basename(row.file_path),
					applications: [],
				};
				groupMap.set(row.file_path, group);
			}
			group.applications.push({
				id: row.id,
				tagId: row.tag_id,
				fileId: row.file_path,
				startOffset: row.start_offset,
				endOffset: row.end_offset,
				selectedText: row.selected_text,
				note: row.note ?? undefined,
				createdBy: row.created_by as 'user' | 'ai',
				createdAt: new Date(row.created_at).getTime(),
			});
		}

		return Array.from(groupMap.values());
	}

	async getApplicationsForFile(filePath: string): Promise<ILeapfrogTagApplication[]> {
		const rows = await this.db.getApplicationsForFile(filePath);
		return rows.map(row => ({
			id: row.id,
			tagId: row.tag_id,
			fileId: row.file_path,
			startOffset: row.start_offset,
			endOffset: row.end_offset,
			selectedText: row.selected_text,
			note: row.note ?? undefined,
			createdBy: row.created_by as 'user' | 'ai',
			createdAt: new Date(row.created_at).getTime(),
		}));
	}

	// -----------------------------------------------------------------------
	// Private helpers
	// -----------------------------------------------------------------------

	private invalidateCache(): void {
		this.cachedTags = undefined;
	}

	/**
	 * Build a nested tree from flat rows.
	 */
	private buildTree(rows: ITagWithCountRow[]): ILeapfrogTagWithCount[] {
		const nodeMap = new Map<string, ILeapfrogTagWithCount>();

		// Create nodes
		for (const row of rows) {
			nodeMap.set(row.id, {
				id: row.id,
				name: row.name,
				description: row.description ?? undefined,
				color: row.color,
				parentId: row.parent_id ?? undefined,
				sortOrder: row.sort_order,
				createdAt: row.created_at,
				updatedAt: row.updated_at,
				applicationCount: row.application_count,
				children: [],
			});
		}

		// Wire up parent-child
		const roots: ILeapfrogTagWithCount[] = [];
		for (const node of nodeMap.values()) {
			if (node.parentId) {
				const parent = nodeMap.get(node.parentId);
				if (parent) {
					parent.children.push(node);
				} else {
					// Orphaned - treat as root
					roots.push(node);
				}
			} else {
				roots.push(node);
			}
		}

		// Sort children
		const sortChildren = (nodes: ILeapfrogTagWithCount[]) => {
			nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
			for (const n of nodes) {
				sortChildren(n.children);
			}
		};
		sortChildren(roots);

		return roots;
	}
}
