/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Editor integration for Leapfrog tags:
 *
 *  - "Apply Tag" command & editor context menu action
 *  - Per-tag-color text decorations that highlight tagged ranges
 *  - End-of-line colored indicators with hover tooltips
 *  - Floating tag button above text selections
 *  - Captures W3C-style prefix/suffix when applying tags
 */

import * as nls from '../../../../nls.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ICodeEditor, IContentWidget, IContentWidgetPosition, ContentWidgetPositionPreference } from '../../../../editor/browser/editorBrowser.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import { IModelDeltaDecoration, TrackedRangeStickiness } from '../../../../editor/common/model.js';
import { ModelDecorationOptions } from '../../../../editor/common/model/textModel.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { MenuId, Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from '../../../../platform/quickinput/common/quickInput.js';
import { KeyMod, KeyCode, KeyChord } from '../../../../base/common/keyCodes.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ITextAnchor, ILeapfrogTagService, ILeapfrogTagWithCount, ILeapfrogTagApplicationWithTag } from '../common/leapfrog.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { mainWindow } from '../../../../base/browser/window.js';

// ---------------------------------------------------------------------------
// Dynamic CSS for per-tag-color decorations
// ---------------------------------------------------------------------------

/**
 * Manages a <style> element for dynamically-generated tag-color CSS classes.
 */
class TagColorStyleManager {

	private readonly styleElement: HTMLStyleElement;
	private readonly knownColors = new Set<string>();

	constructor() {
		this.styleElement = mainWindow.document.createElement('style');
		this.styleElement.id = 'leapfrog-tag-dynamic-styles';
		mainWindow.document.head.appendChild(this.styleElement);
	}

	/**
	 * Ensure CSS rules exist for the given hex color and return the class name.
	 */
	ensureColor(hex: string): string {
		const safeHex = hex.replace('#', '');
		const className = `leapfrog-tag-color-${safeHex}`;

		if (!this.knownColors.has(safeHex)) {
			this.knownColors.add(safeHex);
			const rgb = this.hexToRgb(hex);
			this.styleElement.sheet?.insertRule(
				`.${className} { background-color: rgba(${rgb}, 0.15); border-bottom: 2px solid rgba(${rgb}, 0.5); border-radius: 2px; }`,
				this.styleElement.sheet.cssRules.length
			);
			this.styleElement.sheet?.insertRule(
				`.leapfrog-tag-eol-${safeHex} { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-left: 4px; background-color: ${hex}; }`,
				this.styleElement.sheet.cssRules.length
			);
		}

		return className;
	}

	/**
	 * Return the EOL indicator class for a given color.
	 */
	eolClassName(hex: string): string {
		const safeHex = hex.replace('#', '');
		this.ensureColor(hex); // ensure rules exist
		return `leapfrog-tag-eol-${safeHex}`;
	}

	private hexToRgb(hex: string): string {
		const h = hex.replace('#', '');
		const r = parseInt(h.substring(0, 2), 16);
		const g = parseInt(h.substring(2, 4), 16);
		const b = parseInt(h.substring(4, 6), 16);
		return `${r}, ${g}, ${b}`;
	}

	dispose(): void {
		this.styleElement.remove();
	}
}

// ---------------------------------------------------------------------------
// Decoration options cache (per-color)
// ---------------------------------------------------------------------------

const decorationOptionsCache = new Map<string, ModelDecorationOptions>();

function getDecorationOptions(hex: string, styleManager: TagColorStyleManager): ModelDecorationOptions {
	let options = decorationOptionsCache.get(hex);
	if (!options) {
		const className = styleManager.ensureColor(hex);
		options = ModelDecorationOptions.register({
			description: `leapfrog-tag-highlight-${hex.replace('#', '')}`,
			stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
			className,
		});
		decorationOptionsCache.set(hex, options);
	}
	return options;
}

// ---------------------------------------------------------------------------
// Prefix / suffix capture helper
// ---------------------------------------------------------------------------

const ANCHOR_CONTEXT_LENGTH = 32;

