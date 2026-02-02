/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { defineFixture } from '@component-explorer/explorer';
import * as monaco from '../../src/vs/editor/editor.main';
import { InlineCompletionsController } from '../../src/vs/editor/contrib/inlineCompletions/browser/controller/inlineCompletionsController';
import { StandaloneServices } from '../../src/vs/editor/standalone/browser/standaloneServices';
import { InstantiationService } from '../../src/vs/platform/instantiation/common/instantiationService';
import { TestInstantiationService } from '../../src/vs/platform/instantiation/test/common/instantiationServiceMock';
import { ServiceCollection } from '../../src/vs/platform/instantiation/common/serviceCollection';
import { StandaloneEditor } from '../../src/vs/editor/standalone/browser/standaloneCodeEditor';
import { InlineCompletionsSource, InlineCompletionsState } from '../../src/vs/editor/contrib/inlineCompletions/browser/model/inlineCompletionsSource';
import { constObservable, observableValue } from '../../src/vs/base/common/observable';
import { InlineEditItem } from '../../src/vs/editor/contrib/inlineCompletions/browser/model/inlineSuggestionItem';
import { TextModelValueReference } from '../../src/vs/editor/contrib/inlineCompletions/browser/model/textModelValueReference';
import { createAiStatsHover, IAiStatsHoverData } from '../../src/vs/workbench/contrib/editTelemetry/browser/editStats/aiStatsStatusBar';
import { ISessionData } from '../../src/vs/workbench/contrib/editTelemetry/browser/editStats/aiStatsChart';
import { DisposableStore } from '../../src/vs/base/common/lifecycle';
import './style.css';

interface InlineEditFixtureOptions {
	code: string;
	cursorLine: number;
	range: monaco.IRange;
	newText: string;
	width?: string;
	height?: string;
	editorOptions?: monaco.editor.IStandaloneEditorConstructionOptions;
}

function createInlineEditFixture(container: HTMLElement, options: InlineEditFixtureOptions): monaco.editor.IStandaloneCodeEditor {
	container.style.width = options.width ?? '500px';
	container.style.height = options.height ?? '170px';

	Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).forEach(sheet => {
		container.appendChild(sheet.cloneNode(true));
	});

	const s = StandaloneServices.initialize({});
	const s2 = new TestInstantiationService(new ServiceCollection(), false, s as InstantiationService);

	const textModel = monaco.editor.createModel(options.code, 'typescript');

	s2.stubInstance(InlineCompletionsSource, {
		cancelUpdate: () => { },
		clear: () => { },
		clearOperationOnTextModelChange: constObservable(undefined),
		clearSuggestWidgetInlineCompletions: () => { },
		dispose: () => { },
		fetch: async () => true,
		inlineCompletions: constObservable(new InlineCompletionsState([
			InlineEditItem.createForTest(
				TextModelValueReference.snapshot(textModel as any),
				new monaco.Range(options.range.startLineNumber, options.range.startColumn, options.range.endLineNumber, options.range.endColumn),
				options.newText
			)
		], undefined)),
		loading: constObservable(false),
		seedInlineCompletionsWithSuggestWidget: () => { },
		seedWithCompletion: () => { },
		suggestWidgetInlineCompletions: constObservable(InlineCompletionsState.createEmpty()),
	});

	const editor = s2.createInstance(StandaloneEditor, container, {
		automaticLayout: true,
		model: textModel,
		language: 'typescript',
		cursorBlinking: 'solid',
		...options.editorOptions,
	});


	editor.setPosition({ lineNumber: options.cursorLine, column: 1 });
	editor.focus();

	const controller = InlineCompletionsController.get(editor);
	const model = controller?.model?.get();

	return editor;
}

