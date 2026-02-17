/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../../nls.js';
import { IViewletViewOptions } from '../../../../browser/parts/views/viewsViewlet.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ViewPane, IViewPaneOptions } from '../../../../browser/parts/views/viewPane.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../../common/views.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { $, append, clearNode } from '../../../../../base/browser/dom.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { LEAPFROG_PREFERENCES_VIEW_ID, ILeapfrogIndexPreferencesService, IIndexableFile } from '../../common/leapfrog.js';

// ---------------------------------------------------------------------------
// Preferences View
// ---------------------------------------------------------------------------

export class LeapfrogPreferencesView extends ViewPane {

	private container: HTMLElement | undefined;
	private indexableFiles: IIndexableFile[] = [];
	private preferencesService: ILeapfrogIndexPreferencesService | undefined;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
		this.initialize();
	}

	private async initialize(): Promise<void> {
		// Try to get the preferences service (will be undefined in browser context)
		try {
			this.preferencesService = this.instantiationService.invokeFunction(
				(accessor) => accessor.get(ILeapfrogIndexPreferencesService, null as any)
			);
		} catch {
			// Service not available in this context
		}

		if (this.preferencesService) {
			this._register(this.preferencesService.onDidChangePreferences(() => this.refresh()));
			await this.refresh();
		}
	}

	override renderBody(container: HTMLElement): void {
		this.container = container;
		container.classList.add('leapfrog-preferences-view');
		this.render();
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

		clearNode(this.container);

		// Create main content area
		const content = append(this.container, $('div.preferences-content'));

		// Create header with stats
		const header = append(content, $('div.preferences-header'));
		const stats = this.getStats();

		append(header, $('h3', {}, nls.localize('leapfrogPreferencesTitle', 'File Indexing')));

		const statsDiv = append(header, $('div.preferences-stats'));
		append(statsDiv, $('div', {}, `${nls.localize('leapfrogPreferencesTotal', 'Total files')}: ${stats.total}`));
		append(statsDiv, $('div', {}, `${nls.localize('leapfrogPreferencesIndexed', 'Indexed')}: ${stats.indexed}`));
		append(statsDiv, $('div', {}, `${nls.localize('leapfrogPreferencesShouldIndex', 'Should index')}: ${stats.shouldIndex}`));

		// Create sections
		const sections = append(content, $('div.preferences-sections'));

		// Indexed files section
		if (stats.indexed > 0) {
			this.renderFileSection(
				sections,
				nls.localize('leapfrogPreferencesIndexedFiles', 'Indexed Files'),
				this.indexableFiles.filter(f => f.isIndexed)
			);
		}

		// Should index files section
		const shouldIndexFiles = this.indexableFiles.filter(f => f.shouldIndex && !f.isIndexed);
		if (shouldIndexFiles.length > 0) {
			this.renderFileSection(
				sections,
				nls.localize('leapfrogPreferencesShouldIndexSection', 'Ready to Index'),
				shouldIndexFiles
			);
		}

		// Not indexable files section
		const notIndexable = this.indexableFiles.filter(f => !f.shouldIndex && !f.isIndexed);
		if (notIndexable.length > 0) {
			this.renderFileSection(
				sections,
				nls.localize('leapfrogPreferencesNotIndexable', 'Excluded Files'),
				notIndexable
			);
		}

		// Refresh button
		const actionBar = append(content, $('div.preferences-actions'));
		const refreshBtn = append(actionBar, $('button.preferences-button', {}, nls.localize('leapfrogPreferencesRefresh', 'Refresh')));
		refreshBtn.onclick = () => this.refresh();
	}

	private renderFileSection(parent: HTMLElement, title: string, files: IIndexableFile[]): void {
		const section = append(parent, $('div.preferences-section'));
		append(section, $('h4.section-title', {}, title));

		if (files.length === 0) {
			append(section, $('div.section-empty', {}, nls.localize('leapfrogPreferencesNoFiles', 'No files')));
			return;
		}

		const fileList = append(section, $('ul.file-list'));
		for (const file of files) {
			const fileItem = append(fileList, $('li.file-item'));
			const fileName = append(fileItem, $('span.file-name', {}, file.fileName));
			const filePath = append(fileItem, $('span.file-path', {}, file.path));

			if (file.reason) {
				const reason = append(fileItem, $('span.file-reason', {}, file.reason));
				reason.title = file.reason;
			}
		}
	}

	private getStats(): { total: number; indexed: number; shouldIndex: number } {
		return {
			total: this.indexableFiles.length,
			indexed: this.indexableFiles.filter(f => f.isIndexed).length,
			shouldIndex: this.indexableFiles.filter(f => f.shouldIndex && !f.isIndexed).length,
		};
	}

	override focus(): void {
		if (this.container) {
			this.container.focus();
		}
	}
}