function captureAnchor(
	text: string,
	startOffset: number,
	endOffset: number,
): ITextAnchor {
	const selectedText = text.substring(startOffset, endOffset);

	const prefixStart = Math.max(0, startOffset - ANCHOR_CONTEXT_LENGTH);
	const prefix = text.substring(prefixStart, startOffset);

	const suffixEnd = Math.min(text.length, endOffset + ANCHOR_CONTEXT_LENGTH);
	const suffix = text.substring(endOffset, suffixEnd);

	return { startOffset, endOffset, selectedText, prefix, suffix };
}

// ---------------------------------------------------------------------------
// "Apply Tag" command
// ---------------------------------------------------------------------------

class ApplyTagAction extends Action2 {

	static readonly ID = 'leapfrog.applyTag';

	constructor() {
		super({
			id: ApplyTagAction.ID,
			title: nls.localize2('applyTag', "Leapfrog: Apply Tag"),
			f1: true,
			keybinding: {
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyCode.KeyT),
				weight: KeybindingWeight.WorkbenchContrib,
				when: EditorContextKeys.textInputFocus,
			},
			menu: [
				{
					id: MenuId.EditorContext,
					group: 'leapfrog',
					order: 1,
					when: EditorContextKeys.hasNonEmptySelection,
				},
			],
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const tagService = accessor.get(ILeapfrogTagService);
		const quickInputService = accessor.get(IQuickInputService);
		const logService = accessor.get(ILogService);

		// Get active code editor
		const editor = editorService.activeTextEditorControl as ICodeEditor | undefined;
		if (!editor || !editor.hasModel()) {
			return;
		}

		const selection = editor.getSelection();
		if (!selection || selection.isEmpty()) {
			return;
		}

		const model = editor.getModel();
		const resource = model.uri;

		// Only support file:// URIs
		if (resource.scheme !== 'file') {
			return;
		}

		const filePath = resource.fsPath;

		// Get available tags
		const tags = await tagService.getTags();
		if (tags.length === 0) {
			// Offer to create one
			const newTag = await this.promptCreateTag(quickInputService, tagService);
			if (!newTag) { return; }
			await this.applyToSelection(tagService, logService, editor, filePath, newTag.id);
			return;
		}

		// Build flat list of tags (including nested) with indent depth
		const flatTags: { tag: ILeapfrogTagWithCount; depth: number }[] = [];
		const flatten = (list: ILeapfrogTagWithCount[], depth: number) => {
			for (const t of list) {
				flatTags.push({ tag: t, depth });
				flatten(t.children, depth + 1);
			}
		};
		flatten(tags, 0);

		interface TagQuickPickItem extends IQuickPickItem { tagId: string; isCreateNew?: boolean }

		const items: (TagQuickPickItem | IQuickPickSeparator)[] = flatTags.map(({ tag, depth }) => ({
			label: `${'  '.repeat(depth)}$(circle-filled) ${tag.name}`,
			description: tag.color,
			detail: tag.applicationCount === 1
				? nls.localize('tagUsesSingular', "{0} application", tag.applicationCount)
				: nls.localize('tagUsesPlural', "{0} applications", tag.applicationCount),
			tagId: tag.id,
			iconClass: undefined,
		}));

		// Add separator + "Create New Tag..." option
		items.push({ type: 'separator', label: '' });
		items.push({
			label: `$(add) ${nls.localize('createNewTag', "Create New Tag...")}`,
			tagId: '',
			isCreateNew: true,
		});

		const picked = await quickInputService.pick(items as TagQuickPickItem[], {
			placeHolder: nls.localize('pickTag', "Select a tag to apply"),
		});

		if (!picked) { return; }

		const pickedItem = picked as TagQuickPickItem;
		if (pickedItem.isCreateNew) {
			const newTag = await this.promptCreateTag(quickInputService, tagService);
			if (!newTag) { return; }
			await this.applyToSelection(tagService, logService, editor, filePath, newTag.id);
			return;
		}

		await this.applyToSelection(tagService, logService, editor, filePath, pickedItem.tagId);
	}

	private async promptCreateTag(
		quickInputService: IQuickInputService,
		tagService: ILeapfrogTagService,
	): Promise<ILeapfrogTagWithCount | undefined> {
		const name = await quickInputService.input({
			placeHolder: nls.localize('newTagName', "Tag name"),
			prompt: nls.localize('enterTagName', "Enter a name for the new tag"),
		});
		if (!name) { return undefined; }

		const DEFAULT_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
		const colorPick = await quickInputService.pick(
			DEFAULT_COLORS.map(c => ({ label: `$(circle-filled) ${c}`, description: c, color: c })),
			{ placeHolder: nls.localize('pickColor', "Select a tag color") },
		);
		const color = (colorPick as { color: string } | undefined)?.color ?? '#22c55e';

		return tagService.createTag(name.trim(), color);
	}

	private async applyToSelection(
		tagService: ILeapfrogTagService,
		logService: ILogService,
		editor: ICodeEditor,
		filePath: string,
		tagId: string,
	): Promise<void> {
		const model = editor.getModel()!;
		const selection = editor.getSelection()!;

		const fullText = model.getValue();
		const startOffset = model.getOffsetAt(selection.getStartPosition());
		const endOffset = model.getOffsetAt(selection.getEndPosition());

		const anchor = captureAnchor(fullText, startOffset, endOffset);

		try {
			await tagService.applyTag(tagId, filePath, anchor);
			logService.info('[Leapfrog] Tag applied to selection in', filePath);
		} catch (err) {
			logService.error('[Leapfrog] Failed to apply tag', err);
		}
	}
}

registerAction2(ApplyTagAction);

// ---------------------------------------------------------------------------
// Default tag colors for creation
// ---------------------------------------------------------------------------

const DEFAULT_TAG_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

// ---------------------------------------------------------------------------
// Floating tag picker above selection
// ---------------------------------------------------------------------------

interface ITagPickerCallbacks {
	onApplyTag(tagId: string): void;
	onCreateAndApplyTag(name: string, color: string): void;
}

class TagFloatingMenuWidget implements IContentWidget {

