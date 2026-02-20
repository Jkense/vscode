/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { LeapfrogSettingsEditorInput } from './leapfrogSettingsEditorInput.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IConfigurationService, ConfigurationTarget } from '../../../../platform/configuration/common/configuration.js';
import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { ILeapfrogIndexPreferencesService, ILeapfrogIndexService, IIndexableFile, LeapfrogIndexStatus } from '../common/leapfrog.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';

const SYNCING_STATUSES: LeapfrogIndexStatus[] = ['scanning', 'chunking', 'embedding'];

type SettingsSection = 'general' | 'indexing';

interface NavItem {
	id: SettingsSection;
	label: string;
	icon: ThemeIcon;
}

const NAV_ITEMS: NavItem[] = [
	{ id: 'general', label: 'General', icon: Codicon.settingsGear },
	{ id: 'indexing', label: 'Indexing & Docs', icon: Codicon.package },
];

export class LeapfrogSettingsEditor extends EditorPane {

	static readonly ID: string = 'leapfrog.editor.settings';

	private container: HTMLElement | undefined;
	private sidebar: HTMLElement | undefined;
	private mainContent: HTMLElement | undefined;
	private activeSection: SettingsSection = 'indexing';
	private preferencesService: ILeapfrogIndexPreferencesService | undefined;
	private indexService: ILeapfrogIndexService | undefined;
	private indexableFiles: IIndexableFile[] = [];
	private dotsInterval: ReturnType<typeof setInterval> | undefined;
	private dotsCount = 0;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super(LeapfrogSettingsEditor.ID, group, telemetryService, themeService, storageService);
		this.initialize();
	}

	private async initialize(): Promise<void> {
		try {
			this.preferencesService = this.instantiationService.invokeFunction(
				(accessor) => accessor.get(ILeapfrogIndexPreferencesService)
			);
			this.indexService = this.instantiationService.invokeFunction(
				(accessor) => accessor.get(ILeapfrogIndexService)
			);
		} catch {
			// Services not available in this context
		}

		if (this.preferencesService) {
			this._register(this.preferencesService.onDidChangePreferences(() => this.refresh()));
		}
		if (this.indexService) {
			this._register(this.indexService.onDidChangeIndexProgress(() => this.refresh()));
		}
	}

	override async setInput(input: LeapfrogSettingsEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		await this.refresh();
	}

	protected override createEditor(parent: HTMLElement): void {
		this.container = parent;
		parent.classList.add('leapfrog-settings-editor');
		this.render();
	}

	override dispose(): void {
		this.stopDotsAnimation();
		super.dispose();
	}

	private stopDotsAnimation(): void {
		if (this.dotsInterval) {
			clearInterval(this.dotsInterval);
			this.dotsInterval = undefined;
		}
	}

	private startDotsAnimation(spanEl: HTMLElement): void {
		this.stopDotsAnimation();
		this.dotsCount = 0;
		const update = () => {
			this.dotsCount = (this.dotsCount % 3) + 1;
			spanEl.textContent = '.'.repeat(this.dotsCount);
		};
		update();
		this.dotsInterval = setInterval(update, 400);
	}

	private async refresh(): Promise<void> {
		if (!this.preferencesService) {
			return;
		}

		try {
			this.indexableFiles = await this.preferencesService.scanWorkspace();
			if (this.container) {
				this.render();
			}
		} catch (error) {
			console.error('[Leapfrog] Error scanning workspace:', error);
		}
	}

	private render(): void {
		if (!this.container) {
			return;
		}

		this.stopDotsAnimation();
		clearNode(this.container);

		const layout = append(this.container, $('div.leapfrog-settings-layout'));

		// Sidebar
		this.sidebar = append(layout, $('div.leapfrog-settings-sidebar'));
		this.renderSidebar(this.sidebar);

		// Main content
		this.mainContent = append(layout, $('div.leapfrog-settings-main'));
		this.renderMainContent(this.mainContent);
	}

	private renderSidebar(sidebar: HTMLElement): void {
		// User profile section
		const profileSection = append(sidebar, $('div.leapfrog-settings-profile'));
		const avatar = append(profileSection, $('div.leapfrog-settings-avatar'));
		avatar.textContent = 'J';
		append(profileSection, $('div', { className: 'leapfrog-settings-email' }, 'user@example.com'));
		append(profileSection, $('div', { className: 'leapfrog-settings-plan' }, nls.localize('leapfrogSettingsProPlan', 'Pro Plan')));

		// Search bar
		const searchContainer = append(sidebar, $('div.leapfrog-settings-search-container'));
		append(searchContainer, $('span', { className: 'codicon leapfrog-settings-search-icon ' + ThemeIcon.asClassName(Codicon.search) }));
		append(searchContainer, $('input', {
			type: 'text',
			className: 'leapfrog-settings-search',
			placeholder: nls.localize('leapfrogSettingsSearchPlaceholder', 'Search settings Ctrl+F')
		}));

		// Nav items
		const navList = append(sidebar, $('div.leapfrog-settings-nav'));
		for (const item of NAV_ITEMS) {
			const navItem = append(navList, $('div.leapfrog-settings-nav-item', {
				'data-section': item.id,
				class: this.activeSection === item.id ? 'active' : ''
			}));
			navItem.onclick = () => {
				this.activeSection = item.id;
				this.render();
			};
			append(navItem, $('span', { className: 'codicon ' + ThemeIcon.asClassName(item.icon) }));
			append(navItem, $('span', { className: 'leapfrog-settings-nav-label' }, item.label));
		}
	}

	private renderMainContent(mainContent: HTMLElement): void {
		if (this.activeSection === 'general') {
			append(mainContent, $('div.leapfrog-settings-placeholder', {}, nls.localize('leapfrogSettingsGeneralComingSoon', 'General settings coming soon.')));
			return;
		}

		const content = append(mainContent, $('div.indexing-panel'));

		// Header
		const header = append(content, $('header'));
		append(header, $('h1', { className: 'indexing-title' }, nls.localize('leapfrogSettingsIndexingDocs', 'Indexing & Docs')));
		append(header, $('p', { className: 'indexing-subtitle' }, nls.localize('leapfrogSettingsCodebase', 'Codebase')));

		// Card 1: Codebase Indexing
		this.renderCodebaseIndexingCard(content);

		// Card 2: Index New Folders
		this.renderIndexNewFoldersCard(content);

		// Card 3: Ignore Files in .cursorignore
		this.renderCursorignoreCard(content);
	}

	private renderCodebaseIndexingCard(parent: HTMLElement): void {
		const card = append(parent, $('div.settings-card'));
		const cardContent = append(card, $('div.settings-card-content'));

		const headerRow = append(cardContent, $('div.flex.items-start.gap-2'));
		const textBlock = append(headerRow, $('div'));
		const titleRow = append(textBlock, $('div.flex.items-center.gap-1_5'));
		append(titleRow, $('h2', { className: 'card-title' }, nls.localize('leapfrogSettingsCodebaseIndexing', 'Codebase Indexing')));
		const helpIcon = append(titleRow, $('span', { className: 'codicon ' + ThemeIcon.asClassName(Codicon.question) }));
		helpIcon.setAttribute('title', nls.localize('leapfrogSettingsCodebaseIndexingHelp', 'Help'));
		append(textBlock, $('p', { className: 'card-description' },
			nls.localize('leapfrogSettingsCodebaseIndexingDesc', 'Embed codebase for improved contextual understanding and knowledge. Embeddings and metadata are stored in the '),
			$('span', { className: 'underline' }, nls.localize('leapfrogSettingsCloud', 'cloud')),
			nls.localize('leapfrogSettingsCodebaseIndexingDesc2', ', but all code is stored locally.')
		));

		const stats = this.getStats();
		const progress = this.indexService?.getProgress();
		const isSyncing = progress && SYNCING_STATUSES.includes(progress.status);
		const progressPct = progress && progress.totalFiles > 0
			? Math.round((progress.processedFiles / progress.totalFiles) * 100)
			: (stats.indexed > 0 && stats.total > 0 ? Math.round((stats.indexed / stats.total) * 100) : 0);

		const progressBlock = append(cardContent, $('div.flex.flex-col.gap-1_5'));
		const progressLabel = append(progressBlock, $('p', { className: 'progress-label' }));
		if (isSyncing) {
			const syncingSpan = append(progressLabel, $('span', { className: 'inline-block', style: 'width: 5em' }));
			append(syncingSpan, document.createTextNode(nls.localize('leapfrogSettingsSyncing', 'Syncing')));
			const dotsSpan = append(syncingSpan, $('span', { className: 'dots-animation' }));
			this.startDotsAnimation(dotsSpan);
		} else {
			append(progressLabel, document.createTextNode(progressPct + '%'));
		}

		const progressBar = append(progressBlock, $('div.progress-bar'));
		const progressFill = append(progressBar, $('div.progress-bar-fill'));
		if (isSyncing) {
			progressBar.classList.add('animate-pulse');
			progressFill.style.width = '100%';
		} else {
			progressFill.style.width = progressPct + '%';
		}

		const fileCount = stats.total;
		append(progressBlock, $('p', { className: 'file-count' }, fileCount.toLocaleString() + ' ' + nls.localize('leapfrogSettingsFiles', 'files')));

		const actionsRow = append(cardContent, $('div.flex.items-center.justify-end.gap-3.pt-1'));
		const syncBtn = append(actionsRow, $('button.settings-button.outline.sm', {})) as HTMLButtonElement;
		syncBtn.disabled = !!isSyncing;
		const syncIcon = append(syncBtn, $('span'));
		syncIcon.className = isSyncing ? 'codicon codicon-loading' : ThemeIcon.asClassName(Codicon.sync);
		append(syncBtn, document.createTextNode(' ' + (isSyncing ? nls.localize('leapfrogSettingsSyncing', 'Syncing') : nls.localize('leapfrogSettingsSync', 'Sync'))));
		syncBtn.onclick = () => this.commandService.executeCommand('leapfrog.indexWorkspace');

		const deleteBtn = append(actionsRow, $('button.settings-button.outline.sm', {})) as HTMLButtonElement;
		deleteBtn.disabled = !!isSyncing;
		append(deleteBtn, $('span', { className: ThemeIcon.asClassName(Codicon.trash) }));
		append(deleteBtn, document.createTextNode(' ' + nls.localize('leapfrogSettingsDeleteIndex', 'Delete Index')));
		deleteBtn.title = nls.localize('leapfrogSettingsComingSoon', 'Coming soon');
		deleteBtn.onclick = () => { /* Coming soon */ };
	}

	private renderIndexNewFoldersCard(parent: HTMLElement): void {
		const card = append(parent, $('div.settings-card'));
		const cardContent = append(card, $('div.settings-card-content.flex-between'));

		const textBlock = append(cardContent, $('div'));
		append(textBlock, $('h2', { className: 'card-title' }, nls.localize('leapfrogSettingsIndexNewFolders', 'Index New Folders')));
		append(textBlock, $('p', { className: 'card-description' }, nls.localize('leapfrogSettingsIndexNewFoldersDesc', 'Automatically index any new folders with fewer than 50,000 files')));

		const config = this.configurationService.getValue('leapfrog.index') as { autoIndex?: boolean } | undefined;
		const indexNewFolders = config?.autoIndex !== false;

		const switchContainer = append(cardContent, $('div.settings-switch-container'));
		const checkbox = append(switchContainer, $('input.settings-checkbox', { type: 'checkbox', id: 'leapfrog-auto-index' })) as HTMLInputElement;
		checkbox.checked = indexNewFolders;
		checkbox.onchange = () => this.saveAutoIndex(checkbox.checked);
		const toggleTrack = append(switchContainer, $('label.settings-toggle-track', { for: 'leapfrog-auto-index' }));
		append(toggleTrack, $('span.settings-toggle-knob'));
	}

	private renderCursorignoreCard(parent: HTMLElement): void {
		const card = append(parent, $('div.settings-card'));
		const cardContent = append(card, $('div.settings-card-content.flex-between'));

		const textBlock = append(cardContent, $('div'));
		append(textBlock, $('h2', { className: 'card-title' }, nls.localize('leapfrogSettingsIgnoreCursorignore', 'Ignore Files in .cursorignore')));
		const desc = append(textBlock, $('p', { className: 'card-description' }));
		append(desc, document.createTextNode(nls.localize('leapfrogSettingsCursorignoreDesc', 'Files to exclude from indexing in addition to .gitignore. ')));
		const viewLink = append(desc, $('span', { className: 'link-underline cursor-pointer' }, nls.localize('leapfrogSettingsViewIncludedFiles', 'View included files.')));
		viewLink.title = nls.localize('leapfrogSettingsComingSoon', 'Coming soon');

		const editBtn = append(cardContent, $('button.settings-button.outline.sm', {}, nls.localize('leapfrogSettingsEdit', 'Edit')));
		editBtn.title = nls.localize('leapfrogSettingsComingSoon', 'Coming soon');
		editBtn.onclick = () => { /* Coming soon */ };
	}

	private saveAutoIndex(value: boolean): void {
		this.configurationService.updateValue('leapfrog.index.autoIndex', value, ConfigurationTarget.USER);
	}

	private getStats(): { total: number; indexed: number; shouldIndex: number } {
		return {
			total: this.indexableFiles.length,
			indexed: this.indexableFiles.filter(f => f.isIndexed).length,
			shouldIndex: this.indexableFiles.filter(f => f.shouldIndex && !f.isIndexed).length,
		};
	}

	override layout(): void {
		// Editor layout logic if needed
	}
}