export default defineFixture({
	Primary: {
		isolation: 'shadow-dom',
		displayMode: { type: 'component' },
		properties: [
			{ type: 'string', name: 'label', defaultValue: 'Click me' },
			{ type: 'boolean', name: 'disabled', defaultValue: false },
		],
		render: (container, props) => {
			container.style.width = '500px';
			container.style.height = '170px';

			Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).forEach(sheet => {
				container.appendChild(sheet.cloneNode(true));
			});

			return monaco.editor.create(container, {
				automaticLayout: true
			});

		},
	},

	// Side-by-side view: Multi-line replacement
	SideBySideView: {
		isolation: 'shadow-dom',
		displayMode: { type: 'component' },
		properties: [],
		render: (container) => createInlineEditFixture(container, {
			code: `function greet(name) {
    console.log("Hello, " + name);
}`,
			cursorLine: 2,
			range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 100 },
			newText: '    console.log(`Hello, ${name}!`);',
		}),
	},

	// Word replacement view: Single word change
	WordReplacementView: {
		isolation: 'shadow-dom',
		displayMode: { type: 'component' },
		properties: [],
		render: (container) => createInlineEditFixture(container, {
			code: `class BufferData {
	append(data: number[]) {
		this.data.push(data);
	}
}`,
			cursorLine: 2,
			range: { startLineNumber: 2, startColumn: 2, endLineNumber: 2, endColumn: 8 },
			newText: 'push',
			height: '200px',
		}),
	},

	// Insertion view: Insert new content
	InsertionView: {
		isolation: 'shadow-dom',
		displayMode: { type: 'component' },
		properties: [],
		render: (container) => createInlineEditFixture(container, {
			code: `class BufferData {
	append(data: number[]) {} // appends data
}`,
			cursorLine: 2,
			range: { startLineNumber: 2, startColumn: 26, endLineNumber: 2, endColumn: 26 },
			newText: `
		console.log(data);
	`,
			height: '200px',
			editorOptions: {
				inlineSuggest: {
					edits: { allowCodeShifting: 'always' }
				}
			}
		}),
	},

	// AI Usage Statistics Hover
	AiUsageStatisticsHover: {
		isolation: 'shadow-dom',
		displayMode: { type: 'component' },
		properties: [],
		render: (container) => {
			container.style.width = '320px';
			container.style.padding = '8px';
			container.style.backgroundColor = 'var(--vscode-editorHoverWidget-background)';
			container.style.border = '1px solid var(--vscode-editorHoverWidget-border)';
			container.style.borderRadius = '4px';
			container.style.color = 'var(--vscode-editorHoverWidget-foreground)';

			Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).forEach(sheet => {
				container.appendChild(sheet.cloneNode(true));
			});

			// Generate fake session data for the last 7 days
			const now = Date.now();
			const dayMs = 24 * 60 * 60 * 1000;
			const sessionLengthMs = 5 * 60 * 1000;

			const fakeSessions: ISessionData[] = [];
			for (let day = 6; day >= 0; day--) {
				const dayStart = now - day * dayMs;
				const sessionsPerDay = Math.floor(Math.random() * 6) + 3;
				for (let s = 0; s < sessionsPerDay; s++) {
					const sessionTime = dayStart + s * sessionLengthMs * 2;
					fakeSessions.push({
						startTime: sessionTime,
						typedCharacters: Math.floor(Math.random() * 500) + 100,
						aiCharacters: Math.floor(Math.random() * 800) + 200,
						acceptedInlineSuggestions: Math.floor(Math.random() * 15) + 1,
						chatEditCount: Math.floor(Math.random() * 5),
					});
				}
			}

			const totalAi = fakeSessions.reduce((sum, s) => sum + s.aiCharacters, 0);
			const totalTyped = fakeSessions.reduce((sum, s) => sum + s.typedCharacters, 0);
			const aiRate = totalAi / (totalAi + totalTyped);

			const startOfToday = new Date();
			startOfToday.setHours(0, 0, 0, 0);
			const todaySessions = fakeSessions.filter(s => s.startTime > startOfToday.getTime());
			const acceptedToday = todaySessions.reduce((sum, s) => sum + (s.acceptedInlineSuggestions ?? 0), 0);

			const fakeData: IAiStatsHoverData = {
				aiRate: observableValue('aiRate', aiRate),
				acceptedInlineSuggestionsToday: observableValue('acceptedToday', acceptedToday),
				sessions: observableValue('sessions', fakeSessions),
			};

			const hover = createAiStatsHover({
				data: fakeData,
				onOpenSettings: () => console.log('Open settings clicked'),
			});

			const store = new DisposableStore();
			const elem = hover.keepUpdated(store).element;
			container.appendChild(elem);

			return elem;
		},
	},
});