	private static readonly ID = 'leapfrog.tagFloatingMenu';

	readonly allowEditorOverflow = true;
	readonly suppressMouseDown = false;

	private readonly domNode: HTMLElement;
	private readonly triggerBtn: HTMLElement;
	private readonly dropdown: HTMLElement;
	private readonly searchInput: HTMLInputElement;
	private readonly tagList: HTMLElement;
	private readonly createRow: HTMLElement;
	private readonly createNameSpan: HTMLElement;

	private position: IContentWidgetPosition | null = null;
	private isOpen = false;
	private tags: ILeapfrogTagWithCount[] = [];
	private flatTags: { tag: ILeapfrogTagWithCount; depth: number }[] = [];
	private highlightIndex = -1;
	private filteredItems: HTMLElement[] = [];

	constructor(
		private readonly editor: ICodeEditor,
		private readonly tagService: ILeapfrogTagService,
		private readonly callbacks: ITagPickerCallbacks,
	) {
		// Root container
		this.domNode = document.createElement('div');
		this.domNode.className = 'leapfrog-tag-floating-menu';

		// Trigger button (tag icon + label)
		this.triggerBtn = document.createElement('button');
		this.triggerBtn.className = 'leapfrog-tag-floating-btn';
		this.triggerBtn.title = nls.localize('applyTagTooltip', "Apply Tag (Ctrl+K, T)");

		const icon = document.createElement('span');
		icon.className = ThemeIcon.asClassName(Codicon.tag);
		this.triggerBtn.appendChild(icon);

		const label = document.createElement('span');
		label.className = 'leapfrog-tag-floating-label';
		label.textContent = nls.localize('tagLabel', "Tag");
		this.triggerBtn.appendChild(label);

		this.triggerBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (this.isOpen) {
				this.closeDropdown();
			} else {
				this.openDropdown();
			}
		});

