/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { localize } from '../../../../nls.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';

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
 * Leapfrog Preferences viewlet id (standalone activity bar entry).
 */
export const LEAPFROG_PREFERENCES_VIEWLET_ID = 'workbench.view.preferences';

/**
 * Leapfrog Preferences view id.
 */
export const LEAPFROG_PREFERENCES_VIEW_ID = 'workbench.leapfrog.preferencesView';

/**
 * Context Keys for Leapfrog views
 */
export const LeapfrogViewletVisibleContext = new RawContextKey<boolean>('leapfrogViewletVisible', false, { type: 'boolean', description: localize('leapfrogViewletVisible', "True when the LEAPFROG viewlet is visible.") });
export const LeapfrogProjectsViewVisibleContext = new RawContextKey<boolean>('leapfrogProjectsViewVisible', false, { type: 'boolean', description: localize('leapfrogProjectsViewVisible', "True when the LEAPFROG Projects view is visible.") });
export const LeapfrogTagsViewVisibleContext = new RawContextKey<boolean>('leapfrogTagsViewVisible', false, { type: 'boolean', description: localize('leapfrogTagsViewVisible', "True when the LEAPFROG Tags view is visible.") });
export const LeapfrogTagsViewletVisibleContext = new RawContextKey<boolean>('leapfrogTagsViewletVisible', false, { type: 'boolean', description: localize('leapfrogTagsViewletVisible', "True when the LEAPFROG Tags viewlet is visible.") });
export const LeapfrogChatViewVisibleContext = new RawContextKey<boolean>('leapfrogChatViewVisible', false, { type: 'boolean', description: localize('leapfrogChatViewVisible', "True when the LEAPFROG Chat view is visible.") });
export const LeapfrogPreferencesViewletVisibleContext = new RawContextKey<boolean>('leapfrogPreferencesViewletVisible', false, { type: 'boolean', description: localize('leapfrogPreferencesViewletVisible', "True when the LEAPFROG Preferences viewlet is visible.") });

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
	sentiment?: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
	sentimentConfidence?: number;
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
	stream(messages: ILeapfrogChatMessage[], config?: ILeapfrogChatConfig, cancelToken?: CancellationToken): AsyncIterable<ILeapfrogChatStreamChunk>;

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

	// Anchor sync
	updateApplicationAnchors(updates: { id: string; startOffset: number; endOffset: number; selectedText: string }[]): Promise<void>;
}

export const ILeapfrogTagService = createDecorator<ILeapfrogTagService>('leapfrogTagService');

// ---------------------------------------------------------------------------
// Transcription Service
// ---------------------------------------------------------------------------

/**
 * Options for a transcription request.
 */
export interface ILeapfrogTranscriptionOptions {
	language?: string;
	diarization?: boolean;
}

/**
 * Service that manages audio/video transcription via AssemblyAI.
 */
export interface ILeapfrogTranscriptionService {
	readonly _serviceBrand: undefined;

	/**
	 * Submit a file for transcription.
	 */
	transcribe(filePath: string, options?: ILeapfrogTranscriptionOptions): Promise<ILeapfrogTranscript>;

	/**
	 * Get the current state of a transcript (status, segments, speakers).
	 */
	getTranscript(transcriptId: string): Promise<ILeapfrogTranscript>;

	/**
	 * Check the processing status of a transcript.
	 */
	getStatus(transcriptId: string): Promise<ILeapfrogTranscript>;

	/**
	 * Rename a speaker in a completed transcript (local-only).
	 */
	renameSpeaker(transcriptId: string, speakerId: string, newName: string): Promise<void>;

	/**
	 * Fired when a transcript completes processing.
	 */
	readonly onDidTranscriptComplete: Event<ILeapfrogTranscript>;

	/**
	 * Fired when a transcript encounters an error.
	 */
	readonly onDidTranscriptError: Event<{ transcriptId: string; error: string }>;
}

export const ILeapfrogTranscriptionService = createDecorator<ILeapfrogTranscriptionService>('leapfrogTranscriptionService');

// ---------------------------------------------------------------------------
// Chat History Service
// ---------------------------------------------------------------------------

/**
 * Chat attachment interface.
 */
export interface ILeapfrogChatAttachment {
	type: 'file' | 'selection' | 'folder';
	uri: string;  // Serialized URI
	name: string;
	range?: {
		startLine: number;
		startColumn: number;
		endLine: number;
		endColumn: number;
	};
	content?: string;  // For small selections/snippets
}

/**
 * Individual chat message data.
 */
export interface ILeapfrogChatMessageData {
	id: string;
	role: 'user' | 'assistant' | 'system';
	content: string;
	timestamp: number;
	model?: string;
	attachments?: ILeapfrogChatAttachment[];
}

/**
 * Chat session containing multiple messages.
 */
export interface ILeapfrogChatSession {
	id: string;
	title: string;  // Auto-generated from first user message or user-set
	createdAt: string;
	updatedAt: string;
	messages: ILeapfrogChatMessageData[];
	model?: string;
}

/**
 * Chat history service for persisting sessions and messages.
 */
export interface ILeapfrogChatHistoryService {
	readonly _serviceBrand: undefined;

	// Lifecycle
	initialize(projectPath: string): Promise<void>;
	close(): Promise<void>;

