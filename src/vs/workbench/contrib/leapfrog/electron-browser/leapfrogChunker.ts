/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure-function document chunkers for the Leapfrog index.
 *
 * Splits documents into semantically coherent chunks suitable for embedding.
 * Three strategies: heading-based (markdown), speaker-turn (transcripts),
 * and paragraph-based (plain text).
 *
 * Target chunk size: 300-800 tokens (~1200-3200 characters).
 */

import { generateUuid } from '../../../../base/common/uuid.js';
import type { ILeapfrogIndexChunk } from '../common/leapfrog.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CHUNK_CHARS = 3200;
const MIN_CHUNK_CHARS = 50;
// const PARAGRAPH_MIN_CHARS = 200;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Dispatch to the correct chunker based on file extension.
 */
export function chunkFile(filePath: string, content: string): ILeapfrogIndexChunk[] {
	const ext = filePath.toLowerCase().split('.').pop() ?? '';

	if (filePath.endsWith('.transcript.json')) {
		return chunkTranscriptJson(filePath, content);
	}

	switch (ext) {
		case 'md':
		case 'markdown':
			return chunkMarkdown(filePath, content);
		default:
			return chunkPlainText(filePath, content);
	}
}

// ---------------------------------------------------------------------------
// Markdown chunker (heading-based)
// ---------------------------------------------------------------------------

interface HeadingSection {
	level: number;
	title: string;
	headingPath: string;
	content: string;
	startOffset: number;
	endOffset: number;
}

/**
 * Split markdown by headings. Each heading section becomes a chunk.
 * Sections exceeding MAX_CHUNK_CHARS are split at paragraph boundaries.
 */
export function chunkMarkdown(filePath: string, content: string): ILeapfrogIndexChunk[] {
	if (content.trim().length < MIN_CHUNK_CHARS) {
		return [];
	}

	const sections = splitByHeadings(content);
	const chunks: ILeapfrogIndexChunk[] = [];

	for (const section of sections) {
		if (section.content.trim().length < MIN_CHUNK_CHARS) {
			continue;
		}

		if (section.content.length <= MAX_CHUNK_CHARS) {
			chunks.push({
				id: generateUuid(),
				filePath,
				chunkType: 'markdown_heading',
				content: section.content,
				startOffset: section.startOffset,
				endOffset: section.endOffset,
				headingPath: section.headingPath || undefined,
			});
		} else {
			// Split large sections at paragraph boundaries
			const subChunks = splitAtParagraphs(section.content, section.startOffset);
			for (const sub of subChunks) {
				if (sub.text.trim().length < MIN_CHUNK_CHARS) {
					continue;
				}
				chunks.push({
					id: generateUuid(),
					filePath,
					chunkType: 'markdown_heading',
					content: sub.text,
					startOffset: sub.startOffset,
					endOffset: sub.endOffset,
					headingPath: section.headingPath || undefined,
				});
			}
		}
	}

	return chunks;
}

