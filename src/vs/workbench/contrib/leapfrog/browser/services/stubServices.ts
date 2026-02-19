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
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { URI } from '../../../../../base/common/uri.js';
import {
	IExtensionsWorkbenchService,
	IExtension,
	IExtensionsNotification,
	InstallExtensionOptions,
	AutoUpdateConfigurationValue
} from '../../../extensions/common/extensions.js';
import type { IExtensionManagementServer } from '../../../../services/extensionManagement/common/extensionManagement.js';
import type { IExtensionInfo, IExtensionQueryOptions, IQueryOptions } from '../../../../../platform/extensionManagement/common/extensionManagement.js';
import type { IPager } from '../../../../../base/common/paging.js';
import type { IExtensionEditorOptions } from '../../../extensions/common/extensionsInput.js';
import { IInlineChatSessionService } from '../../../inlineChat/browser/inlineChatSessionService.js';
import type { IActiveCodeEditor, ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';

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

/**
 * Stub implementation of IExtensionsWorkbenchService.
 * Extensions are disabled in Leapfrog; this stub allows Settings UI and other
 * components that depend on it to instantiate without errors.
 */
class StubExtensionsWorkbenchService extends Disposable implements IExtensionsWorkbenchService {
	declare readonly _serviceBrand: undefined;

	private readonly _onChange = this._register(new Emitter<IExtension | undefined>());
	readonly onChange: Event<IExtension | undefined> = this._onChange.event;

	private readonly _onReset = this._register(new Emitter<void>());
	readonly onReset: Event<void> = this._onReset.event;

	private readonly _onDidChangeExtensionsNotification = this._register(new Emitter<IExtensionsNotification | undefined>());
	readonly onDidChangeExtensionsNotification: Event<IExtensionsNotification | undefined> = this._onDidChangeExtensionsNotification.event;

	readonly local: IExtension[] = [];
	readonly installed: IExtension[] = [];
	readonly outdated: IExtension[] = [];
	readonly whenInitialized: Promise<void> = Promise.resolve();

	async queryLocal(_server?: IExtensionManagementServer): Promise<IExtension[]> {
		return [];
	}

	async queryGallery(_optionsOrToken: IQueryOptions | CancellationToken, _token?: CancellationToken): Promise<IPager<IExtension>> {
		return this._emptyPager();
	}

	async getExtensions(_extensionInfos: IExtensionInfo[], _optionsOrToken: IExtensionQueryOptions | CancellationToken, _token?: CancellationToken): Promise<IExtension[]> {
		return [];
	}

	async getResourceExtensions(_locations: URI[], _isWorkspaceScoped: boolean): Promise<IExtension[]> {
		return [];
	}

	async canInstall(_extension: IExtension): Promise<true> {
		return true;
	}

	async install(_idOrVsixOrExtension: string | URI | IExtension, _installOptions?: InstallExtensionOptions, _progressLocation?: unknown): Promise<IExtension> {
		throw new Error('Extensions are disabled in Leapfrog');
	}

	async installInServer(): Promise<void> {
		// No-op
	}

	async downloadVSIX(): Promise<void> {
		// No-op
	}

	async uninstall(): Promise<void> {
		// No-op
	}

	async togglePreRelease(): Promise<void> {
		// No-op
	}

	canSetLanguage(): boolean {
		return false;
	}

	async setLanguage(): Promise<void> {
		// No-op
	}

	async setEnablement(): Promise<void> {
		// No-op
	}

	isAutoUpdateEnabledFor(): boolean {
		return false;
	}

	async updateAutoUpdateEnablementFor(): Promise<void> {
		// No-op
	}

	async shouldRequireConsentToUpdate(): Promise<undefined> {
		return undefined;
	}

	async updateAutoUpdateForAllExtensions(): Promise<void> {
		// No-op
	}

	async open(_extension: IExtension | string, _options?: IExtensionEditorOptions): Promise<void> {
		// No-op
	}

	async openSearch(_searchValue: string, _focus?: boolean): Promise<void> {
		// No-op
	}

	getAutoUpdateValue(): AutoUpdateConfigurationValue {
		return false;
	}

	async checkForUpdates(): Promise<void> {
		// No-op
	}

	getExtensionRuntimeStatus(): undefined {
		return undefined;
	}

	async updateAll(): Promise<never[]> {
		return [];
	}

	async updateRunningExtensions(): Promise<void> {
		// No-op
	}

	getExtensionsNotification(): undefined {
		return undefined;
	}

	isExtensionIgnoredToSync(): boolean {
		return false;
	}

	async toggleExtensionIgnoredToSync(): Promise<void> {
		// No-op
	}

	async toggleApplyExtensionToAllProfiles(): Promise<void> {
		// No-op
	}

	private _emptyPager(): IPager<IExtension> {
		return {
			firstPage: [],
			total: 0,
			pageSize: 0,
			getPage: async () => []
		};
	}
}

/**
 * Stub implementation of IInlineChatSessionService.
 * Inline chat is disabled in Leapfrog; this stub allows EmptyTextEditorHintContribution
 * and EmptyCellEditorHintContribution to instantiate without errors.
 */
class StubInlineChatSessionService extends Disposable implements IInlineChatSessionService {
	declare readonly _serviceBrand: undefined;

	private readonly _onWillStartSession = this._register(new Emitter<IActiveCodeEditor>());
	readonly onWillStartSession: Event<IActiveCodeEditor> = this._onWillStartSession.event;

	private readonly _onDidChangeSessions = this._register(new Emitter<this>());
	readonly onDidChangeSessions = this._onDidChangeSessions.event;

	getSessionByTextModel(_uri: URI): undefined {
		return undefined;
	}

	getSessionBySessionUri(_uri: URI): undefined {
		return undefined;
	}

	createSession(_editor: ICodeEditor): never {
		throw new Error('Inline chat is disabled in Leapfrog');
	}
}

// Register stub services
registerSingleton(IExtensionHostDebugService, StubExtensionHostDebugService, InstantiationType.Delayed);
registerSingleton(IExtensionsWorkbenchService, StubExtensionsWorkbenchService, InstantiationType.Eager);
registerSingleton(IInlineChatSessionService, StubInlineChatSessionService, InstantiationType.Delayed);
