/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SQLite database wrapper for Leapfrog project data.
 *
 * Uses @vscode/sqlite3 (already bundled with VS Code) with a Promise-based
 * API. Each project gets a `.leapfrog/leapfrog.db` database with WAL mode
 * and foreign keys enabled.
 */

import { join } from '../../../../base/common/path.js';

// Local type for @vscode/sqlite3 Database (loaded dynamically to satisfy import rules)
interface ISQLiteDatabase {
	exec(sql: string, callback?: (err: Error | null) => void): void;
	run(sql: string, params: unknown[], callback: (this: { lastID: number; changes: number }, err: Error | null) => void): void;
	all(sql: string, params: unknown[], callback: (err: Error | null, rows: unknown[]) => void): void;
	get(sql: string, params: unknown[], callback: (err: Error | null, row: unknown) => void): void;
	close(callback?: (err: Error | null) => void): void;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 1;

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

export interface ITagWithCountRow extends ITagRow {
	application_count: number;
}

// ---------------------------------------------------------------------------
// Database wrapper
// ---------------------------------------------------------------------------

export class LeapfrogSQLiteDatabase {

	private db: ISQLiteDatabase | undefined;
	private dbPath: string | undefined;

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	async open(projectPath: string): Promise<void> {
		const leapfrogDir = join(projectPath, '.leapfrog');
		const fs = await import('fs/promises');
		await fs.mkdir(leapfrogDir, { recursive: true });

		this.dbPath = join(leapfrogDir, 'leapfrog.db');

		const sqlite3Module = await import('@vscode/sqlite3');
		const Ctor = sqlite3Module.default.Database;

		return new Promise<void>((resolve, reject) => {
			this.db = new Ctor(this.dbPath!, (err: Error | null) => {
				if (err) {
					reject(err);
					return;
				}
				this.runMigrations().then(resolve, reject);
			});
		});
	}