		this.domNode.appendChild(this.triggerBtn);

		// Dropdown panel
		this.dropdown = document.createElement('div');
		this.dropdown.className = 'leapfrog-tag-picker-dropdown';
		this.dropdown.style.display = 'none';

		// Search input
		this.searchInput = document.createElement('input');
		this.searchInput.className = 'leapfrog-tag-picker-input';
		this.searchInput.type = 'text';
		this.searchInput.placeholder = nls.localize('searchOrCreate', "Search or create tag...");

		this.searchInput.addEventListener('input', () => this.onFilterChanged());
		this.searchInput.addEventListener('keydown', (e) => this.onInputKeyDown(e));

		// Prevent editor from stealing focus
		this.searchInput.addEventListener('focus', (e) => e.stopPropagation());

		this.dropdown.appendChild(this.searchInput);

		// Tag list (scrollable)
		this.tagList = document.createElement('div');
		this.tagList.className = 'leapfrog-tag-picker-list';
		this.dropdown.appendChild(this.tagList);

		// "Create new tag" row (at the bottom, hidden when not needed)
		this.createRow = document.createElement('div');
		this.createRow.className = 'leapfrog-tag-picker-create';
		this.createRow.style.display = 'none';

		const createIcon = document.createElement('span');
		createIcon.className = ThemeIcon.asClassName(Codicon.add);
		this.createRow.appendChild(createIcon);

		this.createNameSpan = document.createElement('span');
		this.createRow.appendChild(this.createNameSpan);

