/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { localize } from '../../../../nls.js';

/**
 * Leapfrog viewlet id.
 */
export const LEAPFROG_VIEWLET_ID = 'workbench.view.leapfrog';

/**
 * Leapfrog Projects view id.
 */
export const LEAPFROG_PROJECTS_VIEW_ID = 'workbench.leapfrog.projectsView';

/**
 * Leapfrog Tags viewlet id (standalone activity bar entry).
 */
export const LEAPFROG_TAGS_VIEWLET_ID = 'workbench.view.tags';

/**
 * Leapfrog Tags view id.
 */
export const LEAPFROG_TAGS_VIEW_ID = 'workbench.leapfrog.tagsView';

/**
 * Chat viewlet id (auxiliary bar) - replaces Copilot chat.
 */
export const LEAPFROG_CHAT_VIEWLET_ID = 'workbench.panel.chat';

/**
 * Chat view id - replaces Copilot chat view.
 */
export const LEAPFROG_CHAT_VIEW_ID = 'workbench.panel.chat.view';

/**
 * Context Keys for Leapfrog views
 */
export const LeapfrogViewletVisibleContext = new RawContextKey<boolean>('leapfrogViewletVisible', false, { type: 'boolean', description: localize('leapfrogViewletVisible', "True when the LEAPFROG viewlet is visible.") });
export const LeapfrogProjectsViewVisibleContext = new RawContextKey<boolean>('leapfrogProjectsViewVisible', false, { type: 'boolean', description: localize('leapfrogProjectsViewVisible', "True when the LEAPFROG Projects view is visible.") });
export const LeapfrogTagsViewVisibleContext = new RawContextKey<boolean>('leapfrogTagsViewVisible', false, { type: 'boolean', description: localize('leapfrogTagsViewVisible', "True when the LEAPFROG Tags view is visible.") });
export const LeapfrogTagsViewletVisibleContext = new RawContextKey<boolean>('leapfrogTagsViewletVisible', false, { type: 'boolean', description: localize('leapfrogTagsViewletVisible', "True when the LEAPFROG Tags viewlet is visible.") });
export const LeapfrogChatViewVisibleContext = new RawContextKey<boolean>('leapfrogChatViewVisible', false, { type: 'boolean', description: localize('leapfrogChatViewVisible', "True when the LEAPFROG Chat view is visible.") });

/**
 * Leapfrog Project interface
 */
export interface ILeapfrogProject {
	id: string;
	name: string;
	path: string;
	description?: string;
	createdAt: number;
	updatedAt: number;
}

/**
 * Leapfrog Tag interface
 */
export interface ILeapfrogTag {
	id: string;
	name: string;
	description?: string;
	color: string;
	projectId: string;
	parentId?: string;  // For hierarchical tags
	createdAt: number;
	updatedAt: number;
}

/**
 * Leapfrog Tag Application interface - represents a tag applied to text
 */
export interface ILeapfrogTagApplication {
	id: string;
	tagId: string;
	fileId: string;
	startOffset: number;
	endOffset: number;
	selectedText: string;
	note?: string;
	createdBy: 'user' | 'ai';
	createdAt: number;
}

/**
 * Tag application enriched with tag metadata (name, color, description)
 */
export interface ILeapfrogTagApplicationWithTag extends ILeapfrogTagApplication {
	tagName: string;
	tagColor: string;
	tagDescription?: string;
}

/**
 * Leapfrog Transcript Segment interface
 */
export interface ILeapfrogTranscriptSegment {
	id: string;
	speakerId?: string;
	text: string;
	startTime: number;  // Seconds
	endTime: number;
	confidence?: number;
	words?: ILeapfrogTranscriptWord[];
}

/**
 * Leapfrog Transcript Word interface
 */
export interface ILeapfrogTranscriptWord {
	text: string;
	startTime: number;
	endTime: number;
	confidence?: number;
}

/**
 * Leapfrog Speaker interface
 */
export interface ILeapfrogSpeaker {
	id: string;
	name: string;
	color?: string;
}

/**
 * Leapfrog Transcript interface
 */
export interface ILeapfrogTranscript {
	id: string;
	fileId: string;
	projectId: string;
	sourcePath: string;
	status: 'pending' | 'processing' | 'completed' | 'error';
	segments: ILeapfrogTranscriptSegment[];
	speakers: ILeapfrogSpeaker[];
	duration?: number;
	createdAt: number;
	updatedAt: number;
}

/**
 * Leapfrog Service interface
 */
export interface ILeapfrogService {
	readonly _serviceBrand: undefined;

	// Project operations
	getProjects(): Promise<ILeapfrogProject[]>;
	getProject(id: string): Promise<ILeapfrogProject | undefined>;
	createProject(name: string, path: string, description?: string): Promise<ILeapfrogProject>;
	updateProject(id: string, data: Partial<ILeapfrogProject>): Promise<ILeapfrogProject>;
	deleteProject(id: string): Promise<void>;

	// Tag operations
	getTags(projectId: string): Promise<ILeapfrogTag[]>;
	getTag(id: string): Promise<ILeapfrogTag | undefined>;
	createTag(projectId: string, name: string, color: string, parentId?: string): Promise<ILeapfrogTag>;
	updateTag(id: string, data: Partial<ILeapfrogTag>): Promise<ILeapfrogTag>;
	deleteTag(id: string): Promise<void>;

