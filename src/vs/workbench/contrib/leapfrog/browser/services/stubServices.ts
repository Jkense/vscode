/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Stub services for disabled features in Leapfrog.
 * These provide no-op implementations for services that are required by core
 * components but whose full implementations were disabled.
 */

import { Event, Emitter } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../../platform/instantiation/common/extensions.js';
import {
	IExtensionHostDebugService,
	IReloadSessionEvent,
	ICloseSessionEvent,
	IAttachSessionEvent,
	ITerminateSessionEvent,
	IOpenExtensionWindowResult
} from '../../../../../platform/debug/common/extensionHostDebug.js';

/**
 * Stub implementation of IExtensionHostDebugService.
 * Provides no-op methods since debug functionality is disabled in Leapfrog.
 */
export class StubExtensionHostDebugService extends Disposable implements IExtensionHostDebugService {
	declare readonly _serviceBrand: undefined;

	private readonly _onReload = this._register(new Emitter<IReloadSessionEvent>());
	readonly onReload: Event<IReloadSessionEvent> = this._onReload.event;

	private readonly _onClose = this._register(new Emitter<ICloseSessionEvent>());
	readonly onClose: Event<ICloseSessionEvent> = this._onClose.event;

	private readonly _onAttachSession = this._register(new Emitter<IAttachSessionEvent>());
	readonly onAttachSession: Event<IAttachSessionEvent> = this._onAttachSession.event;

	private readonly _onTerminateSession = this._register(new Emitter<ITerminateSessionEvent>());
	readonly onTerminateSession: Event<ITerminateSessionEvent> = this._onTerminateSession.event;

	reload(_sessionId: string): void {
		// No-op - debug disabled
	}

	close(_sessionId: string): void {
		// No-op - debug disabled
	}

	attachSession(_sessionId: string, _port: number, _subId?: string): void {
		// No-op - debug disabled
	}

	terminateSession(_sessionId: string, _subId?: string): void {
		// No-op - debug disabled
	}

	async openExtensionDevelopmentHostWindow(_args: string[], _debugRenderer: boolean): Promise<IOpenExtensionWindowResult> {
		// No-op - debug disabled
		return { success: false };
	}

	async attachToCurrentWindowRenderer(_windowId: number): Promise<IOpenExtensionWindowResult> {
		// No-op - debug disabled
		return { success: false };
	}
}

// Register the stub service
registerSingleton(IExtensionHostDebugService, StubExtensionHostDebugService, InstantiationType.Delayed);
