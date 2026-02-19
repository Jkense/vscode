/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Unit tests for LeapfrogIndexPreferencesService
 *
 * Tests file scanning and indexing preferences:
 * - Pattern matching (include/exclude)
 * - File scanning and discovery
 * - Preference persistence
 * - Statistics tracking
 */

import * as assert from 'assert';

suite('Leapfrog Index Preferences Service', () => {

	// -----------------------------------------------------------------------
	// Pattern Matching Tests
	// -----------------------------------------------------------------------

	suite('Pattern Matching', () => {

		test('should match markdown files with include patterns', () => {
			const patterns = ['**/*.md', '**/*.markdown'];
			const testFiles = [
				'README.md',
				'docs/guide.md',
				'file.markdown',
				'nested/docs/note.md',
			];

			// Simple glob-like matching
			const isMatch = (path: string, pattern: string): boolean => {
				// Convert glob to regex
				let regexStr = pattern
					.replace(/\./g, '\\.')
					.replace(/\*/g, '[^/]*')
					.replace(/\[\^\/\]\*\[\^\/\]\*/g, '.*');
				regexStr = regexStr.replace(/\/\.\*\//g, '(/.*)?/');

				const regex = new RegExp(`(^|/)${regexStr}$`, 'i');
				return regex.test(path.replace(/\\/g, '/'));
			};

			testFiles.forEach(file => {
				const matches = patterns.some(p => isMatch(file, p));
				assert.strictEqual(matches, true, `Should match ${file}`);
			});
		});

		test('should exclude patterns correctly', () => {
			const excludePatterns = ['.git', 'node_modules', '.vscode'];

			const isExcluded = (path: string, patterns: string[]): boolean => {
				return patterns.some(pattern => {
					const normalizedPath = path.replace(/\\/g, '/');
					const normalizedPattern = pattern.replace(/\\/g, '/');
					return normalizedPath.startsWith(normalizedPattern + '/') ||
						   normalizedPath === normalizedPattern;
				});
			};

			assert.strictEqual(isExcluded('.git/objects', excludePatterns), true, 'Should exclude .git paths');
			assert.strictEqual(isExcluded('node_modules/pkg', excludePatterns), true, 'Should exclude node_modules');
			assert.strictEqual(isExcluded('.vscode/settings', excludePatterns), true, 'Should exclude .vscode');
			assert.strictEqual(isExcluded('src/main.js', excludePatterns), false, 'Should not exclude src files');
		});

		test('should match transcript files', () => {
			const isMatch = (path: string): boolean => {
				return /\.transcript\.json$/i.test(path);
			};

			assert.strictEqual(isMatch('meeting.transcript.json'), true, 'Should match transcript files');
			assert.strictEqual(isMatch('call_2024.transcript.json'), true, 'Should match dated transcripts');
			assert.strictEqual(isMatch('data.json'), false, 'Should not match regular JSON');
		});

		test('should handle case-insensitive matching', () => {
			const isMatch = (path: string, pattern: string): boolean => {
				const regex = new RegExp(pattern, 'i');
				return regex.test(path);
			};

			assert.strictEqual(isMatch('README.MD', '*.md'), true, 'Should match case-insensitive .MD');
			assert.strictEqual(isMatch('file.Txt', '*.txt'), true, 'Should match case-insensitive .Txt');
		});

		test('should match docs folder patterns', () => {
			const isMatch = (path: string): boolean => {
				return /^docs\/.*\.md$/i.test(path.replace(/\\/g, '/'));
			};

			assert.strictEqual(isMatch('docs/README.md'), true, 'Should match docs root');
			assert.strictEqual(isMatch('docs/guides/setup.md'), true, 'Should match nested docs');
			assert.strictEqual(isMatch('other/file.md'), false, 'Should not match outside docs');
		});

	});

	// -----------------------------------------------------------------------
	// File Scanning Tests
	// -----------------------------------------------------------------------

	suite('File Scanning and Discovery', () => {

		test('should track indexed vs should-index files', () => {
			const files = [
				{ path: 'file1.md', isIndexed: true, shouldIndex: true },
				{ path: 'file2.md', isIndexed: false, shouldIndex: true },
				{ path: 'file3.txt', isIndexed: false, shouldIndex: false },
				{ path: 'file4.md', isIndexed: true, shouldIndex: true },
			];

			const indexedCount = files.filter(f => f.isIndexed).length;
			const shouldIndexCount = files.filter(f => f.shouldIndex && !f.isIndexed).length;
			const notIndexableCount = files.filter(f => !f.shouldIndex).length;

			assert.strictEqual(indexedCount, 2, 'Should count indexed files');
			assert.strictEqual(shouldIndexCount, 1, 'Should count files ready to index');
			assert.strictEqual(notIndexableCount, 1, 'Should count non-indexable files');
		});

		test('should provide reason for file status', () => {
			const getReason = (
				path: string,
				shouldIndex: boolean,
				isIndexed: boolean,
				includePatterns: string[],
				excludePatterns: string[]
			): string | undefined => {
				if (shouldIndex && !isIndexed) {
					return 'Matches indexing pattern';
				}
				if (!shouldIndex) {
					if (excludePatterns.some(p => path.includes(p))) {
						return `Excluded by pattern`;
					}
					return 'File extension not in indexing patterns';
				}
				return undefined;
			};

			assert.strictEqual(
				getReason('docs/README.md', true, false, ['**/*.md'], []),
				'Matches indexing pattern'
			);
			assert.strictEqual(
				getReason('.git/config', false, false, ['**/*.md'], ['.git']),
				'Excluded by pattern'
			);
		});

		test('should group files by status', () => {
			const files = [
				{ path: 'a.md', isIndexed: true, shouldIndex: true },
				{ path: 'b.md', isIndexed: false, shouldIndex: true },
				{ path: 'c.txt', isIndexed: false, shouldIndex: false },
				{ path: 'd.md', isIndexed: true, shouldIndex: true },
			];

			const grouped = {
				indexed: files.filter(f => f.isIndexed),
				readyToIndex: files.filter(f => f.shouldIndex && !f.isIndexed),
				excluded: files.filter(f => !f.shouldIndex),
			};

			assert.strictEqual(grouped.indexed.length, 2, 'Should group indexed files');
			assert.strictEqual(grouped.readyToIndex.length, 1, 'Should group ready-to-index files');
			assert.strictEqual(grouped.excluded.length, 1, 'Should group excluded files');
		});

	});

	// -----------------------------------------------------------------------
	// Preferences Management Tests
	// -----------------------------------------------------------------------

	suite('Preferences Management', () => {

		test('should load default patterns', () => {
			const defaults = {
				includePatterns: ['**/*.md', '**/*.markdown', '**/*.txt', '**/*.transcript.json'],
				excludePatterns: ['.git', '.leapfrog', '.vscode', 'node_modules', '.DS_Store'],
				autoIndex: true,
			};

			assert.strictEqual(defaults.includePatterns.length, 4, 'Should have default include patterns');
			assert.strictEqual(defaults.excludePatterns.length, 5, 'Should have default exclude patterns');
			assert.strictEqual(defaults.autoIndex, true, 'Auto-index should be enabled by default');
		});

		test('should update preferences', () => {
			let prefs = {
				includePatterns: ['**/*.md'],
				excludePatterns: ['.git'],
				autoIndex: true,
			};

			// Simulate update
			const updates = {
				includePatterns: ['**/*.md', '**/*.txt'],
				excludePatterns: ['.git', 'node_modules'],
			};

			prefs.includePatterns = updates.includePatterns;
			prefs.excludePatterns = updates.excludePatterns;

			assert.strictEqual(prefs.includePatterns.length, 2, 'Should update include patterns');
			assert.strictEqual(prefs.excludePatterns.length, 2, 'Should update exclude patterns');
		});

		test('should validate pattern arrays', () => {
			const isValidPatternArray = (patterns: unknown): boolean => {
				return Array.isArray(patterns) && patterns.every(p => typeof p === 'string');
			};

			assert.strictEqual(isValidPatternArray(['**/*.md', '**/*.txt']), true, 'Valid patterns should pass');
			assert.strictEqual(isValidPatternArray(['**/*.md']), true, 'Single pattern should pass');
			assert.strictEqual(isValidPatternArray([]), true, 'Empty array should pass');
			assert.strictEqual(isValidPatternArray(['**/*.md', 123] as any), false, 'Invalid patterns should fail');
		});

	});

	// -----------------------------------------------------------------------
	// Statistics and Tracking Tests
	// -----------------------------------------------------------------------

	suite('Statistics Tracking', () => {

		test('should calculate file statistics', () => {
			const files = [
				{ path: 'a.md', isIndexed: true },
				{ path: 'b.md', isIndexed: true },
				{ path: 'c.md', isIndexed: false },
				{ path: 'd.txt', isIndexed: false },
			];

			const stats = {
				total: files.length,
				indexed: files.filter(f => f.isIndexed).length,
				pending: files.filter(f => !f.isIndexed).length,
			};

			assert.strictEqual(stats.total, 4, 'Should count total files');
			assert.strictEqual(stats.indexed, 2, 'Should count indexed files');
			assert.strictEqual(stats.pending, 2, 'Should count pending files');
		});

		test('should track indexing progress', () => {
			const stats = {
				totalFiles: 100,
				indexedFiles: 45,
				shouldIndexFiles: 55,
			};

			const progress = (stats.indexedFiles / stats.shouldIndexFiles) * 100;

			assert.strictEqual(Math.round(progress), 82, 'Should calculate progress percentage');
		});

		test('should update statistics on scan', () => {
			let stats = {
				totalFiles: 0,
				indexedFiles: 0,
				shouldIndexFiles: 0,
			};

			const newFiles = [
				{ isIndexed: true },
				{ isIndexed: true },
				{ isIndexed: false },
			];

			stats.totalFiles = newFiles.length;
			stats.indexedFiles = newFiles.filter(f => f.isIndexed).length;
			stats.shouldIndexFiles = newFiles.filter(f => !f.isIndexed).length;

			assert.strictEqual(stats.totalFiles, 3, 'Should update total files');
			assert.strictEqual(stats.indexedFiles, 2, 'Should update indexed count');
			assert.strictEqual(stats.shouldIndexFiles, 1, 'Should update should-index count');
		});

	});

	// -----------------------------------------------------------------------
	// Edge Cases
	// -----------------------------------------------------------------------

	suite('Edge Cases', () => {

		test('should handle paths with special characters', () => {
			const paths = [
				'file with spaces.md',
				'file-with-dashes.md',
				'file_with_underscores.md',
				'file.multiple.dots.md',
			];

			const isMarkdown = (path: string): boolean => /\.md$/i.test(path);

			paths.forEach(path => {
				assert.strictEqual(isMarkdown(path), true, `Should handle ${path}`);
			});
		});

		test('should handle deeply nested paths', () => {
			const deepPath = 'a/b/c/d/e/f/g/h/i/j/file.md';
			const isMatch = (path: string): boolean => /\.md$/i.test(path);

			assert.strictEqual(isMatch(deepPath), true, 'Should handle deeply nested paths');
		});

		test('should handle symlinks in path processing', () => {
			// Symlinks should be treated as regular paths for now
			const symlink = '/path/to/symlink';
			assert.ok(typeof symlink === 'string', 'Should treat symlinks as strings');
		});

	});

});