		this.createRow.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.doCreate();
		});

		this.dropdown.appendChild(this.createRow);

		this.domNode.appendChild(this.dropdown);

		// Close dropdown when clicking outside
		this.domNode.addEventListener('mousedown', (e) => {
			// Keep focus in widget
			e.stopPropagation();
		});
	}

	// -- IContentWidget interface --

	getId(): string {
		return TagFloatingMenuWidget.ID;
	}

	getDomNode(): HTMLElement {
		return this.domNode;
	}

	getPosition(): IContentWidgetPosition | null {
		return this.position;
	}

	// -- Show / hide the widget (position-level) --

	show(lineNumber: number, column: number): void {
		this.position = {
			position: { lineNumber, column },
			preference: [ContentWidgetPositionPreference.ABOVE, ContentWidgetPositionPreference.BELOW],
		};
		this.editor.layoutContentWidget(this);
	}

	hide(): void {
		this.closeDropdown();
		this.position = null;
		this.editor.layoutContentWidget(this);
	}

	// -- Open / close the inline tag picker dropdown --

	private async openDropdown(): Promise<void> {
		// Fetch latest tags
		try {
			this.tags = await this.tagService.getTags();
		} catch {
			this.tags = [];
		}

		// Flatten tree
		this.flatTags = [];
		const flatten = (list: ILeapfrogTagWithCount[], depth: number) => {
			for (const t of list) {
				this.flatTags.push({ tag: t, depth });
				flatten(t.children, depth + 1);
			}
		};
		flatten(this.tags, 0);

		this.isOpen = true;
		this.dropdown.style.display = '';
		this.searchInput.value = '';
		this.highlightIndex = -1;
		this.renderTagList('');

		// Autofocus the input after widget layout completes
		setTimeout(() => {
			this.searchInput.focus({ preventScroll: true });
		}, 50);

		this.editor.layoutContentWidget(this);
	}

	closeDropdown(): void {
		if (!this.isOpen) { return; }
		this.isOpen = false;
		this.dropdown.style.display = 'none';
		this.editor.layoutContentWidget(this);
	}

	get opened(): boolean {
		return this.isOpen;
	}

	// -- Render the tag list filtered by query --

	private renderTagList(query: string): void {
		this.tagList.replaceChildren();
		this.filteredItems = [];

		const lowerQuery = query.toLowerCase().trim();

		let hasExactMatch = false;

		for (const { tag, depth } of this.flatTags) {
			if (lowerQuery && !tag.name.toLowerCase().includes(lowerQuery)) {
				continue;
			}

			if (tag.name.toLowerCase() === lowerQuery) {
				hasExactMatch = true;
			}

			const row = document.createElement('div');
			row.className = 'leapfrog-tag-picker-item';
			if (depth > 0) {
				row.style.paddingLeft = `${8 + depth * 16}px`;
			}

			const dot = document.createElement('span');
			dot.className = 'leapfrog-tag-picker-dot';
			dot.style.backgroundColor = tag.color;
			row.appendChild(dot);

			const name = document.createElement('span');
			name.className = 'leapfrog-tag-picker-name';
			name.textContent = tag.name;
			row.appendChild(name);

			const count = document.createElement('span');
			count.className = 'leapfrog-tag-picker-count';
			count.textContent = String(tag.applicationCount);
			row.appendChild(count);

			row.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.selectTag(tag.id);
			});

			this.tagList.appendChild(row);
			this.filteredItems.push(row);
		}

		// Show "Create" row when user typed something that doesn't exactly match
		if (lowerQuery.length > 0 && !hasExactMatch) {
			this.createNameSpan.textContent = nls.localize('createTagNamed', "Create \"{0}\"", query.trim());
			this.createRow.style.display = '';
		} else {
			this.createRow.style.display = 'none';
		}

		// Reset highlight
		this.highlightIndex = -1;
		this.updateHighlight();
	}

	// -- Keyboard navigation --

	private onInputKeyDown(e: KeyboardEvent): void {
		const totalItems = this.filteredItems.length + (this.createRow.style.display !== 'none' ? 1 : 0);

		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				if (totalItems > 0) {
					this.highlightIndex = Math.min(this.highlightIndex + 1, totalItems - 1);
					this.updateHighlight();
				}
				break;

			case 'ArrowUp':
				e.preventDefault();
				if (totalItems > 0) {
					this.highlightIndex = Math.max(this.highlightIndex - 1, -1);
					this.updateHighlight();
				}
				break;

			case 'Enter':
				e.preventDefault();
				if (this.highlightIndex >= 0 && this.highlightIndex < this.filteredItems.length) {
					// Select the highlighted tag
					this.filteredItems[this.highlightIndex].click();
				} else if (this.highlightIndex === this.filteredItems.length && this.createRow.style.display !== 'none') {
					// "Create" row is highlighted
					this.doCreate();
				} else if (this.filteredItems.length === 1) {
					// Only one result - select it
					this.filteredItems[0].click();
				} else if (this.createRow.style.display !== 'none') {
					// Input text, no highlight - create
					this.doCreate();
				}
				break;

			case 'Escape':
				e.preventDefault();
				this.closeDropdown();
				this.editor.focus();
				break;
		}
	}

	private updateHighlight(): void {
		// Clear all highlights
		for (const item of this.filteredItems) {
			item.classList.remove('highlighted');
		}
		this.createRow.classList.remove('highlighted');

		if (this.highlightIndex >= 0 && this.highlightIndex < this.filteredItems.length) {
			this.filteredItems[this.highlightIndex].classList.add('highlighted');
			this.filteredItems[this.highlightIndex].scrollIntoView({ block: 'nearest' });
		} else if (this.highlightIndex === this.filteredItems.length && this.createRow.style.display !== 'none') {
			this.createRow.classList.add('highlighted');
		}
	}

	private onFilterChanged(): void {
		this.renderTagList(this.searchInput.value);
	}

	// -- Actions --

	private selectTag(tagId: string): void {
		this.closeDropdown();
		this.callbacks.onApplyTag(tagId);
	}

	private doCreate(): void {
		const name = this.searchInput.value.trim();
		if (!name) { return; }
		// Pick a random default color
		const color = DEFAULT_TAG_COLORS[Math.floor(Math.random() * DEFAULT_TAG_COLORS.length)];
		this.closeDropdown();
		this.callbacks.onCreateAndApplyTag(name, color);
	}
}

// ---------------------------------------------------------------------------
// Editor decoration controller (workbench contribution)
// ---------------------------------------------------------------------------

