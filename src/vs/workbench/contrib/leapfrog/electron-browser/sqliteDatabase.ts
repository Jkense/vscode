/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared type definitions for Leapfrog tag/application data.
 *
 * The actual storage implementation lives in `leapfrogFileStore.ts`.
 */

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
