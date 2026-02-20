/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from "../../../../../nls.js";
import { IViewletViewOptions } from "../../../../browser/parts/views/viewsViewlet.js";
import { IInstantiationService } from "../../../../../platform/instantiation/common/instantiation.js";
import { IThemeService } from "../../../../../platform/theme/common/themeService.js";
import { IKeybindingService } from "../../../../../platform/keybinding/common/keybinding.js";
import { IContextMenuService } from "../../../../../platform/contextview/browser/contextView.js";
import { IConfigurationService } from "../../../../../platform/configuration/common/configuration.js";
import {
	ViewPane,
	IViewPaneOptions,
} from "../../../../browser/parts/views/viewPane.js";
import { IContextKeyService } from "../../../../../platform/contextkey/common/contextkey.js";
import { IViewDescriptorService } from "../../../../common/views.js";
import { IOpenerService } from "../../../../../platform/opener/common/opener.js";
import { ILocalizedString } from "../../../../../platform/action/common/action.js";
import { IHoverService } from "../../../../../platform/hover/browser/hover.js";
import { IQuickInputService } from "../../../../../platform/quickinput/common/quickInput.js";
import { URI } from "../../../../../base/common/uri.js";
import {
	$,
	append,
	addDisposableListener,
} from "../../../../../base/browser/dom.js";
import { IEditorService } from "../../../../services/editor/common/editorService.js";
import { ICodeEditor } from "../../../../../editor/browser/editorBrowser.js";
import { DisposableStore } from "../../../../../base/common/lifecycle.js";
import {
	IAsyncDataSource,
	ITreeNode,
	ITreeRenderer,
	ITreeFilter,
	TreeVisibility,
} from "../../../../../base/browser/ui/tree/tree.js";
import {
	IListVirtualDelegate,
	IIdentityProvider,
} from "../../../../../base/browser/ui/list/list.js";
import { IListAccessibilityProvider } from "../../../../../base/browser/ui/list/listWidget.js";
import { WorkbenchAsyncDataTree } from "../../../../../platform/list/browser/listService.js";
import {
	FuzzyScore,
	fuzzyScore,
	FuzzyScoreOptions,
} from "../../../../../base/common/filters.js";
import {
	LEAPFROG_TAGS_VIEW_ID,
	ILeapfrogTagService,
	ILeapfrogTagWithCount,
	ILeapfrogTagFileGroup,
	ILeapfrogTagApplication,
} from "../../common/leapfrog.js";
import { LeapfrogConfigurationKeys } from "../../common/leapfrogConfiguration.js";

// ---------------------------------------------------------------------------
// Tree element types
// ---------------------------------------------------------------------------

interface TagElement {
	readonly type: "tag";
	readonly tag: ILeapfrogTagWithCount;
}

interface FileGroupElement {
	readonly type: "file";
	readonly tagId: string;
	readonly group: ILeapfrogTagFileGroup;
}

interface SnippetElement {
	readonly type: "snippet";
	readonly application: ILeapfrogTagApplication;
	readonly tagColor: string;
}

type TagTreeElement = TagElement | FileGroupElement | SnippetElement;

// Sentinel input for the root of the tree
const TAG_TREE_INPUT = Symbol("TagTreeInput");
type TagTreeInput = typeof TAG_TREE_INPUT;

// ---------------------------------------------------------------------------
// Virtual delegate
// ---------------------------------------------------------------------------

class TagTreeVirtualDelegate implements IListVirtualDelegate<TagTreeElement> {
	getHeight(element: TagTreeElement): number {
		switch (element.type) {
			case "tag":
				return 28;
			case "file":
				return 24;
			case "snippet":
				return 22;
		}
	}

	getTemplateId(element: TagTreeElement): string {
		return element.type;
	}
}

// ---------------------------------------------------------------------------
// Identity provider
// ---------------------------------------------------------------------------

class TagTreeIdentityProvider implements IIdentityProvider<TagTreeElement> {
	getId(element: TagTreeElement): string {
		switch (element.type) {
			case "tag":
				return `tag:${element.tag.id}`;
			case "file":
				return `file:${element.tagId}:${element.group.filePath}`;
			case "snippet":
				return `snippet:${element.application.id}`;
		}
	}
}

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

