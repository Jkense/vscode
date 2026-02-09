/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import type {
	SidecarTranscript,
	SidecarSegment,
	SidecarSpeaker,
} from '../transcriptPreview';

// ---------------------------------------------------------------------------
// Unit tests for transcript preview data structures and logic
// ---------------------------------------------------------------------------

suite('TranscriptPreview', () => {

	// -----------------------------------------------------------------------
	// Sidecar transcript structure
	// -----------------------------------------------------------------------

	suite('Sidecar transcript format', () => {

		test('should represent a completed transcript with all fields', () => {
			const transcript: SidecarTranscript = {
				id: 'test-id-123',
				status: 'completed',
				duration: 125.4,
				text: 'Hello, how are you?',
				segments: [
					{
						id: 'seg_0',
						speakerId: 'A',
						text: 'Hello, how are you?',
						startTime: 0.5,
						endTime: 2.3,
						confidence: 0.95,
						sentiment: 'POSITIVE',
						sentimentConfidence: 0.87,
						words: [
							{ text: 'Hello,', startTime: 0.5, endTime: 0.8, confidence: 0.99 },
							{ text: 'how', startTime: 0.85, endTime: 1.0, confidence: 0.97 },
							{ text: 'are', startTime: 1.05, endTime: 1.2, confidence: 0.98 },
							{ text: 'you?', startTime: 1.25, endTime: 2.3, confidence: 0.96 },
						],
					},
				],
				speakers: [
					{ id: 'A', name: 'Speaker 1', color: '#3b82f6' },
				],
			};

			assert.strictEqual(transcript.id, 'test-id-123');
			assert.strictEqual(transcript.status, 'completed');
			assert.strictEqual(transcript.segments.length, 1);
			assert.strictEqual(transcript.speakers.length, 1);
		});

		test('should allow segments without sentiment', () => {
			const segment: SidecarSegment = {
				id: 'seg_0',
				text: 'No sentiment here',
				startTime: 0,
				endTime: 1.5,
			};

			assert.strictEqual(segment.sentiment, undefined);
			assert.strictEqual(segment.sentimentConfidence, undefined);
			assert.strictEqual(segment.words, undefined);
		});

		test('should allow segments without speaker', () => {
			const segment: SidecarSegment = {
				id: 'seg_0',
				text: 'Unattributed speech',
				startTime: 0,
				endTime: 1.0,
			};

			assert.strictEqual(segment.speakerId, undefined);
		});

		test('should represent all three sentiment values', () => {
			const sentiments: Array<SidecarSegment['sentiment']> = ['POSITIVE', 'NEUTRAL', 'NEGATIVE'];

			for (const sentiment of sentiments) {
				const segment: SidecarSegment = {
					id: `seg_${sentiment}`,
					text: `Sentiment: ${sentiment}`,
					startTime: 0,
					endTime: 1.0,
					sentiment,
					sentimentConfidence: 0.85,
				};

				assert.strictEqual(segment.sentiment, sentiment);
				assert.strictEqual(segment.sentimentConfidence, 0.85);
			}
		});

		test('should represent speakers with color', () => {
			const speaker: SidecarSpeaker = {
				id: 'B',
				name: 'Interviewer',
				color: '#ef4444',
			};

			assert.strictEqual(speaker.id, 'B');
			assert.strictEqual(speaker.name, 'Interviewer');
			assert.strictEqual(speaker.color, '#ef4444');
		});

		test('should allow speakers without color', () => {
			const speaker: SidecarSpeaker = {
				id: 'C',
				name: 'Speaker 3',
			};

			assert.strictEqual(speaker.color, undefined);
		});
	});

	// -----------------------------------------------------------------------
	// Transcript state transitions
	// -----------------------------------------------------------------------

	suite('Transcript state transitions', () => {

		test('should support pending state', () => {
			const transcript: SidecarTranscript = {
				id: 'pending-1',
				status: 'pending',
				segments: [],
				speakers: [],
			};

			assert.strictEqual(transcript.status, 'pending');
		});

		test('should support processing state', () => {
			const transcript: SidecarTranscript = {
				id: 'processing-1',
				status: 'processing',
				segments: [],
				speakers: [],
			};

			assert.strictEqual(transcript.status, 'processing');
		});

		test('should support error state with message', () => {
			const transcript: SidecarTranscript = {
				id: 'error-1',
				status: 'error',
				error: 'Transcription failed due to invalid audio format',
				segments: [],
				speakers: [],
			};

			assert.strictEqual(transcript.status, 'error');
			assert.strictEqual(transcript.error, 'Transcription failed due to invalid audio format');
		});

		test('should support completed state with full data', () => {
			const transcript: SidecarTranscript = {
				id: 'complete-1',
				status: 'completed',
				duration: 60.0,
				text: 'Full text here',
				segments: [
					{
						id: 'seg_0',
						speakerId: 'A',
						text: 'Full text here',
						startTime: 0,
						endTime: 60.0,
						confidence: 0.92,
						sentiment: 'NEUTRAL',
						sentimentConfidence: 0.78,
					},
				],
				speakers: [
					{ id: 'A', name: 'Speaker 1', color: '#3b82f6' },
				],
			};

			assert.strictEqual(transcript.status, 'completed');
			assert.ok(transcript.duration);
			assert.ok(transcript.text);
			assert.strictEqual(transcript.segments.length, 1);
			assert.strictEqual(transcript.speakers.length, 1);
		});
	});

	// -----------------------------------------------------------------------
	// Sentiment mapping validation
	// -----------------------------------------------------------------------

	suite('Sentiment mapping', () => {

		test('should correctly type sentiment values', () => {
			const validSentiments: Array<'POSITIVE' | 'NEUTRAL' | 'NEGATIVE'> = [
				'POSITIVE', 'NEUTRAL', 'NEGATIVE',
			];

			for (const s of validSentiments) {
				const segment: SidecarSegment = {
					id: 'test',
					text: 'test',
					startTime: 0,
					endTime: 1,
					sentiment: s,
				};
				assert.ok(['POSITIVE', 'NEUTRAL', 'NEGATIVE'].includes(segment.sentiment!));
			}
		});

		test('should allow sentimentConfidence between 0 and 1', () => {
			const segment: SidecarSegment = {
				id: 'test',
				text: 'test',
				startTime: 0,
				endTime: 1,
				sentiment: 'POSITIVE',
				sentimentConfidence: 0.95,
			};

			assert.ok(segment.sentimentConfidence! >= 0);
			assert.ok(segment.sentimentConfidence! <= 1);
		});
	});

	// -----------------------------------------------------------------------
	// Word-level data
	// -----------------------------------------------------------------------

	suite('Word-level data', () => {

		test('should have word timestamps within segment range', () => {
			const segment: SidecarSegment = {
				id: 'seg_0',
				text: 'Hello world',
				startTime: 1.0,
				endTime: 3.0,
				words: [
					{ text: 'Hello', startTime: 1.0, endTime: 1.8, confidence: 0.99 },
					{ text: 'world', startTime: 1.9, endTime: 3.0, confidence: 0.98 },
				],
			};

			for (const word of segment.words!) {
				assert.ok(word.startTime >= segment.startTime, `Word "${word.text}" starts before segment`);
				assert.ok(word.endTime <= segment.endTime, `Word "${word.text}" ends after segment`);
			}
		});

		test('should preserve word text', () => {
			const segment: SidecarSegment = {
				id: 'seg_0',
				text: 'Hello world',
				startTime: 0,
				endTime: 2,
				words: [
					{ text: 'Hello', startTime: 0, endTime: 1 },
					{ text: 'world', startTime: 1, endTime: 2 },
				],
			};

			const reconstructed = segment.words!.map(w => w.text).join(' ');
			assert.strictEqual(reconstructed, segment.text);
		});
	});

	// -----------------------------------------------------------------------
	// Speaker rename
	// -----------------------------------------------------------------------

	suite('Speaker rename', () => {

		test('should update speaker name in transcript data', () => {
			const transcript: SidecarTranscript = {
				id: 'rename-test',
				status: 'completed',
				segments: [],
				speakers: [
					{ id: 'A', name: 'Speaker 1', color: '#3b82f6' },
					{ id: 'B', name: 'Speaker 2', color: '#ef4444' },
				],
			};

			// Simulate rename
			const speaker = transcript.speakers.find(s => s.id === 'A');
			assert.ok(speaker);
			speaker.name = 'Interviewer';

			assert.strictEqual(transcript.speakers[0].name, 'Interviewer');
			assert.strictEqual(transcript.speakers[1].name, 'Speaker 2');
		});
	});
});