class LeapfrogTagDecorationController extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.leapfrogTagDecorations';

	private decorationIds: string[] = [];
	private readonly styleManager = new TagColorStyleManager();

	private floatingWidget: TagFloatingMenuWidget | undefined;
	private readonly editorListeners = this._register(new DisposableStore());

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@ILeapfrogTagService private readonly tagService: ILeapfrogTagService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		// Refresh decorations when the active editor changes
		this._register(this.editorService.onDidActiveEditorChange(() => {
			this.updateDecorations();
			this.setupEditorListeners();
		}));

		// Refresh decorations when tag applications change
		this._register(this.tagService.onDidChangeTagApplications(() => this.updateDecorations()));

		// Initial setup
		this.setupEditorListeners();
		this.updateDecorations();
	}

	private setupEditorListeners(): void {
		this.editorListeners.clear();

		// Remove old floating widget
		if (this.floatingWidget) {
			const prevEditor = this.floatingWidget['editor'] as ICodeEditor;
			prevEditor.removeContentWidget(this.floatingWidget);
			this.floatingWidget = undefined;
		}

		const editor = this.editorService.activeTextEditorControl as ICodeEditor | undefined;
		if (!editor || !editor.hasModel()) {
			return;
		}

		// Create floating widget for this editor
		const tagService = this.tagService;
		const logService = this.logService;
		this.floatingWidget = new TagFloatingMenuWidget(editor, tagService, {
			onApplyTag: async (tagId: string) => {
				const selection = editor.getSelection();
				if (!selection || selection.isEmpty() || !editor.hasModel()) { return; }
				const model = editor.getModel();
				if (model.uri.scheme !== 'file') { return; }
				const fullText = model.getValue();
				const startOffset = model.getOffsetAt(selection.getStartPosition());
				const endOffset = model.getOffsetAt(selection.getEndPosition());
				const anchor = captureAnchor(fullText, startOffset, endOffset);
				try {
					await tagService.applyTag(tagId, model.uri.fsPath, anchor);
					logService.info('[Leapfrog] Tag applied via floating picker');
				} catch (err) {
					logService.error('[Leapfrog] Failed to apply tag via floating picker', err);
				}
			},
			onCreateAndApplyTag: async (name: string, color: string) => {
				try {
					const newTag = await tagService.createTag(name, color);
					const selection = editor.getSelection();
					if (!selection || selection.isEmpty() || !editor.hasModel()) { return; }
					const model = editor.getModel();
					if (model.uri.scheme !== 'file') { return; }
					const fullText = model.getValue();
					const startOffset = model.getOffsetAt(selection.getStartPosition());
					const endOffset = model.getOffsetAt(selection.getEndPosition());
					const anchor = captureAnchor(fullText, startOffset, endOffset);
					await tagService.applyTag(newTag.id, model.uri.fsPath, anchor);
					logService.info('[Leapfrog] Created tag and applied via floating picker');
				} catch (err) {
					logService.error('[Leapfrog] Failed to create/apply tag via floating picker', err);
				}
			},
		});
		editor.addContentWidget(this.floatingWidget);

		// Listen for selection changes to show/hide floating tag button
		this.editorListeners.add(editor.onDidChangeCursorSelection(() => {
			if (!this.floatingWidget) { return; }

			const selection = editor.getSelection();
			if (selection && !selection.isEmpty()) {
				// Close the dropdown if the selection changed while it was open
				if (this.floatingWidget.opened) {
					this.floatingWidget.closeDropdown();
				}
				this.floatingWidget.show(
					selection.getStartPosition().lineNumber,
					selection.getStartPosition().column,
				);
			} else {
				this.floatingWidget.hide();
			}
		}));
	}

	private async updateDecorations(): Promise<void> {
		const editor = this.editorService.activeTextEditorControl as ICodeEditor | undefined;
		if (!editor || !editor.hasModel()) {
			this.clearDecorations(editor);
			return;
		}

		const model = editor.getModel();
		const resource = model.uri;

		if (resource.scheme !== 'file') {
			this.clearDecorations(editor);
			return;
		}

		const filePath = resource.fsPath;

		try {
			const applications = await this.tagService.getApplicationsForFile(filePath);
			this.applyDecorations(editor, applications);
		} catch (err) {
			this.logService.error('[Leapfrog] Error loading tag applications for decorations', err);
			this.clearDecorations(editor);
		}
	}

	private applyDecorations(editor: ICodeEditor, applications: ILeapfrogTagApplicationWithTag[]): void {
		const model = editor.getModel();
		if (!model) {
			return;
		}

		const newDecorations: IModelDeltaDecoration[] = [];

		// Track which lines have which tags (for EOL indicators)
		const lineTagMap = new Map<number, { tagName: string; tagColor: string; tagDescription?: string }[]>();

		for (const app of applications) {
			try {
				const startPos = model.getPositionAt(app.startOffset);
				const endPos = model.getPositionAt(app.endOffset);
				const color = app.tagColor || '#22c55e';

				// Per-tag-color highlight decoration
				newDecorations.push({
					range: {
						startLineNumber: startPos.lineNumber,
						startColumn: startPos.column,
						endLineNumber: endPos.lineNumber,
						endColumn: endPos.column,
					},
					options: getDecorationOptions(color, this.styleManager),
				});

				// Collect tags for the end line (show indicator on last line of tagged range)
				const endLine = endPos.lineNumber;
				if (!lineTagMap.has(endLine)) {
					lineTagMap.set(endLine, []);
				}
				const existing = lineTagMap.get(endLine)!;
				// Avoid duplicating the same tag on the same line
				if (!existing.some(t => t.tagName === app.tagName && t.tagColor === color)) {
					existing.push({ tagName: app.tagName, tagColor: color, tagDescription: app.tagDescription });
				}
			} catch {
				// Offset may be invalid if file changed - skip
			}
		}

		// Add EOL indicator decorations
		for (const [lineNumber, tags] of lineTagMap) {
			const lineLength = model.getLineMaxColumn(lineNumber);

			// Build hover message
			const hoverParts = tags.map(t => {
				const md = new MarkdownString();
				md.appendMarkdown(`**${t.tagName}**`);
				if (t.tagDescription) {
					md.appendMarkdown(`\n\n${t.tagDescription}`);
				}
				return md;
			});

			// Create EOL decoration with colored dot for each unique tag
			for (const tag of tags) {
				const eolClass = this.styleManager.eolClassName(tag.tagColor);

				const eolOptions = ModelDecorationOptions.register({
					description: 'leapfrog-tag-eol-indicator',
					stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
					after: {
						content: '\u00A0',
						inlineClassName: eolClass,
						inlineClassNameAffectsLetterSpacing: true,
					},
					hoverMessage: hoverParts,
				});

				newDecorations.push({
					range: {
						startLineNumber: lineNumber,
						startColumn: lineLength,
						endLineNumber: lineNumber,
						endColumn: lineLength,
					},
					options: eolOptions,
				});
			}
		}

		editor.changeDecorations((accessor) => {
			this.decorationIds = accessor.deltaDecorations(this.decorationIds, newDecorations);
		});
	}

	private clearDecorations(editor: ICodeEditor | undefined): void {
		if (editor && this.decorationIds.length > 0) {
			editor.changeDecorations((accessor) => {
				this.decorationIds = accessor.deltaDecorations(this.decorationIds, []);
			});
		}
		this.decorationIds = [];
	}

	override dispose(): void {
		this.styleManager.dispose();
		if (this.floatingWidget) {
			const editor = this.editorService.activeTextEditorControl as ICodeEditor | undefined;
			if (editor) {
				editor.removeContentWidget(this.floatingWidget);
			}
		}
		super.dispose();
	}
}

registerWorkbenchContribution2(
	LeapfrogTagDecorationController.ID,
	LeapfrogTagDecorationController,
	WorkbenchPhase.AfterRestored,
);
