/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Utils } from 'vscode-uri';
import { BinarySizeStatusBarEntry } from './binarySizeStatusBarEntry';
import { MediaPreview, PreviewState, reopenAsText } from './mediaPreview';
import { escapeAttribute } from './util/dom';

// ---------------------------------------------------------------------------
// Sidecar transcript types (persisted as .transcript.json)
// ---------------------------------------------------------------------------

export interface SidecarTranscript {
	id: string;
	status: 'pending' | 'processing' | 'completed' | 'error';
	duration?: number;
	text?: string;
	error?: string;
	segments: SidecarSegment[];
	speakers: SidecarSpeaker[];
}

export interface SidecarSegment {
	id: string;
	speakerId?: string;
	text: string;
	startTime: number;
	endTime: number;
	confidence?: number;
	sentiment?: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
	sentimentConfidence?: number;
	words?: SidecarWord[];
}

export interface SidecarWord {
	text: string;
	startTime: number;
	endTime: number;
	confidence?: number;
}

export interface SidecarSpeaker {
	id: string;
	name: string;
	color?: string;
}

// ---------------------------------------------------------------------------
// Transcript Media Preview -- shared base for audio and video
// ---------------------------------------------------------------------------

export abstract class TranscriptMediaPreview extends MediaPreview {

	private transcriptId: string | undefined;
	private pollingTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		protected readonly extensionRoot: vscode.Uri,
		resource: vscode.Uri,
		webviewEditor: vscode.WebviewPanel,
		binarySizeStatusBarEntry: BinarySizeStatusBarEntry,
	) {
		super(extensionRoot, resource, webviewEditor, binarySizeStatusBarEntry);

		this._register(webviewEditor.webview.onDidReceiveMessage(message => {
			this.handleMessage(message);
		}));

		this.updateBinarySize();
		this.render();
		this.updateState();

		// Attempt to load existing sidecar transcript
		this.loadSidecar();
	}

	public override dispose() {
		if (this.pollingTimer) {
			clearTimeout(this.pollingTimer);
		}
		super.dispose();
	}

	// -----------------------------------------------------------------------
	// Message handling
	// -----------------------------------------------------------------------

	private async handleMessage(message: { type: string;[key: string]: unknown }): Promise<void> {
		switch (message.type) {
			case 'reopen-as-text':
				reopenAsText(this._resource, this._webviewEditor.viewColumn);
				break;

			case 'start-transcription':
				await this.startTranscription();
				break;

			case 'check-status':
				if (this.transcriptId) {
					await this.checkStatus();
				}
				break;

			case 'rename-speaker': {
				const { transcriptId, speakerId, newName } = message as {
					type: string; transcriptId: string; speakerId: string; newName: string;
				};
				await this.renameSpeaker(transcriptId, speakerId, newName);
				break;
			}
		}
	}

	// -----------------------------------------------------------------------
	// Transcription workflow
	// -----------------------------------------------------------------------

	private async startTranscription(): Promise<void> {
		try {
			const resourceUri = this._webviewEditor.webview.asWebviewUri(this._resource).toString();

			// Use the file path for local files, URI for remote
			const filePath = this._resource.scheme === 'file'
				? this._resource.fsPath
				: resourceUri;

			const result = await vscode.commands.executeCommand<{ transcriptId: string; status: string }>(
				'leapfrog.transcribe', filePath,
			);

			if (result) {
				this.transcriptId = result.transcriptId;
				this.postMessage({
					type: 'transcript-status',
					status: 'processing',
					transcriptId: result.transcriptId,
				});
				this.startPolling();
			}
		} catch (err) {
			this.postMessage({
				type: 'transcript-error',
				error: err instanceof Error ? err.message : 'Failed to start transcription',
			});
		}
	}

	private startPolling(): void {
		if (this.pollingTimer) {
			clearTimeout(this.pollingTimer);
		}

		const poll = async () => {
			if (this.previewState === PreviewState.Disposed || !this.transcriptId) {
				return;
			}

			try {
				await this.checkStatus();
			} catch {
				// Ignore polling errors
			}

			// Continue polling if still processing
			if (this.transcriptId) {
				this.pollingTimer = setTimeout(poll, 3000);
			}
		};

		this.pollingTimer = setTimeout(poll, 3000);
	}

	private async checkStatus(): Promise<void> {
		if (!this.transcriptId) {
			return;
		}

		try {
			const transcript = await vscode.commands.executeCommand<SidecarTranscript>(
				'leapfrog.getTranscriptStatus', this.transcriptId,
			);

			if (!transcript) {
				return;
			}

			if (transcript.status === 'completed') {
				// Stop polling
				this.transcriptId = undefined;

				// Save sidecar file
				await this.saveSidecar(transcript);

				this.postMessage({
					type: 'transcript-ready',
					transcript,
				});
			} else if (transcript.status === 'error') {
				this.transcriptId = undefined;
				this.postMessage({
					type: 'transcript-error',
					error: transcript.error ?? 'Transcription failed',
				});
			} else {
				this.postMessage({
					type: 'transcript-status',
					status: transcript.status,
					transcriptId: this.transcriptId,
				});
			}
		} catch (err) {
			// Don't clear transcriptId on transient errors
			this.postMessage({
				type: 'transcript-error',
				error: err instanceof Error ? err.message : 'Failed to check status',
			});
		}
	}

	private async renameSpeaker(transcriptId: string, speakerId: string, newName: string): Promise<void> {
		try {
			await vscode.commands.executeCommand('leapfrog.renameSpeaker', transcriptId, speakerId, newName);

			// Also update the sidecar file
			const sidecar = await this.readSidecar();
			if (sidecar) {
				const speaker = sidecar.speakers.find(s => s.id === speakerId);
				if (speaker) {
					speaker.name = newName;
					await this.saveSidecar(sidecar);
				}
			}

			this.postMessage({
				type: 'speaker-renamed',
				speakerId,
				newName,
			});
		} catch (err) {
			this.postMessage({
				type: 'transcript-error',
				error: err instanceof Error ? err.message : 'Failed to rename speaker',
			});
		}
	}

	// -----------------------------------------------------------------------
	// Sidecar file I/O
	// -----------------------------------------------------------------------

	private getSidecarUri(): vscode.Uri {
		const dir = Utils.dirname(this._resource);
		const basename = Utils.basename(this._resource);
		return Utils.joinPath(dir, `${basename}.transcript.json`);
	}

	private async loadSidecar(): Promise<void> {
		const sidecar = await this.readSidecar();
		if (sidecar && sidecar.status === 'completed') {
			this.postMessage({
				type: 'transcript-ready',
				transcript: sidecar,
			});
		}
	}

	private async readSidecar(): Promise<SidecarTranscript | undefined> {
		try {
			const uri = this.getSidecarUri();
			const data = await vscode.workspace.fs.readFile(uri);
			const text = Buffer.from(data).toString('utf-8');
			return JSON.parse(text) as SidecarTranscript;
		} catch {
			return undefined;
		}
	}

	private async saveSidecar(transcript: SidecarTranscript): Promise<void> {
		try {
			const uri = this.getSidecarUri();
			const json = JSON.stringify(transcript, null, 2);
			await vscode.workspace.fs.writeFile(uri, Buffer.from(json, 'utf-8'));
		} catch (err) {
			// Non-fatal: sidecar save failure should not block the UI
		}
	}

	// -----------------------------------------------------------------------
	// Webview helpers
	// -----------------------------------------------------------------------

	protected postMessage(message: unknown): void {
		if (this.previewState !== PreviewState.Disposed) {
			this._webviewEditor.webview.postMessage(message);
		}
	}

	protected extensionResource(...parts: string[]): vscode.Uri {
		return this._webviewEditor.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionRoot, ...parts));
	}

	protected async getResourcePath(webviewEditor: vscode.WebviewPanel, resource: vscode.Uri, version: string): Promise<string | null> {
		if (resource.scheme === 'git') {
			const stat = await vscode.workspace.fs.stat(resource);
			if (stat.size === 0) {
				return null;
			}
		}

		if (resource.query) {
			return webviewEditor.webview.asWebviewUri(resource).toString();
		}
		return webviewEditor.webview.asWebviewUri(resource).with({ query: `version=${version}` }).toString();
	}

	protected getTranscriptSettings(): Record<string, unknown> {
		const config = vscode.workspace.getConfiguration('leapfrog.transcript');
		return {
			autoScroll: config.get<boolean>('autoScroll', true),
			showTimestamps: config.get<boolean>('showTimestamps', true),
			showConfidence: config.get<boolean>('showConfidence', false),
			showSentiment: config.get<boolean>('showSentiment', true),
			wordHighlight: config.get<boolean>('wordHighlight', true),
		};
	}

	protected buildTranscriptHtml(
		mediaTag: 'audio' | 'video',
		mediaSrc: string | null,
		nonce: string,
		cspSource: string,
		extraSettings?: Record<string, unknown>,
	): string {
		const settings = {
			src: mediaSrc,
			mediaType: mediaTag,
			...this.getTranscriptSettings(),
			...extraSettings,
		};

		return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport"
		content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no">
	<title>Media Preview</title>
	<link rel="stylesheet" href="${escapeAttribute(this.extensionResource('media', 'transcriptPreview.css'))}" type="text/css" media="screen" nonce="${nonce}">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: ${cspSource}; media-src ${cspSource}; script-src 'nonce-${nonce}'; style-src ${cspSource} 'nonce-${nonce}';">
	<meta id="settings" data-settings="${escapeAttribute(JSON.stringify(settings))}">
</head>
<body class="container loading" data-vscode-context='{ "preventDefaultContextMenuItems": true }'>
	<div class="loading-indicator"></div>
	<div class="loading-error">
		<p>${vscode.l10n.t('An error occurred while loading the media file.')}</p>
		<a href="#" class="open-file-link">${vscode.l10n.t("Open file using VS Code's standard text/binary editor?")}</a>
	</div>
	<div id="media-container"></div>
	<div id="transcript-container">
		<div class="transcript-header">
			<span class="transcript-title">${vscode.l10n.t('Transcript')}</span>
			<button id="order-transcript-btn" class="transcript-btn">${vscode.l10n.t('Order Transcript')}</button>
		</div>
		<div id="transcript-status" class="transcript-status hidden"></div>
		<div id="transcript-segments" class="transcript-segments"></div>
	</div>
	<script src="${escapeAttribute(this.extensionResource('media', 'transcriptPreview.js'))}" nonce="${nonce}"></script>
</body>
</html>`;
	}
}