	close(): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			if (!this.db) {
				resolve();
				return;
			}
			this.db.close((err: Error | null) => {
				this.db = undefined;
				if (err) {
					reject(err);
				} else {
					resolve();
				}
			});
		});
	}

	private get conn(): ISQLiteDatabase {
		if (!this.db) {
			throw new Error('Database not open');
		}
		return this.db;
	}

	// -----------------------------------------------------------------------
	// Migrations
	// -----------------------------------------------------------------------

	private async runMigrations(): Promise<void> {
		// Enable WAL and foreign keys
		await this.exec('PRAGMA journal_mode = WAL');
		await this.exec('PRAGMA foreign_keys = ON');

		// Check current version
		await this.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
		const row = await this.getOne<{ version: number }>('SELECT version FROM schema_version LIMIT 1');
		const currentVersion = row?.version ?? 0;

		if (currentVersion < SCHEMA_VERSION) {
			await this.exec(`
				CREATE TABLE IF NOT EXISTS tags (
					id          TEXT PRIMARY KEY,
					name        TEXT NOT NULL,
					description TEXT,
					color       TEXT NOT NULL DEFAULT '#22c55e',
					parent_id   TEXT,
					sort_order  INTEGER NOT NULL DEFAULT 0,
					created_at  TEXT NOT NULL DEFAULT (datetime('now')),
					updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
					FOREIGN KEY (parent_id) REFERENCES tags(id) ON DELETE SET NULL
				)
			`);

			await this.exec(`
				CREATE TABLE IF NOT EXISTS tag_applications (
					id              TEXT PRIMARY KEY,
					tag_id          TEXT NOT NULL,
					file_path       TEXT NOT NULL,
					start_offset    INTEGER NOT NULL,
					end_offset      INTEGER NOT NULL,
					selected_text   TEXT NOT NULL,
					prefix          TEXT,
					suffix          TEXT,
					note            TEXT,
					created_by      TEXT NOT NULL DEFAULT 'user',
					created_at      TEXT NOT NULL DEFAULT (datetime('now')),
					FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
				)
			`);

			await this.exec('CREATE INDEX IF NOT EXISTS idx_tags_parent ON tags(parent_id)');
			await this.exec('CREATE INDEX IF NOT EXISTS idx_app_tag ON tag_applications(tag_id)');
			await this.exec('CREATE INDEX IF NOT EXISTS idx_app_file ON tag_applications(file_path)');

			// Update version
			if (currentVersion === 0) {
				await this.run('INSERT INTO schema_version (version) VALUES (?)', [SCHEMA_VERSION]);
			} else {
				await this.run('UPDATE schema_version SET version = ?', [SCHEMA_VERSION]);
			}
		}
	}

	// -----------------------------------------------------------------------
	// Low-level helpers
	// -----------------------------------------------------------------------

	private exec(sql: string): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this.conn.exec(sql, (err: Error | null) => {
				if (err) { reject(err); } else { resolve(); }
			});
		});
	}

	private run(sql: string, params: unknown[] = []): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this.conn.run(sql, params, function (err: Error | null) {
				if (err) { reject(err); } else { resolve(); }
			});
		});
	}

	private all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
		return new Promise<T[]>((resolve, reject) => {
			this.conn.all(sql, params, (err: Error | null, rows: unknown[]) => {
				if (err) { reject(err); } else { resolve((rows ?? []) as T[]); }
			});
		});
	}

	private getOne<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
		return new Promise<T | undefined>((resolve, reject) => {
			this.conn.get(sql, params, (err: Error | null, row: unknown) => {
				if (err) { reject(err); } else { resolve(row as T | undefined); }
			});
		});
	}

	// -----------------------------------------------------------------------
	// Tag CRUD
	// -----------------------------------------------------------------------

	async getAllTags(): Promise<ITagRow[]> {
		return this.all<ITagRow>(
			'SELECT * FROM tags ORDER BY sort_order ASC, name ASC'
		);
	}

	async getAllTagsWithCounts(): Promise<ITagWithCountRow[]> {
		return this.all<ITagWithCountRow>(`
			SELECT t.*, COALESCE(c.cnt, 0) AS application_count
			FROM tags t
			LEFT JOIN (
				SELECT tag_id, COUNT(*) AS cnt FROM tag_applications GROUP BY tag_id
			) c ON c.tag_id = t.id
			ORDER BY t.sort_order ASC, t.name ASC
		`);
	}

	async getTag(id: string): Promise<ITagRow | undefined> {
		return this.getOne<ITagRow>('SELECT * FROM tags WHERE id = ?', [id]);
	}

	async insertTag(tag: {
		id: string;
		name: string;
		description?: string;
		color: string;
		parent_id?: string;
		sort_order?: number;
	}): Promise<void> {
		await this.run(
			'INSERT INTO tags (id, name, description, color, parent_id, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
			[
				tag.id,
				tag.name,
				tag.description ?? null,
				tag.color,
				tag.parent_id ?? null,
				tag.sort_order ?? 0,
			]
		);
	}

	async updateTag(id: string, data: {
		name?: string;
		description?: string | null;
		color?: string;
		parent_id?: string | null;
		sort_order?: number;
	}): Promise<void> {
		const sets: string[] = [];
		const params: unknown[] = [];

		if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name); }
		if (data.description !== undefined) { sets.push('description = ?'); params.push(data.description); }
		if (data.color !== undefined) { sets.push('color = ?'); params.push(data.color); }
		if (data.parent_id !== undefined) { sets.push('parent_id = ?'); params.push(data.parent_id); }
		if (data.sort_order !== undefined) { sets.push('sort_order = ?'); params.push(data.sort_order); }

		if (sets.length === 0) {
			return;
		}

		sets.push('updated_at = datetime(\'now\')');
		params.push(id);

		await this.run(
			`UPDATE tags SET ${sets.join(', ')} WHERE id = ?`,
			params
		);
	}

	async deleteTag(id: string): Promise<void> {
		await this.run('DELETE FROM tags WHERE id = ?', [id]);
	}

	// -----------------------------------------------------------------------
	// Tag Application CRUD
	// -----------------------------------------------------------------------

	async getApplicationsForTag(tagId: string): Promise<ITagApplicationRow[]> {
		return this.all<ITagApplicationRow>(
			'SELECT * FROM tag_applications WHERE tag_id = ? ORDER BY file_path ASC, start_offset ASC',
			[tagId]
		);
	}

	async getApplicationsForFile(filePath: string): Promise<ITagApplicationRow[]> {
		return this.all<ITagApplicationRow>(
			'SELECT * FROM tag_applications WHERE file_path = ? ORDER BY start_offset ASC',
			[filePath]
		);
	}

	async getApplicationCountForTag(tagId: string): Promise<number> {
		const row = await this.getOne<{ cnt: number }>(
			'SELECT COUNT(*) AS cnt FROM tag_applications WHERE tag_id = ?',
			[tagId]
		);
		return row?.cnt ?? 0;
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
		await this.run(
			'INSERT INTO tag_applications (id, tag_id, file_path, start_offset, end_offset, selected_text, prefix, suffix, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
			[
				app.id,
				app.tag_id,
				app.file_path,
				app.start_offset,
				app.end_offset,
				app.selected_text,
				app.prefix ?? null,
				app.suffix ?? null,
				app.note ?? null,
				app.created_by ?? 'user',
			]
		);
	}

	async removeTagApplication(id: string): Promise<void> {
		await this.run('DELETE FROM tag_applications WHERE id = ?', [id]);
	}

	async removeApplicationsForFile(filePath: string): Promise<void> {
		await this.run('DELETE FROM tag_applications WHERE file_path = ?', [filePath]);
	}
}
