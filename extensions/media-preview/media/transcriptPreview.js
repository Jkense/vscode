/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check
'use strict';

(function () {
	// @ts-ignore
	const vscode = acquireVsCodeApi();

	const settingsEl = /** @type {HTMLMetaElement} */ (document.getElementById('settings'));
	const settings = JSON.parse(settingsEl.dataset.settings || '{}');

	// DOM elements
	const mediaContainer = /** @type {HTMLElement} */ (document.getElementById('media-container'));
	const transcriptContainer = /** @type {HTMLElement} */ (document.getElementById('transcript-container'));
	const orderBtn = /** @type {HTMLButtonElement} */ (document.getElementById('order-transcript-btn'));
	const statusEl = /** @type {HTMLElement} */ (document.getElementById('transcript-status'));
	const segmentsEl = /** @type {HTMLElement} */ (document.getElementById('transcript-segments'));

	/** @type {HTMLAudioElement | HTMLVideoElement | null} */
	let mediaElement = null;

	/** @type {any} */
	let transcriptData = null;

	// -----------------------------------------------------------------------
	// Initialise media element
	// -----------------------------------------------------------------------

	function initMedia() {
		if (!settings.src) {
			document.body.classList.add('error');
			document.body.classList.remove('loading');
			return;
		}

		const tag = settings.mediaType === 'video' ? 'video' : 'audio';
		mediaElement = document.createElement(tag);
		mediaElement.controls = true;
		mediaElement.src = settings.src;

		if (tag === 'video') {
			if (settings.autoplay) { mediaElement.autoplay = true; }
			if (settings.loop) { mediaElement.loop = true; }
		}

		const clearLoading = () => {
			document.body.classList.remove('loading');
		};
		mediaElement.addEventListener('canplay', clearLoading);
		// Fallback: remove loading indicator after 2s even if media is still buffering
		setTimeout(clearLoading, 2000);

		mediaElement.addEventListener('error', () => {
			document.body.classList.add('error');
			document.body.classList.remove('loading');
		});

		mediaElement.addEventListener('timeupdate', () => {
			if (transcriptData && mediaElement) {
				updateActiveSegment(mediaElement.currentTime);
			}
		});

		mediaContainer.appendChild(mediaElement);

		// Wire up the "open as text" link
		const openLink = document.querySelector('.open-file-link');
		if (openLink) {
			openLink.addEventListener('click', (e) => {
				e.preventDefault();
				vscode.postMessage({ type: 'reopen-as-text' });
			});
		}
	}

	// -----------------------------------------------------------------------
	// Order Transcript button
	// -----------------------------------------------------------------------

	orderBtn.addEventListener('click', () => {
		vscode.postMessage({ type: 'start-transcription' });
		orderBtn.classList.add('hidden');
		showStatus('processing');
	});

	// -----------------------------------------------------------------------
	// Message handling from extension host
	// -----------------------------------------------------------------------

	window.addEventListener('message', (event) => {
		const message = event.data;
		switch (message.type) {
			case 'transcript-ready':
				transcriptData = message.transcript;
				hideStatus();
				orderBtn.classList.add('hidden');
				renderTranscript(message.transcript);
				break;

			case 'transcript-status':
				showStatus(message.status);
				orderBtn.classList.add('hidden');
				break;

			case 'transcript-error':
				showError(message.error);
				break;

			case 'speaker-renamed':
				if (transcriptData) {
					const speaker = transcriptData.speakers.find(
						/** @param {any} s */ (s) => s.id === message.speakerId
					);
					if (speaker) {
						speaker.name = message.newName;
					}
					renderTranscript(transcriptData);
				}
				break;
		}
	});

	// -----------------------------------------------------------------------
	// Status display
	// -----------------------------------------------------------------------

	/** @param {string} status */
	function showStatus(status) {
		statusEl.classList.remove('hidden', 'error');
		if (status === 'processing' || status === 'pending') {
			statusEl.innerHTML = '<span class="spinner"></span> Transcribing...';
		} else {
			statusEl.textContent = status;
		}
	}

	/** @param {string} errorMsg */
	function showError(errorMsg) {
		statusEl.classList.remove('hidden');
		statusEl.classList.add('error');
		statusEl.innerHTML = '';

		const text = document.createTextNode(errorMsg + ' ');
		statusEl.appendChild(text);

		const retryBtn = document.createElement('button');
		retryBtn.className = 'retry-btn';
		retryBtn.textContent = 'Retry';
		retryBtn.addEventListener('click', () => {
			vscode.postMessage({ type: 'start-transcription' });
			showStatus('processing');
		});
		statusEl.appendChild(retryBtn);

		orderBtn.classList.remove('hidden');
	}

	function hideStatus() {
		statusEl.classList.add('hidden');
		statusEl.classList.remove('error');
	}

	// -----------------------------------------------------------------------
	// Transcript rendering
	// -----------------------------------------------------------------------

	/** @param {any} transcript */
	function renderTranscript(transcript) {
		segmentsEl.innerHTML = '';

		if (!transcript || !transcript.segments || transcript.segments.length === 0) {
			return;
		}

		const speakerMap = buildSpeakerMap(transcript.speakers || []);

		for (const segment of transcript.segments) {
			const el = createSegmentElement(segment, speakerMap, transcript.id);
			segmentsEl.appendChild(el);
		}
	}

	/**
	 * @param {any[]} speakers
	 * @returns {Map<string, any>}
	 */
	function buildSpeakerMap(speakers) {
		const map = new Map();
		for (const s of speakers) {
			map.set(s.id, s);
		}
		return map;
	}

	/**
	 * @param {any} segment
	 * @param {Map<string, any>} speakerMap
	 * @param {string} transcriptId
	 * @returns {HTMLElement}
	 */
	function createSegmentElement(segment, speakerMap, transcriptId) {
		const el = document.createElement('div');
		el.className = 'segment';
		el.dataset.startTime = String(segment.startTime);
		el.dataset.endTime = String(segment.endTime);
		el.dataset.segmentId = segment.id;

		// Click to seek
		el.addEventListener('click', (e) => {
			// Ignore clicks on speaker badge (rename) and timestamp
			if (/** @type {HTMLElement} */ (e.target).closest('.speaker-badge, .segment-timestamp, .speaker-rename-input')) {
				return;
			}
			if (mediaElement) {
				mediaElement.currentTime = segment.startTime;
				mediaElement.play();
			}
		});

		// Header row
		const header = document.createElement('div');
		header.className = 'segment-header';

		// Speaker badge
		if (segment.speakerId) {
			const speaker = speakerMap.get(segment.speakerId);
			const badge = document.createElement('span');
			badge.className = 'speaker-badge';
			badge.style.backgroundColor = (speaker && speaker.color) || '#6b7280';
			badge.textContent = (speaker && speaker.name) || segment.speakerId;
			badge.title = 'Click to rename speaker';
			badge.addEventListener('click', (e) => {
				e.stopPropagation();
				startSpeakerRename(badge, segment.speakerId, speaker, transcriptId);
			});
			header.appendChild(badge);
		}

		// Timestamp
		if (settings.showTimestamps !== false) {
			const ts = document.createElement('span');
			ts.className = 'segment-timestamp';
			ts.textContent = formatTime(segment.startTime);
			ts.title = 'Click to seek';
			ts.addEventListener('click', (e) => {
				e.stopPropagation();
				if (mediaElement) {
					mediaElement.currentTime = segment.startTime;
					mediaElement.play();
				}
			});
			header.appendChild(ts);
		}

		// Sentiment indicator
		if (settings.showSentiment !== false && segment.sentiment) {
			const sentEl = document.createElement('span');
			sentEl.className = 'sentiment-indicator';

			if (segment.sentiment === 'POSITIVE') {
				sentEl.classList.add('positive');
				sentEl.textContent = '+';
			} else if (segment.sentiment === 'NEGATIVE') {
				sentEl.classList.add('negative');
				sentEl.textContent = '-';
			} else {
				sentEl.classList.add('neutral');
				sentEl.textContent = '~';
			}

			if (segment.sentimentConfidence !== null) {
				sentEl.title = segment.sentiment + ' (' + Math.round(segment.sentimentConfidence * 100) + '%)';
			} else {
				sentEl.title = segment.sentiment;
			}

			header.appendChild(sentEl);
		}

		// Confidence
		if (settings.showConfidence && segment.confidence !== null) {
			const conf = document.createElement('span');
			conf.className = 'segment-confidence';
			conf.textContent = Math.round(segment.confidence * 100) + '%';
			conf.title = 'Transcription confidence';
			header.appendChild(conf);
		}

		el.appendChild(header);

		// Segment text with word-level spans
		const textEl = document.createElement('div');
		textEl.className = 'segment-text';

		if (settings.wordHighlight !== false && segment.words && segment.words.length > 0) {
			for (const word of segment.words) {
				const span = document.createElement('span');
				span.className = 'word';
				span.dataset.startTime = String(word.startTime);
				span.dataset.endTime = String(word.endTime);
				span.textContent = word.text + ' ';
				textEl.appendChild(span);
			}
		} else {
			textEl.textContent = segment.text;
		}

		el.appendChild(textEl);
		return el;
	}

	// -----------------------------------------------------------------------
	// Active segment & word tracking
	// -----------------------------------------------------------------------

	/** @type {HTMLElement | null} */
	let currentActiveSegment = null;

	/** @param {number} currentTime */
	function updateActiveSegment(currentTime) {
		const segments = segmentsEl.querySelectorAll('.segment');
		/** @type {HTMLElement | null} */
		let active = null;

		segments.forEach((/** @type {HTMLElement} */ seg) => {
			const start = parseFloat(seg.dataset.startTime || '0');
			const end = parseFloat(seg.dataset.endTime || '0');

			if (currentTime >= start && currentTime <= end) {
				seg.classList.add('active');
				active = seg;
			} else {
				seg.classList.remove('active');
			}
		});

		// Auto-scroll to active segment
		if (active && active !== currentActiveSegment && settings.autoScroll !== false) {
			active.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
			currentActiveSegment = active;
		}

		// Word-level highlighting
		if (active && settings.wordHighlight !== false) {
			const words = active.querySelectorAll('.word');
			words.forEach((/** @type {HTMLElement} */ w) => {
				const wStart = parseFloat(w.dataset.startTime || '0');
				const wEnd = parseFloat(w.dataset.endTime || '0');
				if (currentTime >= wStart && currentTime <= wEnd) {
					w.classList.add('active');
				} else {
					w.classList.remove('active');
				}
			});
		}
	}

	// -----------------------------------------------------------------------
	// Speaker rename
	// -----------------------------------------------------------------------

	/**
	 * @param {HTMLElement} badge
	 * @param {string} speakerId
	 * @param {any} speaker
	 * @param {string} transcriptId
	 */
	function startSpeakerRename(badge, speakerId, speaker, transcriptId) {
		const currentName = (speaker && speaker.name) || speakerId;

		const input = document.createElement('input');
		input.type = 'text';
		input.className = 'speaker-rename-input';
		input.value = currentName;

		badge.replaceWith(input);
		input.focus();
		input.select();

		/** @param {boolean} save */
		const finish = (save) => {
			const newName = input.value.trim();
			if (save && newName && newName !== currentName) {
				vscode.postMessage({
					type: 'rename-speaker',
					transcriptId,
					speakerId,
					newName,
				});
			}

			// Restore badge
			const newBadge = document.createElement('span');
			newBadge.className = 'speaker-badge';
			newBadge.style.backgroundColor = (speaker && speaker.color) || '#6b7280';
			newBadge.textContent = (save && newName) ? newName : currentName;
			newBadge.title = 'Click to rename speaker';
			newBadge.addEventListener('click', (e) => {
				e.stopPropagation();
				startSpeakerRename(newBadge, speakerId, speaker, transcriptId);
			});
			input.replaceWith(newBadge);
		};

		input.addEventListener('blur', () => finish(true));
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { finish(true); }
			if (e.key === 'Escape') { finish(false); }
		});
	}

	// -----------------------------------------------------------------------
	// Utilities
	// -----------------------------------------------------------------------

	/** @param {number} seconds */
	function formatTime(seconds) {
		const h = Math.floor(seconds / 3600);
		const m = Math.floor((seconds % 3600) / 60);
		const s = Math.floor(seconds % 60);

		if (h > 0) {
			return String(h).padStart(2, '0') + ':' +
				String(m).padStart(2, '0') + ':' +
				String(s).padStart(2, '0');
		}
		return String(m).padStart(2, '0') + ':' +
			String(s).padStart(2, '0');
	}

	// -----------------------------------------------------------------------
	// Bootstrap
	// -----------------------------------------------------------------------

	initMedia();
})();
