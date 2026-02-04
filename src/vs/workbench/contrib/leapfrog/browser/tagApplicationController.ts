/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Editor integration for Leapfrog tags:
 *
 *  - "Apply Tag" command & editor context menu action
 *  - Text decorations that highlight tagged ranges in the active editor
 *  - Gutter indicators for tagged lines
 *  - Captures W3C-style prefix/suffix when applying tags
 */

import * as nls from '../../../../nls.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import { IModelDeltaDecoration, OverviewRulerLane, MinimapPosition, TrackedRangeStickiness } from '../../../../editor/common/model.js';
import { ModelDecorationOptions } from '../../../../editor/common/model/textModel.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { MenuId, Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { KeyMod, KeyCode, KeyChord } from '../../../../base/common/keyCodes.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ITextAnchor, ILeapfrogTagService, ILeapfrogTagWithCount, ILeapfrogTagApplication } from '../common/leapfrog.js';
import { themeColorFromId } from '../../../../platform/theme/common/themeService.js';
import { registerColor } from '../../../../platform/theme/common/colorUtils.js';
import { Color, RGBA } from '../../../../base/common/color.js';

// ---------------------------------------------------------------------------
// Theme colours for tag decorations
// ---------------------------------------------------------------------------

const leapfrogTagHighlight = registerColor(
	'leapfrog.tagHighlightBackground',
	{ dark: new Color(new RGBA(34, 197, 94, 0.15)), light: new Color(new RGBA(34, 197, 94, 0.12)), hcDark: Color.transparent, hcLight: Color.transparent },
	nls.localize('leapfrogTagHighlight', "Background color for tagged text ranges in the editor.")
);

const leapfrogTagOverviewRuler = registerColor(
	'leapfrog.tagOverviewRulerForeground',
	{ dark: new Color(new RGBA(34, 197, 94, 0.6)), light: new Color(new RGBA(34, 197, 94, 0.5)), hcDark: new Color(new RGBA(34, 197, 94, 0.6)), hcLight: new Color(new RGBA(34, 197, 94, 0.5)) },
	nls.localize('leapfrogTagOverviewRuler', "Overview ruler marker color for tagged text.")
);

// ---------------------------------------------------------------------------
// Decoration options
// ---------------------------------------------------------------------------

const TAG_DECORATION_OPTIONS = ModelDecorationOptions.register({
	description: 'leapfrog-tag-highlight',
	stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
	className: 'leapfrog-tag-decoration',
	overviewRuler: {
		color: themeColorFromId(leapfrogTagOverviewRuler),
		position: OverviewRulerLane.Center,
	},
	minimap: {
		color: themeColorFromId(leapfrogTagHighlight),
		position: MinimapPosition.Inline,
	},
});

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
			const name = await quickInputService.input({
				placeHolder: nls.localize('newTagName', "Tag name"),
				prompt: nls.localize('noTagsCreate', "No tags exist yet. Enter a name to create one."),
			});
			if (!name) { return; }
			const newTag = await tagService.createTag(name.trim(), '#22c55e');
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

		const items: (IQuickPickItem & { tagId: string })[] = flatTags.map(({ tag, depth }) => ({
			label: `${'  '.repeat(depth)}$(circle-filled) ${tag.name}`,
			description: `${tag.applicationCount} uses`,
			tagId: tag.id,
		}));

		const picked = await quickInputService.pick(items, {
			placeHolder: nls.localize('pickTag', "Select a tag to apply"),
		});

		if (!picked) { return; }

		await this.applyToSelection(tagService, logService, editor, filePath, (picked as typeof items[number]).tagId);
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
// Editor decoration controller (workbench contribution)
// ---------------------------------------------------------------------------

class LeapfrogTagDecorationController extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.leapfrogTagDecorations';

	private readonly editorDisposables = this._register(new DisposableStore());
	private decorationIds: string[] = [];
	private currentFilePath: string | undefined;

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@ILeapfrogTagService private readonly tagService: ILeapfrogTagService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		// Refresh decorations when the active editor changes
		this._register(this.editorService.onDidActiveEditorChange(() => this.updateDecorations()));

		// Refresh decorations when tag applications change
		this._register(this.tagService.onDidChangeTagApplications(() => this.updateDecorations()));

		// Initial update
		this.updateDecorations();
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
		this.currentFilePath = filePath;

		try {
			const applications = await this.tagService.getApplicationsForFile(filePath);
			this.applyDecorations(editor, applications);
		} catch (err) {
			this.logService.error('[Leapfrog] Error loading tag applications for decorations', err);
			this.clearDecorations(editor);
		}
	}

	private applyDecorations(editor: ICodeEditor, applications: ILeapfrogTagApplication[]): void {
		const model = editor.getModel();
		if (!model) {
			return;
		}

		const newDecorations: IModelDeltaDecoration[] = [];

		for (const app of applications) {
			try {
				const startPos = model.getPositionAt(app.startOffset);
				const endPos = model.getPositionAt(app.endOffset);

				newDecorations.push({
					range: {
						startLineNumber: startPos.lineNumber,
						startColumn: startPos.column,
						endLineNumber: endPos.lineNumber,
						endColumn: endPos.column,
					},
					options: TAG_DECORATION_OPTIONS,
				});
			} catch {
				// Offset may be invalid if file changed - skip
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
		this.currentFilePath = undefined;
	}
}

registerWorkbenchContribution2(
	LeapfrogTagDecorationController.ID,
	LeapfrogTagDecorationController,
	WorkbenchPhase.AfterRestored,
);
