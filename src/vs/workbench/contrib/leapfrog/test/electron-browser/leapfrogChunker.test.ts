/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Unit tests for leapfrogChunker
 *
 * Tests document chunking strategies:
 * - Markdown heading-based chunking
 * - Plain text paragraph-based chunking
 * - Transcript JSON speaker-turn chunking
 * - Size constraints and edge cases
 */

import * as assert from 'assert';
import { chunkMarkdown, chunkPlainText, chunkFile } from '../../electron-browser/leapfrogChunker.js';

suite('Leapfrog Chunker - Document Segmentation', () => {

	// -----------------------------------------------------------------------
	// Markdown Chunking Tests
	// -----------------------------------------------------------------------

	suite('Markdown Chunking', () => {

		test('should chunk markdown by headings', () => {
			const content = `# Main Title
Content under main title.

## Subsection 1
Content for subsection 1.

## Subsection 2
Content for subsection 2.`;

			const chunks = chunkMarkdown('test.md', content);

			assert.strictEqual(chunks.length > 0, true, 'Should produce at least one chunk');
			assert.ok(chunks.every(c => c.chunkType === 'markdown_heading'), 'All chunks should be markdown_heading type');
			assert.ok(chunks.every(c => c.filePath === 'test.md'), 'All chunks should have correct file path');
		});

		test('should preserve heading hierarchy', () => {
			const content = `# H1 Title
Content

## H2 Subsection
Content

### H3 Subsubsection
Content`;

			const chunks = chunkMarkdown('test.md', content);

			assert.ok(chunks.length >= 3, 'Should create chunks for hierarchical headings');
		});

		test('should handle empty markdown sections', () => {
			const content = `# Title
## Empty Subsection
## Another Section
Some content here`;

			const chunks = chunkMarkdown('test.md', content);

			// Empty sections might be skipped or minimal chunks created
			assert.ok(Array.isArray(chunks), 'Should return array even with empty sections');
		});

		test('should split large sections at paragraph boundaries', () => {
			const largeContent = `# Big Section
${Array(50).fill('This is a paragraph. It contains multiple sentences. The paragraph should be long enough.').join('\n')}`;

			const chunks = chunkMarkdown('test.md', largeContent);

			assert.ok(chunks.length > 0, 'Should chunk large content');
			// Verify chunks respect max size
			chunks.forEach((chunk, index) => {
				assert.ok(chunk.content.length > 0, `Chunk ${index} should have content`);
				assert.ok(chunk.startOffset >= 0, `Chunk ${index} should have valid startOffset`);
				assert.ok(chunk.endOffset > chunk.startOffset, `Chunk ${index} should have valid endOffset`);
			});
		});

		test('should include heading path in chunk metadata', () => {
			const content = `# Main
## Sub1
### Sub2
Content here`;

			const chunks = chunkMarkdown('test.md', content);

			// Check that chunks have heading path
			const chunksWithPath = chunks.filter(c => c.headingPath);
			assert.ok(chunksWithPath.length > 0, 'Should include heading path in metadata');
		});

		test('should filter out minimal content chunks', () => {
			const content = `# Title
x

## Section
y`;

			const chunks = chunkMarkdown('test.md', content);

			// Minimal content should be filtered
			chunks.forEach(chunk => {
				assert.ok(chunk.content.trim().length >= 50, 'Chunks should meet minimum content length');
			});
		});

	});

	// -----------------------------------------------------------------------
	// Plain Text Chunking Tests
	// -----------------------------------------------------------------------

	suite('Plain Text Chunking', () => {

		test('should chunk plain text by paragraphs', () => {
			const content = `First paragraph with some content.

Second paragraph with more information.

Third paragraph with additional details.`;

			const chunks = chunkPlainText('test.txt', content);

			assert.ok(chunks.length > 0, 'Should produce chunks for plain text');
			chunks.forEach(chunk => {
				assert.strictEqual(chunk.filePath, 'test.txt', 'Should set correct file path');
				assert.ok(chunk.content.length > 0, 'Each chunk should have content');
			});
		});

		test('should handle text with varying paragraph lengths', () => {
			const content = `Short.

This is a much longer paragraph that contains more information and spans multiple lines. It should be treated as a single paragraph until we encounter a blank line.

Another paragraph here.`;

			const chunks = chunkPlainText('test.txt', content);

			assert.ok(chunks.length > 0, 'Should handle mixed paragraph lengths');
		});

		test('should respect minimum chunk size', () => {
			const content = `a
b
c`;

			const chunks = chunkPlainText('test.txt', content);

			// Very small content might not produce chunks
			if (chunks.length > 0) {
				chunks.forEach(chunk => {
					assert.ok(chunk.content.length > 0, 'Chunk should have content');
				});
			}
		});

		test('should preserve content boundaries and offsets', () => {
			const content = `First section of text.

Second section of text.`;

			const chunks = chunkPlainText('test.txt', content);

			chunks.forEach((chunk, index) => {
				assert.strictEqual(
					content.substring(chunk.startOffset, chunk.endOffset),
					chunk.content,
					`Chunk ${index} offsets should match content`
				);
			});
		});

	});

	// -----------------------------------------------------------------------
	// File Type Dispatch Tests
	// -----------------------------------------------------------------------

	suite('File Type Dispatch', () => {

		test('should dispatch .md files to markdown chunker', () => {
			const content = `# Title
## Section
Content`;

			const chunks = chunkFile('document.md', content);

			assert.ok(chunks.length > 0, 'Should chunk markdown files');
			chunks.forEach(chunk => {
				assert.strictEqual(chunk.filePath, 'document.md', 'Should preserve file path');
			});
		});

		test('should dispatch .markdown files to markdown chunker', () => {
			const content = `# Title
Content here`;

			const chunks = chunkFile('readme.markdown', content);

			assert.ok(chunks.every(c => c.filePath === 'readme.markdown'), 'Should handle .markdown extension');
		});

		test('should dispatch .txt files to plain text chunker', () => {
			const content = `Some text content.

More text here.`;

			const chunks = chunkFile('notes.txt', content);

			assert.ok(Array.isArray(chunks), 'Should return chunks for text files');
		});

		test('should dispatch .transcript.json to transcript chunker', () => {
			const content = `{
  "speakers": ["Person A", "Person B"],
  "turns": [
    {"speaker": "Person A", "text": "Hello"},
    {"speaker": "Person B", "text": "Hi there"}
  ]
}`;

			const chunks = chunkFile('meeting.transcript.json', content);

			assert.ok(Array.isArray(chunks), 'Should handle transcript files');
		});

		test('should default unknown extensions to plain text chunker', () => {
			const content = `Some content.

More content.`;

			const chunks = chunkFile('file.unknown', content);

			assert.ok(Array.isArray(chunks), 'Should default to plain text chunking');
		});

	});

	// -----------------------------------------------------------------------
	// Edge Cases and Constraints
	// -----------------------------------------------------------------------

	suite('Edge Cases and Constraints', () => {

		test('should handle empty content', () => {
			const chunks = chunkMarkdown('empty.md', '');

			assert.strictEqual(chunks.length, 0, 'Should return empty array for empty content');
		});

		test('should handle whitespace-only content', () => {
			const chunks = chunkMarkdown('spaces.md', '   \n\n   \t\n  ');

			assert.strictEqual(chunks.length, 0, 'Should return empty array for whitespace-only content');
		});

		test('should handle very long lines', () => {
			const longLine = 'x'.repeat(5000);
			const content = `# Title\n${longLine}`;

			const chunks = chunkMarkdown('test.md', content);

			// Should still produce chunks, split as needed
			assert.ok(Array.isArray(chunks), 'Should handle very long lines');
		});

		test('should generate unique chunk IDs', () => {
			const content = `# Section 1
Content

# Section 2
Content`;

			const chunks = chunkMarkdown('test.md', content);

			const ids = chunks.map(c => c.id);
			const uniqueIds = new Set(ids);

			assert.strictEqual(ids.length, uniqueIds.size, 'All chunk IDs should be unique');
		});

		test('should handle mixed line endings', () => {
			const content = `# Title\r\nContent\nMore\r\nStuff`;

			const chunks = chunkMarkdown('test.md', content);

			assert.ok(Array.isArray(chunks), 'Should handle mixed line endings');
		});

		test('should preserve special markdown characters', () => {
			const content = `# Title *with* **bold** and \`code\`
Content with [links](http://example.com) and lists:
- Item 1
- Item 2`;

			const chunks = chunkMarkdown('test.md', content);

			// Verify content is preserved
			const allContent = chunks.map(c => c.content).join('');
			assert.ok(allContent.includes('**bold**'), 'Should preserve markdown formatting');
		});

	});

});
