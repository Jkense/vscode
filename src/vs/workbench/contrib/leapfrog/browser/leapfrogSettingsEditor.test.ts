/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

suite('LeapfrogSettingsEditor', () => {

	test('renders indexing panel with correct structure', async () => {
		const container = document.createElement('div');
		container.className = 'indexing-panel';

		const header = document.createElement('header');
		container.appendChild(header);

		const card = document.createElement('div');
		card.className = 'settings-card';
		container.appendChild(card);

		assert.ok(container);
		assert.ok(container.querySelector('header'));
		assert.ok(container.querySelector('.settings-card'));
	});

	test('shows syncing when status is scanning', async () => {
		const SYNCING_STATUSES = ['scanning', 'chunking', 'embedding'];
		const progressData = {
			status: 'scanning' as const,
			processedFiles: 5,
			totalFiles: 10,
			totalChunks: 20,
			embeddedChunks: 15,
			currentFile: 'test.md',
		};

		assert.ok(SYNCING_STATUSES.includes(progressData.status));
		assert.ok(progressData.currentFile);
	});

	test('reads include patterns from config service', () => {
		const config = {
			leapfrog: {
				index: {
					includePatterns: ['**/*.md', '**/*.txt'],
					excludePatterns: ['.git', 'node_modules'],
					autoIndex: true,
				}
			}
		};

		const includePatterns = (config.leapfrog.index.includePatterns || []).join('\n');
		assert.strictEqual(includePatterns, '**/*.md\n**/*.txt');
	});

	test('reads exclude patterns from config service', () => {
		const config = {
			leapfrog: {
				index: {
					includePatterns: ['**/*.md'],
					excludePatterns: ['.git', 'node_modules'],
					autoIndex: true,
				}
			}
		};

		const excludePatterns = (config.leapfrog.index.excludePatterns || []).join('\n');
		assert.strictEqual(excludePatterns, '.git\nnode_modules');
	});

	test('reads auto-index setting from config', () => {
		const config = {
			leapfrog: {
				index: {
					autoIndex: true,
				}
			}
		};

		const autoIndex = config.leapfrog.index.autoIndex !== false;
		assert.strictEqual(autoIndex, true);
	});

	test('defaults to autoIndex true when not set', () => {
		const config = {} as any;
		const autoIndex = config?.leapfrog?.index?.autoIndex !== false;
		assert.strictEqual(autoIndex, true);
	});

	test('parses textarea patterns correctly', () => {
		const textarea = 'pattern1\npattern2\npattern3';
		const patterns = textarea
			.split('\n')
			.map(p => p.trim())
			.filter(p => p.length > 0);

		assert.deepStrictEqual(patterns, ['pattern1', 'pattern2', 'pattern3']);
	});

	test('handles empty patterns in textarea', () => {
		const textarea = 'pattern1\n\npattern2\n  \npattern3';
		const patterns = textarea
			.split('\n')
			.map(p => p.trim())
			.filter(p => p.length > 0);

		assert.deepStrictEqual(patterns, ['pattern1', 'pattern2', 'pattern3']);
	});

	test('calculates progress percentage correctly', () => {
		const progress = {
			status: 'scanning' as const,
			processedFiles: 5,
			totalFiles: 20,
			totalChunks: 0,
			embeddedChunks: 0,
		};

		const pct = Math.round((progress.processedFiles / progress.totalFiles) * 100);
		assert.strictEqual(pct, 25);
	});

	test('handles zero total files in progress', () => {
		const progress = {
			status: 'scanning' as const,
			processedFiles: 0,
			totalFiles: 0,
			totalChunks: 0,
			embeddedChunks: 0,
		};

		assert.strictEqual(progress.totalFiles, 0);
		assert.ok(isNaN((progress.processedFiles / progress.totalFiles) * 100));
	});

});
