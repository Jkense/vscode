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
	}
};