	// Tag application operations
	getTagApplications(fileId: string): Promise<ILeapfrogTagApplication[]>;
	applyTag(tagId: string, fileId: string, startOffset: number, endOffset: number, selectedText: string, note?: string): Promise<ILeapfrogTagApplication>;
	removeTagApplication(id: string): Promise<void>;
}

export const ILeapfrogService = createDecorator<ILeapfrogService>('leapfrogService');

/**
 * Leapfrog Database Service interface
 */
export interface ILeapfrogDatabaseService {
	readonly _serviceBrand: undefined;

	initialize(dbPath: string): Promise<void>;
	close(): Promise<void>;

	// Generic query methods
	query<T>(sql: string, params?: unknown[]): Promise<T[]>;
	run(sql: string, params?: unknown[]): Promise<void>;
	get<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
}

export const ILeapfrogDatabaseService = createDecorator<ILeapfrogDatabaseService>('leapfrogDatabaseService');

/**
 * Leapfrog AI Service interface
 */
export interface ILeapfrogAIService {
	readonly _serviceBrand: undefined;

	// Chat operations
	chat(messages: ILeapfrogChatMessage[], config?: ILeapfrogChatConfig): Promise<ILeapfrogChatResponse>;
	stream(messages: ILeapfrogChatMessage[], config?: ILeapfrogChatConfig): AsyncIterable<ILeapfrogChatStreamChunk>;

	// Model info
	getAvailableModels(): ILeapfrogAIModel[];
	getDefaultModel(): ILeapfrogAIModel;
}

export const ILeapfrogAIService = createDecorator<ILeapfrogAIService>('leapfrogAIService');

/**
 * Leapfrog Chat Message interface
 */
export interface ILeapfrogChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

/**
 * Leapfrog Chat Config interface
 */
export interface ILeapfrogChatConfig {
	model?: string;
	temperature?: number;
	maxTokens?: number;
}

/**
 * Leapfrog Chat Response interface
 */
export interface ILeapfrogChatResponse {
	content: string;
	model: string;
	usage?: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
}

/**
 * Leapfrog Chat Stream Chunk interface
 */
export interface ILeapfrogChatStreamChunk {
	content: string;
	done: boolean;
}

/**
 * Leapfrog AI Model interface
 */
export interface ILeapfrogAIModel {
	id: string;
	name: string;
	provider: 'openai' | 'anthropic';
	contextLength: number;
}

/**
 * Available AI models
 */
export const LEAPFROG_AVAILABLE_MODELS: ILeapfrogAIModel[] = [
	{ id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', contextLength: 128000 },
	{ id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', contextLength: 128000 },
	{ id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet', provider: 'anthropic', contextLength: 200000 },
	{ id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku', provider: 'anthropic', contextLength: 200000 },
];

/**
 * Leapfrog API Key Service interface
 */
export interface ILeapfrogApiKeyService {
	readonly _serviceBrand: undefined;

	setApiKey(provider: 'openai' | 'anthropic', key: string): Promise<void>;
	getApiKey(provider: 'openai' | 'anthropic'): Promise<string | undefined>;
	deleteApiKey(provider: 'openai' | 'anthropic'): Promise<void>;
	hasApiKey(provider: 'openai' | 'anthropic'): Promise<boolean>;
}

export const ILeapfrogApiKeyService = createDecorator<ILeapfrogApiKeyService>('leapfrogApiKeyService');

// ---------------------------------------------------------------------------
// Tag Service -richer tag interfaces for the Tags sidebar
// ---------------------------------------------------------------------------

/**
 * A tag with its resolved usage count and child hierarchy.
 */
export interface ILeapfrogTagWithCount {
	id: string;
	name: string;
	description?: string;
	color: string;
	parentId?: string;
	sortOrder: number;
	createdAt: string;
	updatedAt: string;
	applicationCount: number;
	children: ILeapfrogTagWithCount[];
}

/**
 * A group of tag applications for a single file.
 */
export interface ILeapfrogTagFileGroup {
	filePath: string;
	fileName: string;
	applications: ILeapfrogTagApplication[];
}

/**
 * W3C-style text anchor with prefix/suffix for robust relocation.
 */
export interface ITextAnchor {
	startOffset: number;
	endOffset: number;
	selectedText: string;
	prefix?: string;
	suffix?: string;
}

/**
 * Service that manages tags and tag applications backed by SQLite.
 */
export interface ILeapfrogTagService {
	readonly _serviceBrand: undefined;

	// Lifecycle
	initialize(projectPath: string): Promise<void>;
	close(): Promise<void>;

	// Events
	readonly onDidChangeTags: Event<void>;
	readonly onDidChangeTagApplications: Event<void>;

	// Tag CRUD
	getTags(): Promise<ILeapfrogTagWithCount[]>;
	createTag(name: string, color: string, description?: string, parentId?: string): Promise<ILeapfrogTagWithCount>;
	updateTag(id: string, data: { name?: string; description?: string | null; color?: string; parentId?: string | null; sortOrder?: number }): Promise<void>;
	deleteTag(id: string): Promise<void>;

	// Tag Applications
	applyTag(tagId: string, filePath: string, anchor: ITextAnchor, note?: string): Promise<ILeapfrogTagApplication>;
	removeTagApplication(id: string): Promise<void>;
	getApplicationsForTag(tagId: string): Promise<ILeapfrogTagFileGroup[]>;
	getApplicationsForFile(filePath: string): Promise<ILeapfrogTagApplicationWithTag[]>;
}

export const ILeapfrogTagService = createDecorator<ILeapfrogTagService>('leapfrogTagService');