class TagTreeAccessibilityProvider implements IListAccessibilityProvider<TagTreeElement> {
	getWidgetAriaLabel(): string {
		return nls.localize("leapfrogTagsTree", "Tags");
	}

	getAriaLabel(element: TagTreeElement): string {
		switch (element.type) {
			case "tag":
				return `${element.tag.name} (${element.tag.applicationCount})`;
			case "file":
				return element.group.fileName;
			case "snippet":
				return element.application.selectedText;
		}
	}
}

// ---------------------------------------------------------------------------
// Data source
// ---------------------------------------------------------------------------

class TagTreeDataSource implements IAsyncDataSource<
	TagTreeInput,
	TagTreeElement
> {
	constructor(private readonly tagService: ILeapfrogTagService) {}

	hasChildren(element: TagTreeInput | TagTreeElement): boolean {
		if (element === TAG_TREE_INPUT) {
			return true;
		}
		switch (element.type) {
			case "tag":
				return (
					element.tag.applicationCount > 0 || element.tag.children.length > 0
				);
			case "file":
				return element.group.applications.length > 0;
			case "snippet":
				return false;
		}
	}

	async getChildren(
		element: TagTreeInput | TagTreeElement,
	): Promise<TagTreeElement[]> {
		if (element === TAG_TREE_INPUT) {
			const tags = await this.tagService.getTags();
			return tags.map((tag) => ({ type: "tag" as const, tag }));
		}

		switch (element.type) {
			case "tag": {
				const children: TagTreeElement[] = [];

				// Child tags first
				for (const child of element.tag.children) {
					children.push({ type: "tag" as const, tag: child });
				}

				// Then file groups
				if (element.tag.applicationCount > 0) {
					const groups = await this.tagService.getApplicationsForTag(
						element.tag.id,
					);
					for (const group of groups) {
						children.push({
							type: "file" as const,
							tagId: element.tag.id,
							group,
						});
					}
				}
				return children;
			}
			case "file": {
				return element.group.applications.map((app) => ({
					type: "snippet" as const,
					application: app,
					tagColor: "", // Color comes from parent
				}));
			}
			case "snippet":
				return [];
		}
	}
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

// -- Tag renderer -----------------------------------------------------------

interface TagTemplate {
	readonly container: HTMLElement;
	readonly colorDot: HTMLElement;
	readonly name: HTMLElement;
	readonly count: HTMLElement;
	readonly actions: HTMLElement;
	readonly colorButton: HTMLElement;
	readonly editButton: HTMLElement;
	readonly deleteButton: HTMLElement;
	readonly disposables: DisposableStore;
}

class TagRenderer implements ITreeRenderer<
	TagElement,
	FuzzyScore,
	TagTemplate
> {
	static readonly TEMPLATE_ID = "tag";
	readonly templateId = TagRenderer.TEMPLATE_ID;

	constructor(
		private readonly onEdit: (tag: ILeapfrogTagWithCount) => void,
		private readonly onColorChange: (tag: ILeapfrogTagWithCount) => void,
		private readonly onDelete: (tag: ILeapfrogTagWithCount) => void,
	) {}

	renderTemplate(container: HTMLElement): TagTemplate {
		const el = append(container, $(".leapfrog-tag-item"));
		const colorDot = append(el, $(".leapfrog-tag-color"));
		const name = append(el, $(".leapfrog-tag-name"));
		const count = append(el, $(".leapfrog-tag-count"));
		const actions = append(el, $(".leapfrog-tag-actions"));

		const colorButton = append(actions, $("button.leapfrog-tag-action-btn"));
		colorButton.title = nls.localize("changeColor", "Change color");
		colorButton.classList.add("codicon", "codicon-paintcan");

		const editButton = append(actions, $("button.leapfrog-tag-action-btn"));
		editButton.title = nls.localize("editTag", "Edit Tag");
		editButton.classList.add("codicon", "codicon-edit");

		const deleteButton = append(actions, $("button.leapfrog-tag-action-btn"));
		deleteButton.title = nls.localize("deleteTag", "Delete Tag");
		deleteButton.classList.add("codicon", "codicon-trash");

		return {
			container: el,
			colorDot,
			name,
			count,
			actions,
			colorButton,
			editButton,
			deleteButton,
			disposables: new DisposableStore(),
		};
	}

	renderElement(
		node: ITreeNode<TagElement, FuzzyScore>,
		_index: number,
		template: TagTemplate,
	): void {
		const { tag } = node.element;

		template.colorDot.style.backgroundColor = tag.color;
		template.name.textContent = tag.name;
		template.count.textContent = String(tag.applicationCount);
		template.count.style.display = tag.applicationCount > 0 ? "" : "none";

		template.disposables.clear();

		template.colorButton.onclick = (e) => {
			e.stopPropagation();
			this.onColorChange(tag);
		};

		template.editButton.onclick = (e) => {
			e.stopPropagation();
			this.onEdit(tag);
		};

		template.deleteButton.onclick = (e) => {
			e.stopPropagation();
			this.onDelete(tag);
		};
	}

	disposeTemplate(template: TagTemplate): void {
		template.disposables.dispose();
	}
}

// -- File group renderer ----------------------------------------------------

interface FileGroupTemplate {
	readonly container: HTMLElement;
	readonly icon: HTMLElement;
	readonly name: HTMLElement;
}

class FileGroupRenderer implements ITreeRenderer<
	FileGroupElement,
	FuzzyScore,
	FileGroupTemplate
> {
	static readonly TEMPLATE_ID = "file";
	readonly templateId = FileGroupRenderer.TEMPLATE_ID;

	renderTemplate(container: HTMLElement): FileGroupTemplate {
		const el = append(container, $(".leapfrog-file-group"));
		const icon = append(el, $("span.codicon.codicon-file"));
		const name = append(el, $(".leapfrog-file-name"));
		return { container: el, icon, name };
	}

	renderElement(
		node: ITreeNode<FileGroupElement, FuzzyScore>,
		_index: number,
		template: FileGroupTemplate,
	): void {
		template.name.textContent = node.element.group.fileName;
		template.name.title = node.element.group.filePath;
	}

	disposeTemplate(_template: FileGroupTemplate): void {}
}

// -- Snippet renderer -------------------------------------------------------

interface SnippetTemplate {
	readonly container: HTMLElement;
	readonly quote: HTMLElement;
	readonly removeButton: HTMLElement;
	readonly disposables: DisposableStore;
}

class SnippetRenderer implements ITreeRenderer<
	SnippetElement,
	FuzzyScore,
	SnippetTemplate
> {
	static readonly TEMPLATE_ID = "snippet";
	readonly templateId = SnippetRenderer.TEMPLATE_ID;

	constructor(
		private readonly onRemove: (application: ILeapfrogTagApplication) => void,
	) {}

	renderTemplate(container: HTMLElement): SnippetTemplate {
		const el = append(container, $(".leapfrog-snippet"));
		const quote = append(el, $(".leapfrog-snippet-text"));
		const actions = append(el, $(".leapfrog-snippet-actions"));
		const removeButton = append(
			actions,
			$("button.leapfrog-snippet-action-btn.codicon.codicon-close"),
		);
		removeButton.title = nls.localize(
			"removeTag",
			"Remove tag from this selection",
		);
		return {
			container: el,
			quote,
			removeButton,
			disposables: new DisposableStore(),
		};
	}

	renderElement(
		node: ITreeNode<SnippetElement, FuzzyScore>,
		_index: number,
		template: SnippetTemplate,
	): void {
		const text = node.element.application.selectedText;
		// Truncate long snippets
		const maxLen = 80;
		const display =
			text.length > maxLen ? text.substring(0, maxLen) + "..." : text;
		template.quote.textContent = `"${display}"`;
		template.quote.title = text;

		template.disposables.clear();
		template.disposables.add(
			addDisposableListener(template.removeButton, "click", (e) => {
				e.stopPropagation();
				this.onRemove(node.element.application);
			}),
		);
	}

	disposeTemplate(template: SnippetTemplate): void {
		template.disposables.dispose();
	}
}

// ---------------------------------------------------------------------------
// Tag tree filter (fuzzy search)
// ---------------------------------------------------------------------------

function getSearchableText(element: TagTreeElement): string {
	switch (element.type) {
		case "tag":
			return element.tag.name;
		case "file":
			return element.group.fileName;
		case "snippet":
			return element.application.selectedText;
	}
}

function matchesFuzzy(query: string, text: string): FuzzyScore | undefined {
	if (!query.trim()) {
		return undefined;
	}
	const pattern = query.trim();
	const patternLow = pattern.toLowerCase();
	const word = text;
	const wordLow = word.toLowerCase();
	return fuzzyScore(pattern, patternLow, 0, word, wordLow, 0, {
		firstMatchCanBeWeak: true,
		boostFullMatch: true,
	} as FuzzyScoreOptions);
}

class TagTreeFilter implements ITreeFilter<
	TagTreeInput | TagTreeElement,
	FuzzyScore
> {
	query = "";

	filter(
		element: TagTreeInput | TagTreeElement,
		parentVisibility: TreeVisibility,
	): import("../../../../../base/browser/ui/tree/tree.js").TreeFilterResult<FuzzyScore> {
		if (element === TAG_TREE_INPUT) {
			return TreeVisibility.Recurse;
		}

		const q = this.query.trim();
		if (!q) {
			return TreeVisibility.Visible;
		}

		const text = getSearchableText(element);
		const score = matchesFuzzy(q, text);
		if (score) {
			return { visibility: TreeVisibility.Visible, data: score };
		}

		// No match: for leaves (snippet) hide; for parents (tag, file) recurse so children can match
		return element.type === "snippet"
			? TreeVisibility.Hidden
			: TreeVisibility.Recurse;
	}
}

// ---------------------------------------------------------------------------
// Tags View
// ---------------------------------------------------------------------------

export class LeapfrogTagsView extends ViewPane {
	static readonly ID: string = LEAPFROG_TAGS_VIEW_ID;
	static readonly NAME: ILocalizedString = nls.localize2(
		"leapfrogTags",
		"Tags",
	);

	private tree:
		| WorkbenchAsyncDataTree<TagTreeInput, TagTreeElement, FuzzyScore>
		| undefined;
	private treeContainer: HTMLElement | undefined;
	private searchInput: HTMLInputElement | undefined;
	private readonly treeFilter = new TagTreeFilter();

	constructor(
		options: IViewletViewOptions,
		@IThemeService themeService: IThemeService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService
		private readonly _configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IOpenerService openerService: IOpenerService,
		@IHoverService hoverService: IHoverService,
		@ILeapfrogTagService private readonly tagService: ILeapfrogTagService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super(
			options as IViewPaneOptions,
			keybindingService,
			contextMenuService,
			_configurationService,
			contextKeyService,
			viewDescriptorService,
			instantiationService,
			openerService,
			themeService,
			hoverService,
		);

		// Re-render tree when tags or applications change
		this._register(this.tagService.onDidChangeTags(() => this.refresh()));
		this._register(
			this.tagService.onDidChangeTagApplications(() => this.refresh()),
		);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		container.classList.add("leapfrog-tags-view");

		// Toolbar
		const toolbar = append(container, $(".leapfrog-tags-toolbar"));

		// Add tag button
		const addTagButton = append(toolbar, $("button.leapfrog-tags-add-btn"));
		addTagButton.title = nls.localize("addTag", "Add Tag");
		addTagButton.classList.add("codicon", "codicon-add");
		addTagButton.onclick = () => this.addTag();

		// Search input
		const searchContainer = append(toolbar, $(".leapfrog-tags-search"));
		this.searchInput = append(searchContainer, $("input")) as HTMLInputElement;
		this.searchInput.type = "text";
		this.searchInput.placeholder = nls.localize("searchTags", "Search");
		this.searchInput.oninput = () => this.onSearchChanged();

		// Tree container
		this.treeContainer = append(container, $(".leapfrog-tags-tree-container"));

		this.createTree();
	}

	private createTree(): void {
		if (!this.treeContainer) {
			return;
		}

		const dataSource = new TagTreeDataSource(this.tagService);
		const delegate = new TagTreeVirtualDelegate();
		const identityProvider = new TagTreeIdentityProvider();
		const accessibilityProvider = new TagTreeAccessibilityProvider();

		const tagRenderer = new TagRenderer(
			(tag) => this.editTag(tag),
			(tag) => this.changeTagColor(tag),
			(tag) => this.deleteTag(tag),
		);

		const renderers = [
			tagRenderer,
			new FileGroupRenderer(),
			new SnippetRenderer((app) => this.removeTagApplication(app)),
		];

		this.tree = this.instantiationService.createInstance(
			WorkbenchAsyncDataTree,
			"LeapfrogTags",
			this.treeContainer,
			delegate,
			renderers,
			dataSource,
			{
				horizontalScrolling: false,
				identityProvider,
				accessibilityProvider,
				collapseByDefault: () => true,
				filter: this.treeFilter,
			},
		) as WorkbenchAsyncDataTree<TagTreeInput, TagTreeElement, FuzzyScore>;

		this._register(this.tree);

		// Open file & select text when clicking a snippet or file group
		this._register(
			this.tree.onDidChangeSelection((e) => {
				const element = e.elements[0];
				if (element) {
					this.onTreeElementSelected(element);
				}
			}),
		);

		// Set input to load data
		this.tree.setInput(TAG_TREE_INPUT);
	}

	private async refresh(): Promise<void> {
		if (this.tree) {
			await this.tree.updateChildren();
		}
	}

	// -----------------------------------------------------------------------
	// Navigation
	// -----------------------------------------------------------------------

	private async onTreeElementSelected(element: TagTreeElement): Promise<void> {
		if (element.type === "tag") {
			return;
		}

		const filePath =
			element.type === "file"
				? element.group.filePath
				: element.application.fileId;
		const resource = URI.file(filePath);

		const pane = await this.editorService.openEditor({ resource });
		if (!pane) {
			return;
		}

		if (element.type === "snippet") {
			const control = pane.getControl() as ICodeEditor | undefined;
			if (control && typeof control.getModel === "function") {
				const model = control.getModel();
				if (model && typeof model.getPositionAt === "function") {
					const start = model.getPositionAt(element.application.startOffset);
					const end = model.getPositionAt(element.application.endOffset);
					const range = {
						startLineNumber: start.lineNumber,
						startColumn: start.column,
						endLineNumber: end.lineNumber,
						endColumn: end.column,
					};
					control.setSelection(range);
					control.revealRangeInCenter(range);
				}
			}
		}
	}

	// -----------------------------------------------------------------------
	// Actions
	// -----------------------------------------------------------------------

	private async addTag(): Promise<void> {
		// Step 1: Get tag name
		const name = await this.quickInputService.input({
			placeHolder: nls.localize("tagName", "Tag name"),
			prompt: nls.localize("enterTagName", "Enter a name for the new tag"),
			validateInput: async (value) => {
				if (!value || !value.trim()) {
					return nls.localize("tagNameRequired", "Tag name is required");
				}
				return undefined;
			},
		});

		if (!name) {
			return;
		}

		// Step 2: Pick a color
		const defaultColors = this._configurationService.getValue<string[]>(
			LeapfrogConfigurationKeys.TagColors,
		) || [
			"#22c55e",
			"#ef4444",
			"#3b82f6",
			"#f59e0b",
			"#8b5cf6",
			"#ec4899",
			"#06b6d4",
			"#f97316",
			"#14b8a6",
			"#6366f1",
		];

		const colorItems = defaultColors.map((color, i) => {
			const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="${color}"/></svg>`;
			try {
				const encoded = btoa(unescape(encodeURIComponent(svg)));
				const uri = URI.parse(`data:image/svg+xml;base64,${encoded}`);
				return {
					label: `Color ${i + 1}`,
					color,
					description: color,
					iconPath: { dark: uri, light: uri },
				};
			} catch {
				return {
					label: `$(circle-filled) Color ${i + 1}`,
					color,
					description: color,
				};
			}
		});

		const picked = await this.quickInputService.pick(colorItems, {
			placeHolder: nls.localize("pickColor", "Pick a tag color"),
		});

		const color =
			(picked as (typeof colorItems)[number] | undefined)?.color ??
			defaultColors[0];

		await this.tagService.createTag(name.trim(), color);
	}

	private async editTag(tag: ILeapfrogTagWithCount): Promise<void> {
		const newName = await this.quickInputService.input({
			placeHolder: tag.name,
			value: tag.name,
			prompt: nls.localize("editTagName", "Edit tag name"),
			validateInput: async (value) => {
				if (!value || !value.trim()) {
					return nls.localize("tagNameRequired", "Tag name is required");
				}
				return undefined;
			},
		});

		if (newName && newName.trim() !== tag.name) {
			await this.tagService.updateTag(tag.id, { name: newName.trim() });
		}
	}

	private async changeTagColor(tag: ILeapfrogTagWithCount): Promise<void> {
		const defaultColors = this._configurationService.getValue<string[]>(
			LeapfrogConfigurationKeys.TagColors,
		) || [
			"#22c55e",
			"#ef4444",
			"#3b82f6",
			"#f59e0b",
			"#8b5cf6",
			"#ec4899",
			"#06b6d4",
			"#f97316",
			"#14b8a6",
			"#6366f1",
		];

		const colorItems = [
			...defaultColors.map((color, i) => {
				// Create colored circle SVG as base64 data URI
				const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="${color}"/></svg>`;
				try {
					const encoded = btoa(unescape(encodeURIComponent(svg)));
					const uri = URI.parse(`data:image/svg+xml;base64,${encoded}`);
					return {
						label: `Color ${i + 1}`,
						description: color,
						iconPath: { dark: uri, light: uri },
						color,
					};
				} catch {
					// Fallback if encoding fails
					return {
						label: `$(circle-filled) Color ${i + 1}`,
						description: color,
						color,
					};
				}
			}),
			{
				label: "$(edit) Custom color...",
				description: "Enter a hex value",
				color: "__custom__",
			},
		];

		const picked = await this.quickInputService.pick(colorItems as any, {
			placeHolder: nls.localize(
				"pickTagColor",
				"Pick a color for '{0}'",
				tag.name,
			),
		});
		if (!picked) {
			return;
		}

		let finalColor = (picked as (typeof colorItems)[number]).color;

		if (finalColor === "__custom__") {
			const custom = await this.quickInputService.input({
				value: tag.color,
				prompt: nls.localize("customColor", "Enter a hex color (e.g. #ff0000)"),
				validateInput: (v) => {
					if (!/^#[0-9a-fA-F]{6}$/.test(v.trim())) {
						return Promise.resolve(
							nls.localize(
								"invalidColor",
								"Enter a valid 6-digit hex color (e.g. #ff0000)",
							),
						);
					}
					return Promise.resolve(undefined);
				},
			});
			if (!custom?.trim()) {
				return;
			}
			finalColor = custom.trim();
		}

		if (finalColor !== tag.color) {
			await this.tagService.updateTag(tag.id, { color: finalColor });
		}
	}

	private async deleteTag(tag: ILeapfrogTagWithCount): Promise<void> {
		const confirmationMessage =
			tag.applicationCount > 0
				? nls.localize(
						"deleteTagWithApps",
						'Delete tag "{0}"? This will also remove {1} tag application(s).',
						tag.name,
						tag.applicationCount,
					)
				: nls.localize("deleteTagConfirm", 'Delete tag "{0}"?', tag.name);

		const confirmOptions: Array<{ label: string; description: string }> = [
			{
				label: `$(trash) ${nls.localize("delete", "Delete")}`,
				description: confirmationMessage,
			},
			{
				label: nls.localize("cancel", "Cancel"),
				description: "",
			},
		];

		const picked = await this.quickInputService.pick(confirmOptions, {
			placeHolder: nls.localize(
				"confirmDelete",
				"Are you sure you want to delete this tag?",
			),
		});

		if (picked?.label.includes(nls.localize("delete", "Delete"))) {
			await this.tagService.deleteTag(tag.id);
		}
	}

	private async removeTagApplication(
		application: ILeapfrogTagApplication,
	): Promise<void> {
		await this.tagService.removeTagApplication(application.id);
	}

	private onSearchChanged(): void {
		this.treeFilter.query = this.searchInput?.value ?? "";
		this.tree?.refilter();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this.tree) {
			// Account for toolbar height (~36px)
			this.tree.layout(height - 36, width);
		}
	}
}
