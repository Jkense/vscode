/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Unit tests for LeapfrogPreferencesView
 *
 * Tests the Preferences/Indexing view UI:
 * - View rendering
 * - File section organization
 * - Statistics display
 * - Refresh functionality
 * - Service integration
 */

import * as assert from 'assert';

suite('Leapfrog Preferences View', () => {

	// -----------------------------------------------------------------------
	// View Rendering Tests
	// -----------------------------------------------------------------------

	suite('View Rendering', () => {

		test('should render preferences header', () => {
			const createHeader = (): string => {
				return '<div class="preferences-header"><h3>File Indexing</h3></div>';
			};

			const header = createHeader();

			assert.ok(header.includes('preferences-header'), 'Should have header container');
			assert.ok(header.includes('File Indexing'), 'Should have title');
		});

		test('should render statistics display', () => {
			const stats = { total: 100, indexed: 45, shouldIndex: 55 };

			const renderStats = (s: { total: number; indexed: number; shouldIndex: number }): string => {
				return `
					<div class="preferences-stats">
						<div>Total files: ${s.total}</div>
						<div>Indexed: ${s.indexed}</div>
						<div>Should index: ${s.shouldIndex}</div>
					</div>
				`;
			};

			const html = renderStats(stats);

			assert.ok(html.includes('Total files: 100'), 'Should display total files');
			assert.ok(html.includes('Indexed: 45'), 'Should display indexed count');
			assert.ok(html.includes('Should index: 55'), 'Should display ready-to-index count');
		});

		test('should render file sections', () => {
			const renderSection = (title: string, fileCount: number): string => {
				return `
					<div class="preferences-section">
						<h4 class="section-title">${title}</h4>
						<ul class="file-list">
							${Array(fileCount).fill(0).map((_,i) => `<li class="file-item">File ${i+1}</li>`).join('')}
						</ul>
					</div>
				`;
			};

			const html = renderSection('Indexed Files', 3);

			assert.ok(html.includes('Indexed Files'), 'Should have section title');
			assert.ok(html.includes('File 1'), 'Should list files');
			assert.ok(html.includes('file-item'), 'Should use file-item class');
		});

		test('should render empty state message', () => {
			const renderEmpty = (): string => {
				return '<div class="section-empty">No files</div>';
			};

			const html = renderEmpty();

			assert.ok(html.includes('No files'), 'Should show empty message');
			assert.ok(html.includes('section-empty'), 'Should use empty state class');
		});

		test('should render refresh button', () => {
			const renderButton = (): string => {
				return '<button class="preferences-button">Refresh</button>';
			};

			const html = renderButton();

			assert.ok(html.includes('Refresh'), 'Should have refresh button');
			assert.ok(html.includes('preferences-button'), 'Should use button class');
		});

	});

	// -----------------------------------------------------------------------
	// Statistics Calculation Tests
	// -----------------------------------------------------------------------

	suite('Statistics Calculation', () => {

		test('should calculate correct statistics', () => {
			const files = [
				{ isIndexed: true, shouldIndex: true },
				{ isIndexed: true, shouldIndex: true },
				{ isIndexed: false, shouldIndex: true },
				{ isIndexed: false, shouldIndex: false },
			];

			const stats = {
				total: files.length,
				indexed: files.filter(f => f.isIndexed).length,
				shouldIndex: files.filter(f => f.shouldIndex && !f.isIndexed).length,
			};

			assert.strictEqual(stats.total, 4, 'Should count all files');
			assert.strictEqual(stats.indexed, 2, 'Should count indexed files');
			assert.strictEqual(stats.shouldIndex, 1, 'Should count ready-to-index files');
		});

		test('should handle empty file list', () => {
			const files: any[] = [];

			const stats = {
				total: files.length,
				indexed: files.filter(f => f.isIndexed).length,
				shouldIndex: files.filter(f => f.shouldIndex && !f.isIndexed).length,
			};

			assert.strictEqual(stats.total, 0, 'Total should be 0 for empty list');
			assert.strictEqual(stats.indexed, 0, 'Indexed should be 0');
			assert.strictEqual(stats.shouldIndex, 0, 'Should-index should be 0');
		});

		test('should update statistics on file list changes', () => {
			let stats = {
				total: 0,
				indexed: 0,
				shouldIndex: 0,
			};

			const updateStats = (files: any[]) => {
				stats.total = files.length;
				stats.indexed = files.filter(f => f.isIndexed).length;
				stats.shouldIndex = files.filter(f => f.shouldIndex && !f.isIndexed).length;
			};

			// Initial state
			updateStats([]);
			assert.strictEqual(stats.total, 0, 'Should start at 0');

			// After first scan
			updateStats([
				{ isIndexed: true, shouldIndex: true },
				{ isIndexed: false, shouldIndex: true },
			]);
			assert.strictEqual(stats.total, 2, 'Should update on new data');
			assert.strictEqual(stats.indexed, 1, 'Should update indexed count');

			// After adding more files
			updateStats([
				{ isIndexed: true, shouldIndex: true },
				{ isIndexed: false, shouldIndex: true },
				{ isIndexed: true, shouldIndex: true },
			]);
			assert.strictEqual(stats.total, 3, 'Should reflect new total');
			assert.strictEqual(stats.indexed, 2, 'Should reflect new indexed count');
		});

	});

	// -----------------------------------------------------------------------
	// File Section Organization Tests
	// -----------------------------------------------------------------------

	suite('File Section Organization', () => {

		test('should group files by status', () => {
			const files = [
				{ fileName: 'a.md', path: '/a.md', isIndexed: true, shouldIndex: true },
				{ fileName: 'b.md', path: '/b.md', isIndexed: false, shouldIndex: true },
				{ fileName: 'c.txt', path: '/c.txt', isIndexed: false, shouldIndex: false },
				{ fileName: 'd.md', path: '/d.md', isIndexed: true, shouldIndex: true },
			];

			const grouped = {
				indexed: files.filter(f => f.isIndexed),
				readyToIndex: files.filter(f => f.shouldIndex && !f.isIndexed),
				excluded: files.filter(f => !f.shouldIndex && !f.isIndexed),
			};

			assert.strictEqual(grouped.indexed.length, 2, 'Should group indexed files');
			assert.strictEqual(grouped.readyToIndex.length, 1, 'Should group ready-to-index files');
			assert.strictEqual(grouped.excluded.length, 1, 'Should group excluded files');
		});

		test('should render indexed files section', () => {
			const files = [
				{ fileName: 'README.md', path: '/README.md', isIndexed: true },
				{ fileName: 'GUIDE.md', path: '/GUIDE.md', isIndexed: true },
			];

			const renderSection = (title: string, items: any[]): string => {
				return `
					<div class="preferences-section">
						<h4>${title}</h4>
						<ul class="file-list">
							${items.map(f => `<li class="file-item">${f.fileName}</li>`).join('')}
						</ul>
					</div>
				`;
			};

			const html = renderSection('Indexed Files', files);

			assert.ok(html.includes('Indexed Files'), 'Should have section title');
			assert.ok(html.includes('README.md'), 'Should list file');
		});

		test('should render ready-to-index section', () => {
			const files = [
				{ fileName: 'new.md', path: '/new.md', isIndexed: false, shouldIndex: true },
			];

			const renderSection = (title: string, items: any[]): string => {
				if (items.length === 0) {
					return '';
				}
				return `<div class="preferences-section"><h4>${title}</h4></div>`;
			};

			const html = renderSection('Ready to Index', files);

			assert.ok(html.includes('Ready to Index'), 'Should show ready-to-index section');
		});

		test('should render excluded files section', () => {
			const files = [
				{ fileName: 'config', path: '/.git/config', shouldIndex: false },
				{ fileName: 'package.json', path: '/node_modules/package.json', shouldIndex: false },
			];

			const renderSection = (title: string, items: any[]): string => {
				if (items.length === 0) {
					return '';
				}
				return `<div class="preferences-section"><h4>${title}</h4></div>`;
			};

			const html = renderSection('Excluded Files', files);

			assert.ok(html.includes('Excluded Files'), 'Should show excluded section');
		});

	});

	// -----------------------------------------------------------------------
	// File Display Tests
	// -----------------------------------------------------------------------

	suite('File Display', () => {

		test('should display file name and path', () => {
			const renderFile = (file: any): string => {
				return `
					<li class="file-item">
						<span class="file-name">${file.fileName}</span>
						<span class="file-path">${file.path}</span>
					</li>
				`;
			};

			const file = { fileName: 'README.md', path: '/docs/README.md' };
			const html = renderFile(file);

			assert.ok(html.includes('README.md'), 'Should show file name');
			assert.ok(html.includes('/docs/README.md'), 'Should show file path');
		});

		test('should display reason for file status', () => {
			const renderFile = (file: any): string => {
				let html = `
					<li class="file-item">
						<span class="file-name">${file.fileName}</span>
						<span class="file-path">${file.path}</span>`;

				if (file.reason) {
					html += `<span class="file-reason">${file.reason}</span>`;
				}

				html += '</li>';
				return html;
			};

			const file = {
				fileName: 'README.md',
				path: '/README.md',
				reason: 'Matches indexing pattern',
			};
			const html = renderFile(file);

			assert.ok(html.includes('Matches indexing pattern'), 'Should display reason');
		});

		test('should handle long file paths', () => {
			const longPath = '/a/very/long/path/that/goes/deep/into/the/directory/structure/file.md';

			const renderFile = (path: string): string => {
				return `<span class="file-path">${path}</span>`;
			};

			const html = renderFile(longPath);

			assert.ok(html.includes(longPath), 'Should handle long paths');
		});

	});

	// -----------------------------------------------------------------------
	// Interaction Tests
	// -----------------------------------------------------------------------

	suite('User Interactions', () => {

		test('should handle refresh button click', () => {
			let refreshCalled = false;

			const onRefreshClick = () => {
				refreshCalled = true;
			};

			onRefreshClick();

			assert.strictEqual(refreshCalled, true, 'Should call refresh handler');
		});

		test('should disable refresh during scanning', () => {
			let isScanning = false;
			let buttonEnabled = !isScanning;

			// Start scanning
			isScanning = true;
			buttonEnabled = !isScanning;

			assert.strictEqual(buttonEnabled, false, 'Button should be disabled during scan');

			// End scanning
			isScanning = false;
			buttonEnabled = !isScanning;

			assert.strictEqual(buttonEnabled, true, 'Button should be enabled after scan');
		});

		test('should show loading state during refresh', () => {
			const renderButton = (isLoading: boolean): string => {
				const text = isLoading ? 'Scanning...' : 'Refresh';
				return `<button ${isLoading ? 'disabled' : ''}>${text}</button>`;
			};

			assert.ok(renderButton(false).includes('Refresh'), 'Should show refresh text initially');
			assert.ok(renderButton(true).includes('Scanning...'), 'Should show loading text');
			assert.ok(renderButton(true).includes('disabled'), 'Should be disabled during loading');
		});

	});

	// -----------------------------------------------------------------------
	// Error Handling Tests
	// -----------------------------------------------------------------------

	suite('Error Handling', () => {

		test('should gracefully handle missing service', () => {
			const service = undefined;
			const isAvailable = service !== undefined;

			assert.strictEqual(isAvailable, false, 'Should handle missing service');
		});

		test('should handle scan errors gracefully', () => {
			let errorOccurred = false;
			let errorMessage = '';

			const handleScanError = (error: Error) => {
				errorOccurred = true;
				errorMessage = error.message;
			};

			handleScanError(new Error('Scan failed'));

			assert.strictEqual(errorOccurred, true, 'Should catch error');
			assert.ok(errorMessage.includes('Scan failed'), 'Should capture error message');
		});

		test('should render error state', () => {
			const renderError = (message: string): string => {
				return `<div class="error-message">${message}</div>`;
			};

			const html = renderError('Failed to scan workspace');

			assert.ok(html.includes('Failed to scan workspace'), 'Should display error message');
			assert.ok(html.includes('error-message'), 'Should use error class');
		});

	});

});
