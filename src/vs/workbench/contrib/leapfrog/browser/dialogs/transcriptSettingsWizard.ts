/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ILeapfrogTranscriptionOptions } from '../../common/leapfrog.js';

/**
 * Wizard for configuring transcript settings from user preferences.
 * Builds ILeapfrogTranscriptionOptions from Leapfrog configuration.
 */
export class TranscriptSettingsWizard extends Disposable {
	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IDialogService private readonly dialogService: IDialogService,
	) {
		super();
	}

	/**
	 * Build transcription options from Leapfrog configuration settings.
	 * Diarization is always enabled regardless of user settings.
	 */
	buildOptionsFromSettings(): ILeapfrogTranscriptionOptions {
		const config = this.configurationService.getValue('leapfrog') as any;
		const transcript = config?.transcript ?? {};

		return {
			// Speaker diarization is ALWAYS enabled
			diarization: true,

			// Language settings - auto-detect if not specified
			language: this.normalizeLanguage(transcript.language ?? 'auto'),
			languageDetection: transcript.language === 'auto' ? true : (transcript.languageDetection ?? true),

			// Text processing
			punctuate: transcript.punctuate ?? true,
			formatText: transcript.formatText ?? true,
			disfluencies: transcript.disfluencies ?? false,
			filterProfanity: transcript.filterProfanity ?? false,

			// AI features
			sentimentAnalysis: transcript.sentimentAnalysis ?? true,
			entityDetection: transcript.entityDetection ?? false,
			autoChapters: transcript.autoChapters ?? false,
			autoHighlights: transcript.autoHighlights ?? false,
		};
	}

	/**
	 * Show a quick pick dialog to configure transcript settings.
	 * Returns options based on user selections.
	 */
	async showSettingsDialog(): Promise<ILeapfrogTranscriptionOptions | undefined> {
		const result = await this.dialogService.confirm({
			title: 'Transcript Settings',
			message: 'Configure how your audio will be transcribed',
			detail: `
Transcript Settings:
• Speaker detection and diarization (always enabled)
• Sentiment analysis, punctuation, and formatting (enabled by default)
• Language detection (auto)

Click "OK" to use default settings, or cancel to customize in Settings (Ctrl+,).
			`.trim(),
		});

		if (!result.confirmed) {
			return undefined;
		}

		// Return options built from current settings
		return this.buildOptionsFromSettings();
	}

	/**
	 * Normalize language code to AssemblyAI format.
	 */
	private normalizeLanguage(lang: string | 'auto'): string | 'auto' {
		if (lang === 'auto') {
			return 'auto';
		}

		// Map two-letter codes to AssemblyAI language codes
		const mapping: Record<string, string> = {
			'en': 'en_us',
			'es': 'es',
			'fr': 'fr',
			'de': 'de',
			'it': 'it',
			'pt': 'pt',
			'nl': 'nl',
			'pl': 'pl',
			'ru': 'ru',
			'zh': 'zh',
			'ja': 'ja',
			'ko': 'ko',
		};

		return mapping[lang] ?? lang;
	}
}
