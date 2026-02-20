/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { IConfigurationNode, ConfigurationScope } from '../../../../platform/configuration/common/configurationRegistry.js';

export const enum LeapfrogConfigurationKeys {
	DefaultModel = 'leapfrog.ai.defaultModel',
	Temperature = 'leapfrog.ai.temperature',
	MaxTokens = 'leapfrog.ai.maxTokens',
	ChatDefaultModel = 'leapfrog.chat.defaultModel',
	AutoSuggestTags = 'leapfrog.tags.autoSuggest',
	TagColors = 'leapfrog.tags.defaultColors',
	TranscriptAutoSave = 'leapfrog.transcript.autoSave',
	TranscriptShowTimestamps = 'leapfrog.transcript.showTimestamps',
	TranscriptShowConfidence = 'leapfrog.transcript.showConfidence',
	TranscriptLanguage = 'leapfrog.transcript.language',
	TranscriptLanguageDetection = 'leapfrog.transcript.languageDetection',
	TranscriptPunctuate = 'leapfrog.transcript.punctuate',
	TranscriptFormatText = 'leapfrog.transcript.formatText',
	TranscriptSentimentAnalysis = 'leapfrog.transcript.sentimentAnalysis',
	TranscriptEntityDetection = 'leapfrog.transcript.entityDetection',
	TranscriptAutoChapters = 'leapfrog.transcript.autoChapters',
	TranscriptAutoHighlights = 'leapfrog.transcript.autoHighlights',
	TranscriptDisfluencies = 'leapfrog.transcript.disfluencies',
	TranscriptFilterProfanity = 'leapfrog.transcript.filterProfanity',
	IndexIncludePatterns = 'leapfrog.index.includePatterns',
	IndexExcludePatterns = 'leapfrog.index.excludePatterns',
	IndexAutoIndex = 'leapfrog.index.autoIndex',
}

export interface ILeapfrogConfiguration {
	ai: {
		defaultModel: string;
		temperature: number;
		maxTokens: number;
	};
	chat: {
		defaultModel: string;
	};
	tags: {
		autoSuggest: boolean;
		defaultColors: string[];
	};
	transcript: {
		autoSave: boolean;
		showTimestamps: boolean;
		showConfidence: boolean;
		language: string | 'auto';
		languageDetection: boolean;
		punctuate: boolean;
		formatText: boolean;
		sentimentAnalysis: boolean;
		entityDetection: boolean;
		autoChapters: boolean;
		autoHighlights: boolean;
		disfluencies: boolean;
		filterProfanity: boolean;
	};
	index: {
		includePatterns: string[];
		excludePatterns: string[];
		autoIndex: boolean;
	};
}