	// Events
	readonly onDidChangeSessions: Event<void>;

	// Session operations
	getSessions(): Promise<ILeapfrogChatSession[]>;
	getSession(id: string): Promise<ILeapfrogChatSession | undefined>;
	createSession(title?: string): Promise<ILeapfrogChatSession>;
	updateSession(id: string, data: Partial<ILeapfrogChatSession>): Promise<void>;
	deleteSession(id: string): Promise<void>;

	// Message operations
	addMessage(sessionId: string, message: ILeapfrogChatMessageData): Promise<void>;
	updateMessage(sessionId: string, messageId: string, content: string): Promise<void>;

	// Utility
	setSessionTitle(sessionId: string, title: string): Promise<void>;
	generateSessionTitle(sessionId: string): Promise<string>;
}

export const ILeapfrogChatHistoryService = createDecorator<ILeapfrogChatHistoryService>('leapfrogChatHistoryService');

// ---------------------------------------------------------------------------
// Index Service - semantic search over project files
// ---------------------------------------------------------------------------

/**
 * Status of the indexing process.
 */
export type LeapfrogIndexStatus = 'idle' | 'scanning' | 'chunking' | 'embedding' | 'ready' | 'error';

/**
 * Progress information for indexing operations.
 */
export interface ILeapfrogIndexProgress {
	status: LeapfrogIndexStatus;
	totalFiles: number;
	processedFiles: number;
	totalChunks: number;
	embeddedChunks: number;
	currentFile?: string;
	error?: string;
}

/**
 * A single chunk of indexed content.
 */
export interface ILeapfrogIndexChunk {
	id: string;
	filePath: string;
	chunkType: 'markdown_heading' | 'transcript_speaker_turn' | 'plaintext_paragraph';
	content: string;
	startOffset: number;
	endOffset: number;
	/** For markdown: heading path e.g. "Methods > Sampling" */
	headingPath?: string;
	/** For transcripts: speaker name */
	speaker?: string;
	/** For transcripts: start time in ms */
	startTime?: number;
	/** For transcripts: end time in ms */
	endTime?: number;
}

/**
 * A search result with relevance score.
 */
export interface ILeapfrogSearchResult {
	chunk: ILeapfrogIndexChunk;
	score: number;
}

/**
 * Options for semantic search queries.
 */
export interface ILeapfrogSearchOptions {
	limit?: number;
	fileTypes?: string[];
	minScore?: number;
}

/**
 * Service that manages document indexing and semantic search.
 *
 * Chunks workspace files, generates embeddings via OpenAI, and provides
 * cosine-similarity search. All data stored locally in `.leapfrog/index.json`.
 */
export interface ILeapfrogIndexService {
	readonly _serviceBrand: undefined;

	// Lifecycle
	initialize(projectPath: string): Promise<void>;
	close(): Promise<void>;

	// Events
	readonly onDidChangeIndexProgress: Event<ILeapfrogIndexProgress>;
	readonly onDidIndexComplete: Event<void>;

	// Indexing
	indexWorkspace(): Promise<void>;
	indexFile(filePath: string): Promise<void>;
	removeFile(filePath: string): Promise<void>;
	getProgress(): ILeapfrogIndexProgress;
	isReady(): boolean;

	// Search
	search(query: string, options?: ILeapfrogSearchOptions): Promise<ILeapfrogSearchResult[]>;
}

export const ILeapfrogIndexService = createDecorator<ILeapfrogIndexService>('leapfrogIndexService');

// ---------------------------------------------------------------------------
// Index Preferences Service - manages file indexing preferences and scanning
// ---------------------------------------------------------------------------

/**
 * Information about a file that could be indexed.
 */
export interface IIndexableFile {
	path: string;
	fileName: string;
	size: number;
	mtime: number;
	isIndexed: boolean;
	shouldIndex: boolean;
	reason?: string;  // Why it is/isn't indexed
}

/**
 * Index preferences and statistics.
 */
export interface ILeapfrogIndexPreferences {
	includePatterns: string[];
	excludePatterns: string[];
	autoIndex: boolean;
	totalFiles: number;
	indexedFiles: number;
	shouldIndexFiles: number;
}

/**
 * Service that manages indexing preferences and scans for indexable files.
 */
export interface ILeapfrogIndexPreferencesService {
	readonly _serviceBrand: undefined;

	// Lifecycle
	initialize(projectPath: string): Promise<void>;
	close(): Promise<void>;

	// Events
	readonly onDidChangePreferences: Event<void>;

	// Preferences
	getPreferences(): Promise<ILeapfrogIndexPreferences>;
	updatePreferences(data: { includePatterns?: string[]; excludePatterns?: string[]; autoIndex?: boolean }): Promise<void>;

	// File scanning
	scanWorkspace(): Promise<IIndexableFile[]>;
	getIndexableFiles(): Promise<IIndexableFile[]>;
	getIndexedFiles(): Promise<IIndexableFile[]>;
	getShouldIndexFiles(): Promise<IIndexableFile[]>;

	// Statistics
	getStats(): Promise<{ total: number; indexed: number; shouldIndex: number }>;
}

export const ILeapfrogIndexPreferencesService = createDecorator<ILeapfrogIndexPreferencesService>('leapfrogIndexPreferencesService');