function splitByHeadings(content: string): HeadingSection[] {
	const lines = content.split('\n');
	const headingRegex = /^(#{1,6})\s+(.+)$/;

	const sections: HeadingSection[] = [];
	// Track the heading path as a stack: [level, title]
	const pathStack: { level: number; title: string }[] = [];

	let currentStart = 0;
	// let currentOffset = 0;
	let currentTitle = '';
	let currentLevel = 0;
	let accumulatedContent = '';

	function pushSection(): void {
		if (accumulatedContent.length > 0) {
			sections.push({
				level: currentLevel,
				title: currentTitle,
				headingPath: pathStack.map(p => p.title).join(' > '),
				content: accumulatedContent,
				startOffset: currentStart,
				endOffset: currentStart + accumulatedContent.length,
			});
		}
	}

	let offset = 0;
	for (const line of lines) {
		const match = line.match(headingRegex);
		if (match) {
			// Save previous section
			pushSection();

			const level = match[1]!.length;
			const title = match[2]!.trim();

			// Update path stack: pop anything at same or deeper level
			while (pathStack.length > 0 && pathStack[pathStack.length - 1]!.level >= level) {
				pathStack.pop();
			}
			pathStack.push({ level, title });

			currentLevel = level;
			currentTitle = title;
			currentStart = offset;
			currentOffset = offset;
			accumulatedContent = line + '\n';
		} else {
			accumulatedContent += line + '\n';
		}
		offset += line.length + 1; // +1 for newline
	}

	// Push final section
	pushSection();

	// If no headings found, treat entire content as one section
	if (sections.length === 0 && content.trim().length > 0) {
		sections.push({
			level: 0,
			title: '',
			headingPath: '',
			content: content,
			startOffset: 0,
			endOffset: content.length,
		});
	}

	return sections;
}

// ---------------------------------------------------------------------------
// Transcript chunker (speaker-turn-based)
// ---------------------------------------------------------------------------

interface TranscriptSegmentData {
	speaker?: string;
	text: string;
	startTime?: number;
	endTime?: number;
}

/**
 * Parse a .transcript.json file and chunk by speaker turns.
 * Merges consecutive same-speaker turns within a 2-second gap.
 */
export function chunkTranscriptJson(filePath: string, content: string): ILeapfrogIndexChunk[] {
	let segments: TranscriptSegmentData[];
	try {
		const parsed = JSON.parse(content);
		// Support both { segments: [...] } and raw array
		segments = Array.isArray(parsed) ? parsed : (parsed.segments ?? []);
	} catch {
		// If JSON parse fails, treat as plain text
		return chunkPlainText(filePath, content);
	}

	if (segments.length === 0) {
		return [];
	}

	// Merge consecutive same-speaker turns within 2s gap
	const merged = mergeTranscriptSegments(segments, 2.0);

	const chunks: ILeapfrogIndexChunk[] = [];
	let offset = 0;

	for (const seg of merged) {
		if (seg.text.trim().length < MIN_CHUNK_CHARS) {
			offset += seg.text.length;
			continue;
		}

		if (seg.text.length <= MAX_CHUNK_CHARS) {
			chunks.push({
				id: generateUuid(),
				filePath,
				chunkType: 'transcript_speaker_turn',
				content: seg.text,
				startOffset: offset,
				endOffset: offset + seg.text.length,
				speaker: seg.speaker,
				startTime: seg.startTime,
				endTime: seg.endTime,
			});
		} else {
			// Split long turns at sentence boundaries
			const subChunks = splitAtSentences(seg.text, offset);
			for (const sub of subChunks) {
				if (sub.text.trim().length < MIN_CHUNK_CHARS) {
					continue;
				}
				chunks.push({
					id: generateUuid(),
					filePath,
					chunkType: 'transcript_speaker_turn',
					content: sub.text,
					startOffset: sub.startOffset,
					endOffset: sub.endOffset,
					speaker: seg.speaker,
					startTime: seg.startTime,
					endTime: seg.endTime,
				});
			}
		}
		offset += seg.text.length;
	}

	return chunks;
}

function mergeTranscriptSegments(segments: TranscriptSegmentData[], maxGapSeconds: number): TranscriptSegmentData[] {
	if (segments.length === 0) {
		return [];
	}

	const result: TranscriptSegmentData[] = [];
	let current = { ...segments[0]! };

	for (let i = 1; i < segments.length; i++) {
		const next = segments[i]!;
		const gap = (next.startTime ?? 0) - (current.endTime ?? 0);
		const sameSpeaker = current.speaker === next.speaker;

		if (sameSpeaker && gap <= maxGapSeconds) {
			current = {
				...current,
				text: `${current.text} ${next.text}`,
				endTime: next.endTime,
			};
		} else {
			result.push(current);
			current = { ...next };
		}
	}

	result.push(current);
	return result;
}

// ---------------------------------------------------------------------------
// Plain text chunker (paragraph-based)
// ---------------------------------------------------------------------------

/**
 * Split plain text at paragraph boundaries (double newlines).
 * Merges small adjacent paragraphs; splits large ones at sentence boundaries.
 */
export function chunkPlainText(filePath: string, content: string): ILeapfrogIndexChunk[] {
	if (content.trim().length < MIN_CHUNK_CHARS) {
		return [];
	}

	const paragraphs = content.split(/\n\n+/);
	const chunks: ILeapfrogIndexChunk[] = [];

	let accumulated = '';
	let accStart = 0;
	let offset = 0;

	for (let i = 0; i < paragraphs.length; i++) {
		const para = paragraphs[i]!;
		const paraEnd = offset + para.length;

		if (accumulated.length === 0) {
			accStart = offset;
		}

		if (accumulated.length + para.length + 2 <= MAX_CHUNK_CHARS) {
			accumulated = accumulated.length > 0 ? accumulated + '\n\n' + para : para;
		} else {
			// Flush accumulated if it has enough content
			if (accumulated.trim().length >= MIN_CHUNK_CHARS) {
				chunks.push({
					id: generateUuid(),
					filePath,
					chunkType: 'plaintext_paragraph',
					content: accumulated,
					startOffset: accStart,
					endOffset: accStart + accumulated.length,
				});
			}
			accumulated = para;
			accStart = offset;
		}

		// Skip the paragraph separator (2 chars for \n\n)
		offset = paraEnd + 2;
	}

	// Flush remaining
	if (accumulated.trim().length >= MIN_CHUNK_CHARS) {
		chunks.push({
			id: generateUuid(),
			filePath,
			chunkType: 'plaintext_paragraph',
			content: accumulated,
			startOffset: accStart,
			endOffset: accStart + accumulated.length,
		});
	}

	return chunks;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface TextSlice {
	text: string;
	startOffset: number;
	endOffset: number;
}

/**
 * Split text at paragraph boundaries (\n\n), keeping chunks under MAX_CHUNK_CHARS.
 */
function splitAtParagraphs(text: string, baseOffset: number): TextSlice[] {
	const paragraphs = text.split(/\n\n+/);
	const slices: TextSlice[] = [];

	let accumulated = '';
	let accStart = 0;
	let offset = 0;

	for (const para of paragraphs) {
		if (accumulated.length === 0) {
			accStart = offset;
		}

		if (accumulated.length + para.length + 2 <= MAX_CHUNK_CHARS) {
			accumulated = accumulated.length > 0 ? accumulated + '\n\n' + para : para;
		} else {
			if (accumulated.length > 0) {
				slices.push({
					text: accumulated,
					startOffset: baseOffset + accStart,
					endOffset: baseOffset + accStart + accumulated.length,
				});
			}
			accumulated = para;
			accStart = offset;
		}
		offset += para.length + 2;
	}

	if (accumulated.length > 0) {
		slices.push({
			text: accumulated,
			startOffset: baseOffset + accStart,
			endOffset: baseOffset + accStart + accumulated.length,
		});
	}

	return slices;
}

/**
 * Split text at sentence boundaries, keeping chunks under MAX_CHUNK_CHARS.
 */
function splitAtSentences(text: string, baseOffset: number): TextSlice[] {
	// Simple sentence boundary detection: split on . ! ? followed by space or end
	const sentenceEnds = /(?<=[.!?])\s+/g;
	const sentences = text.split(sentenceEnds);
	const slices: TextSlice[] = [];

	let accumulated = '';
	let accStart = 0;
	let offset = 0;

	for (const sentence of sentences) {
		if (accumulated.length === 0) {
			accStart = offset;
		}

		if (accumulated.length + sentence.length + 1 <= MAX_CHUNK_CHARS) {
			accumulated = accumulated.length > 0 ? accumulated + ' ' + sentence : sentence;
		} else {
			if (accumulated.length > 0) {
				slices.push({
					text: accumulated,
					startOffset: baseOffset + accStart,
					endOffset: baseOffset + accStart + accumulated.length,
				});
			}
			accumulated = sentence;
			accStart = offset;
		}
		offset += sentence.length + 1;
	}

	if (accumulated.length > 0) {
		slices.push({
			text: accumulated,
			startOffset: baseOffset + accStart,
			endOffset: baseOffset + accStart + accumulated.length,
		});
	}

	return slices;
}