export const leapfrogConfigurationSchema: IConfigurationNode = {
	id: 'leapfrog',
	order: 100,
	title: nls.localize('leapfrogConfigurationTitle', "Leapfrog"),
	type: 'object',
	properties: {
		[LeapfrogConfigurationKeys.DefaultModel]: {
			type: 'string',
			default: 'gpt-4o',
			enum: ['gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'],
			enumDescriptions: [
				nls.localize('leapfrog.ai.model.gpt4o', "OpenAI GPT-4o - Most capable model"),
				nls.localize('leapfrog.ai.model.gpt4oMini', "OpenAI GPT-4o Mini - Fast and cost-effective"),
				nls.localize('leapfrog.ai.model.claude35Sonnet', "Anthropic Claude 3.5 Sonnet - Balanced performance"),
				nls.localize('leapfrog.ai.model.claude35Haiku', "Anthropic Claude 3.5 Haiku - Fast and efficient"),
			],
			description: nls.localize('leapfrog.ai.defaultModel', "Default AI model for chat and analysis"),
			scope: ConfigurationScope.APPLICATION,
		},
		[LeapfrogConfigurationKeys.Temperature]: {
			type: 'number',
			default: 0.7,
			minimum: 0,
			maximum: 2,
			description: nls.localize('leapfrog.ai.temperature', "Temperature for AI responses (0 = deterministic, 2 = creative)"),
			scope: ConfigurationScope.APPLICATION,
		},
		[LeapfrogConfigurationKeys.MaxTokens]: {
			type: 'number',
			default: 4096,
			minimum: 100,
			maximum: 128000,
			description: nls.localize('leapfrog.ai.maxTokens', "Maximum tokens for AI responses"),
			scope: ConfigurationScope.APPLICATION,
		},
		[LeapfrogConfigurationKeys.ChatDefaultModel]: {
			type: 'string',
			default: 'gpt-4o',
			enum: ['gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'],
			enumDescriptions: [
				nls.localize('leapfrog.chat.model.gpt4o', "OpenAI GPT-4o - Most capable model"),
				nls.localize('leapfrog.chat.model.gpt4oMini', "OpenAI GPT-4o Mini - Fast and cost-effective"),
				nls.localize('leapfrog.chat.model.claude35Sonnet', "Anthropic Claude 3.5 Sonnet - Balanced performance"),
				nls.localize('leapfrog.chat.model.claude35Haiku', "Anthropic Claude 3.5 Haiku - Fast and efficient"),
			],
			description: nls.localize('leapfrog.chat.defaultModel', "Default AI model for chat interactions"),
			scope: ConfigurationScope.APPLICATION,
		},
		[LeapfrogConfigurationKeys.AutoSuggestTags]: {
			type: 'boolean',
			default: true,
			description: nls.localize('leapfrog.tags.autoSuggest', "Automatically suggest tags based on selected text using AI"),
			scope: ConfigurationScope.APPLICATION,
		},
		[LeapfrogConfigurationKeys.TagColors]: {
			type: 'array',
			items: {
				type: 'string'
			},
			default: [
				'#FF6B6B',  // Red
				'#4ECDC4',  // Teal
				'#45B7D1',  // Blue
				'#96CEB4',  // Green
				'#FFEAA7',  // Yellow
				'#DDA0DD',  // Plum
				'#98D8C8',  // Mint
				'#F7DC6F',  // Gold
				'#BB8FCE',  // Purple
				'#85C1E9',  // Light Blue
			],
			description: nls.localize('leapfrog.tags.defaultColors', "Default color palette for new tags"),
			scope: ConfigurationScope.APPLICATION,
		},
		[LeapfrogConfigurationKeys.TranscriptAutoSave]: {
			type: 'boolean',
			default: true,
			description: nls.localize('leapfrog.transcript.autoSave', "Automatically save transcript changes"),
			scope: ConfigurationScope.RESOURCE,
		},
		[LeapfrogConfigurationKeys.TranscriptShowTimestamps]: {
			type: 'boolean',
			default: true,
			description: nls.localize('leapfrog.transcript.showTimestamps', "Show timestamps in transcript view"),
			scope: ConfigurationScope.RESOURCE,
		},
		[LeapfrogConfigurationKeys.TranscriptShowConfidence]: {
			type: 'boolean',
			default: false,
			description: nls.localize('leapfrog.transcript.showConfidence', "Show confidence scores for AI-transcribed segments"),
			scope: ConfigurationScope.RESOURCE,
		},
		[LeapfrogConfigurationKeys.TranscriptLanguage]: {
			type: 'string',
			default: 'auto',
			enum: ['auto', 'en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'zh', 'ja', 'ko'],
			enumDescriptions: [
				nls.localize('leapfrog.transcript.language.auto', "Auto-detect language"),
				nls.localize('leapfrog.transcript.language.en', "English"),
				nls.localize('leapfrog.transcript.language.es', "Spanish"),
				nls.localize('leapfrog.transcript.language.fr', "French"),
				nls.localize('leapfrog.transcript.language.de', "German"),
				nls.localize('leapfrog.transcript.language.it', "Italian"),
				nls.localize('leapfrog.transcript.language.pt', "Portuguese"),
				nls.localize('leapfrog.transcript.language.nl', "Dutch"),
				nls.localize('leapfrog.transcript.language.pl', "Polish"),
				nls.localize('leapfrog.transcript.language.ru', "Russian"),
				nls.localize('leapfrog.transcript.language.zh', "Chinese"),
				nls.localize('leapfrog.transcript.language.ja', "Japanese"),
				nls.localize('leapfrog.transcript.language.ko', "Korean"),
			],
			description: nls.localize('leapfrog.transcript.language', "Language for transcription"),
			scope: ConfigurationScope.RESOURCE,
		},
		[LeapfrogConfigurationKeys.TranscriptLanguageDetection]: {
			type: 'boolean',
			default: true,
			description: nls.localize('leapfrog.transcript.languageDetection', "Enable automatic language detection (overridden if specific language is set)"),
			scope: ConfigurationScope.RESOURCE,
		},
		[LeapfrogConfigurationKeys.TranscriptPunctuate]: {
			type: 'boolean',
			default: true,
			description: nls.localize('leapfrog.transcript.punctuate', "Enable automatic punctuation"),
			scope: ConfigurationScope.RESOURCE,
		},
		[LeapfrogConfigurationKeys.TranscriptFormatText]: {
			type: 'boolean',
			default: true,
			description: nls.localize('leapfrog.transcript.formatText', "Enable automatic text formatting (numbers, times, currency)"),
			scope: ConfigurationScope.RESOURCE,
		},
		[LeapfrogConfigurationKeys.TranscriptSentimentAnalysis]: {
			type: 'boolean',
			default: true,
			description: nls.localize('leapfrog.transcript.sentimentAnalysis', "Analyze sentiment of transcript segments"),
			scope: ConfigurationScope.RESOURCE,
		},
		[LeapfrogConfigurationKeys.TranscriptEntityDetection]: {
			type: 'boolean',
			default: false,
			description: nls.localize('leapfrog.transcript.entityDetection', "Detect named entities (people, places, organizations)"),
			scope: ConfigurationScope.RESOURCE,
		},
		[LeapfrogConfigurationKeys.TranscriptAutoChapters]: {
			type: 'boolean',
			default: false,
			description: nls.localize('leapfrog.transcript.autoChapters', "Automatically generate chapters from transcript structure"),
			scope: ConfigurationScope.RESOURCE,
		},
		[LeapfrogConfigurationKeys.TranscriptAutoHighlights]: {
			type: 'boolean',
			default: false,
			description: nls.localize('leapfrog.transcript.autoHighlights', "Automatically detect key phrases and highlights"),
			scope: ConfigurationScope.RESOURCE,
		},
		[LeapfrogConfigurationKeys.TranscriptDisfluencies]: {
			type: 'boolean',
			default: false,
			description: nls.localize('leapfrog.transcript.disfluencies', "Include filler words (um, uh, etc.) in transcript"),
			scope: ConfigurationScope.RESOURCE,
		},
		[LeapfrogConfigurationKeys.TranscriptFilterProfanity]: {
			type: 'boolean',
			default: false,
			description: nls.localize('leapfrog.transcript.filterProfanity', "Filter profanity from transcript text"),
			scope: ConfigurationScope.RESOURCE,
		},
		[LeapfrogConfigurationKeys.IndexIncludePatterns]: {
			type: 'array',
			items: {
				type: 'string'
			},
			default: ['**/*.md', '**/*.markdown', '**/*.txt', '**/*.transcript.json'],
			description: nls.localize('leapfrog.index.includePatterns', "File patterns to include in semantic indexing"),
			scope: ConfigurationScope.RESOURCE,
		},
		[LeapfrogConfigurationKeys.IndexExcludePatterns]: {
			type: 'array',
			items: {
				type: 'string'
			},
			default: ['.git', '.leapfrog', '.vscode', 'node_modules', '.DS_Store'],
			description: nls.localize('leapfrog.index.excludePatterns', "File patterns to exclude from semantic indexing"),
			scope: ConfigurationScope.RESOURCE,
		},
		[LeapfrogConfigurationKeys.IndexAutoIndex]: {
			type: 'boolean',
			default: true,
			description: nls.localize('leapfrog.index.autoIndex', "Automatically index new or modified files"),
			scope: ConfigurationScope.RESOURCE,
		},
	}
};
