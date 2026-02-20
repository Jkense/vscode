/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Handles leapfrog://connect URLs from the web app OAuth callback.
 * Parses token and projectId from the URL and stores them in secret storage.
 */

import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IURLHandler, IOpenURLOptions, IURLService } from '../../../../platform/url/common/url.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { localize } from '../../../../nls.js';

const CLERK_TOKEN_STORAGE_KEY = 'leapfrog.auth.clerkToken';
const PROJECT_ID_STORAGE_KEY = 'leapfrog.project.id';

export class LeapfrogConnectUrlHandler extends Disposable implements IWorkbenchContribution, IURLHandler {

	static readonly ID = 'workbench.contrib.leapfrogConnectUrlHandler';

	constructor(
		@IURLService urlService: IURLService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@ILogService private readonly logService: ILogService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super();
		this._register(urlService.registerHandler(this));
	}

	async handleURL(uri: URI, _options?: IOpenURLOptions): Promise<boolean> {
		// leapfrog://connect?token=...&projectId=... (authority is "connect") or leapfrog:///connect?...
		if (uri.scheme !== 'leapfrog' || (uri.authority !== 'connect' && !uri.path.includes('connect'))) {
			return false;
		}

		const query = uri.query ? Object.fromEntries(new URLSearchParams(uri.query)) : {};
		const token = query.token;
		const projectId = query.projectId;

		if (!token || !projectId) {
			this.logService.warn('[Leapfrog] Connect URL missing token or projectId');
			this.notificationService.warn(localize('leapfrogConnectInvalid', 'Connection failed: invalid response from Leapfrog.'));
			return true; // We handled it (even if invalid)
		}

		try {
			await this.secretStorageService.set(CLERK_TOKEN_STORAGE_KEY, token);
			await this.secretStorageService.set(PROJECT_ID_STORAGE_KEY, projectId);
			this.logService.info('[Leapfrog] Connect successful: token and projectId stored');
			this.notificationService.info(localize('leapfrogConnectSuccess', 'Connected to Leapfrog. You can now use transcription and other features.'));
		} catch (err) {
			this.logService.error('[Leapfrog] Failed to store connect credentials:', err);
			this.notificationService.error(localize('leapfrogConnectStoreFailed', 'Failed to save connection: {0}', String(err)));
		}

		return true;
	}
}

registerWorkbenchContribution2(LeapfrogConnectUrlHandler.ID, LeapfrogConnectUrlHandler, WorkbenchPhase.AfterRestored);
