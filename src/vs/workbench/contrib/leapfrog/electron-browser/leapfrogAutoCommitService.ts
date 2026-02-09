/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Automatically commits .leapfrog/ changes to git after a debounce delay.
 *
 * Commit messages are prefixed with `[leapfrog]` and aggregate descriptions
 * of all changes that occurred within the debounce window.
 */

import { Disposable } from '../../../../base/common/lifecycle.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILeapfrogAutoCommitService } from '../common/leapfrog.js';
import { LeapfrogConfigurationKeys } from '../common/leapfrogConfiguration.js';

export class LeapfrogAutoCommitService extends Disposable implements ILeapfrogAutoCommitService {

	declare readonly _serviceBrand: undefined;

	private workspacePath: string | undefined;
	private _enabled = false;
	private pendingDescriptions: string[] = [];

	private readonly commitScheduler: RunOnceScheduler;

	get enabled(): boolean {
		return this._enabled;
	}

	constructor(
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();

		const delay = this.configurationService.getValue<number>(LeapfrogConfigurationKeys.GitAutoCommitDelay) ?? 5000;
		this.commitScheduler = this._register(new RunOnceScheduler(() => {
			this.commitNow().catch(err => {
				this.logService.error('[Leapfrog] Auto-commit failed', err);
			});
		}, delay));
	}

	async initialize(workspacePath: string): Promise<void> {
		this.workspacePath = workspacePath;

		const settingEnabled = this.configurationService.getValue<boolean>(LeapfrogConfigurationKeys.GitAutoCommit) ?? true;
		if (!settingEnabled) {
			this.logService.info('[Leapfrog] Auto-commit disabled by setting');
			this._enabled = false;
			return;
		}

		// Verify git is available and workspace is a git repo
		try {
			await this.execGit(['rev-parse', '--git-dir']);
			this._enabled = true;
			this.logService.info('[Leapfrog] Auto-commit enabled for', workspacePath);
		} catch {
			this._enabled = false;
			this.logService.info('[Leapfrog] Auto-commit disabled: not a git repo or git not available');
		}
	}

	notifyChange(description: string): void {
		if (!this._enabled) {
			return;
		}
		this.pendingDescriptions.push(description);
		this.commitScheduler.schedule();
	}

	async commitNow(): Promise<void> {
		if (!this._enabled || !this.workspacePath || this.pendingDescriptions.length === 0) {
			return;
		}

		const descriptions = this.pendingDescriptions.splice(0);
		const message = `[leapfrog] ${descriptions.join('; ')}`;

		try {
			// Stage .leapfrog/ changes
			await this.execGit(['add', '.leapfrog/']);

			// Check if there are actually staged changes
			try {
				await this.execGit(['diff', '--cached', '--quiet']);
				// Exit code 0 means no changes - nothing to commit
				this.logService.info('[Leapfrog] No staged changes to commit');
				return;
			} catch {
				// Exit code 1 means there are changes - proceed with commit
			}

			await this.execGit(['commit', '-m', message]);
			this.logService.info('[Leapfrog] Auto-committed:', message);
		} catch (err) {
			this.logService.error('[Leapfrog] Auto-commit error:', err);
			// Re-queue descriptions so they aren't lost
			this.pendingDescriptions.unshift(...descriptions);
		}
	}

	private execGit(args: string[]): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			try {
				// Use require at runtime to access child_process
				const cp = require('child_process');
				cp.execFile('git', args, { cwd: this.workspacePath }, (error: Error | null, stdout: string, stderr: string) => {
					if (error) {
						reject(new Error(stderr || error.message));
					} else {
						resolve(stdout.trim());
					}
				});
			} catch (err) {
				reject(new Error(`Failed to execute git: ${err}`));
			}
		});
	}
}
