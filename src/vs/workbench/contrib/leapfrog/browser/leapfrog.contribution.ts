/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Register stub services for disabled features (must be first)
import './services/stubServices.js';

import './media/leapfrog.css';

// Register tag application controller (editor decorations + apply tag command)
import './tagApplicationController.js';

import { localize, localize2 } from '../../../../nls.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from '../../../../platform/configuration/common/configurationRegistry.js';
import { IViewsRegistry, IViewContainersRegistry, Extensions as ViewExtensions, ViewContainerLocation, IViewDescriptor, ViewContainer, IViewDescriptorService } from '../../../common/views.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { KeyMod, KeyCode, KeyChord } from '../../../../base/common/keyCodes.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { IContextKeyService, IContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { ILogService } from '../../../../platform/log/common/log.js';

import { leapfrogConfigurationSchema } from '../common/leapfrogConfiguration.js';
import {
	LEAPFROG_TAGS_VIEWLET_ID,
	LEAPFROG_TAGS_VIEW_ID,
	LEAPFROG_CHAT_VIEWLET_ID,
	LEAPFROG_CHAT_VIEW_ID,
	LeapfrogTagsViewletVisibleContext,
	LeapfrogChatViewVisibleContext,
} from '../common/leapfrog.js';

// Import views
import { LeapfrogTagsView } from './views/tagsView.js';
import { LeapfrogChatView } from './views/chatView.js';

// Register icons
const leapfrogTagsViewIcon = registerIcon('leapfrog-tags-view-icon', Codicon.tag, localize('leapfrogTagsViewIcon', 'View icon of the Leapfrog Tags view.'));
const leapfrogChatViewIcon = registerIcon('leapfrog-chat-view-icon', Codicon.commentDiscussion, localize('leapfrogChatViewIcon', 'View icon of the Leapfrog Chat view.'));

// Register configuration
const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configurationRegistry.registerConfiguration(leapfrogConfigurationSchema);

/**
 * Leapfrog Chat View Pane Container (Auxiliary Bar / Right Sidebar)
 */
export class LeapfrogChatViewPaneContainer extends ViewPaneContainer {

	private chatVisibleContextKey: IContextKey<boolean>;

	constructor(
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IStorageService storageService: IStorageService,
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IThemeService themeService: IThemeService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IExtensionService extensionService: IExtensionService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@ILogService logService: ILogService,
	) {
		super(LEAPFROG_CHAT_VIEWLET_ID, { mergeViewWithContainerWhenSingleView: true }, instantiationService, configurationService, layoutService, contextMenuService, telemetryService, extensionService, themeService, storageService, contextService, viewDescriptorService, logService);

		this.chatVisibleContextKey = LeapfrogChatViewVisibleContext.bindTo(contextKeyService);
	}

	override create(parent: HTMLElement): void {
		super.create(parent);
		parent.classList.add('leapfrog-chat-viewlet');
	}

	override setVisible(visible: boolean): void {
		super.setVisible(visible);
		this.chatVisibleContextKey.set(visible);
	}

	override getTitle(): string {
		return localize('chat', "Chat");
	}
}

/**
 * Leapfrog Tags View Pane Container (Sidebar - standalone activity bar entry)
 */
export class LeapfrogTagsViewPaneContainer extends ViewPaneContainer {

	private tagsViewletVisibleContextKey: IContextKey<boolean>;

	constructor(
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IStorageService storageService: IStorageService,
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IThemeService themeService: IThemeService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IExtensionService extensionService: IExtensionService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@ILogService logService: ILogService,
	) {
		super(LEAPFROG_TAGS_VIEWLET_ID, { mergeViewWithContainerWhenSingleView: true }, instantiationService, configurationService, layoutService, contextMenuService, telemetryService, extensionService, themeService, storageService, contextService, viewDescriptorService, logService);

		this.tagsViewletVisibleContextKey = LeapfrogTagsViewletVisibleContext.bindTo(contextKeyService);
	}

	override create(parent: HTMLElement): void {
		super.create(parent);
		parent.classList.add('leapfrog-tags-viewlet');
	}

	override setVisible(visible: boolean): void {
		super.setVisible(visible);
		this.tagsViewletVisibleContextKey.set(visible);
	}

	override getTitle(): string {
		return localize('tags', "Tags");
	}
}

// Register view containers (after classes are defined)
const viewContainersRegistry = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry);
const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);

/**
 * Chat view container in the auxiliary bar (right sidebar) - replaces Copilot
 */
const CHAT_VIEW_CONTAINER: ViewContainer = viewContainersRegistry.registerViewContainer({
	id: LEAPFROG_CHAT_VIEWLET_ID,
	title: localize2('chat', "Chat"),
	icon: leapfrogChatViewIcon,
	ctorDescriptor: new SyncDescriptor(LeapfrogChatViewPaneContainer),
	storageId: 'workbench.panel.chat.state',
	order: 0,  // Show first in auxiliary bar
	hideIfEmpty: false,
}, ViewContainerLocation.AuxiliaryBar, { isDefault: true });

/**
 * Tags view container in the sidebar (standalone activity bar entry)
 */
const TAGS_VIEW_CONTAINER: ViewContainer = viewContainersRegistry.registerViewContainer({
	id: LEAPFROG_TAGS_VIEWLET_ID,
	title: localize2('tags', "Tags"),
	icon: leapfrogTagsViewIcon,
	ctorDescriptor: new SyncDescriptor(LeapfrogTagsViewPaneContainer),
	storageId: 'workbench.tags.views.state',
	order: 0,  // Tags=0, Explorer=1, Search=2
	hideIfEmpty: false,
	openCommandActionDescriptor: {
		id: 'workbench.view.tags.focus',
		title: localize2('openTags', "Open Tags"),
		keybindings: {
			primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyT,
		},
		order: 1,
	},
}, ViewContainerLocation.Sidebar, { isDefault: false });

/**
 * Contribution that registers Leapfrog views
 */
class LeapfrogViewsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.leapfrogViews';

	constructor() {
		super();
		this.registerViews();
	}

	private registerViews(): void {
		// Tags View (standalone activity bar container)
		const tagsViewDescriptor: IViewDescriptor = {
			id: LEAPFROG_TAGS_VIEW_ID,
			name: localize2('leapfrogTags', "Tags"),
			ctorDescriptor: new SyncDescriptor(LeapfrogTagsView),
			containerIcon: leapfrogTagsViewIcon,
			order: 1,
			canToggleVisibility: false,
			canMoveView: true,
			collapsed: false,
			focusCommand: {
				id: 'workbench.leapfrog.tagsView.focus',
				keybindings: { primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyCode.KeyT) }
			}
		};

		viewsRegistry.registerViews([tagsViewDescriptor], TAGS_VIEW_CONTAINER);

		// Register chat view in auxiliary bar
		const chatViewDescriptor: IViewDescriptor = {
			id: LEAPFROG_CHAT_VIEW_ID,
			name: localize2('chat', "Chat"),
			ctorDescriptor: new SyncDescriptor(LeapfrogChatView),
			containerIcon: leapfrogChatViewIcon,
			order: 1,
			canToggleVisibility: false,
			canMoveView: true,
			openCommandActionDescriptor: {
				id: 'workbench.action.chat.open',
				title: localize2('openChat', "Open Chat"),
				keybindings: {
					primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyI  // Standard VS Code chat shortcut
				},
				order: 1
			}
		};

		viewsRegistry.registerViews([chatViewDescriptor], CHAT_VIEW_CONTAINER);
	}
}

/**
 * Storage key for pinned view containers in activity bar
 */
const PINNED_VIEW_CONTAINERS_KEY = 'workbench.activity.pinnedViewlets2';
const LEAPFROG_INITIALIZED_KEY = 'leapfrog.activityBarInitialized.v3';

/**
 * View containers to show in Leapfrog (research-focused)
 */
const VISIBLE_VIEW_CONTAINERS = [
	'workbench.view.tags',          // Tags (codebook)
	'workbench.view.explorer',      // File Explorer
	'workbench.view.search',        // Search
];

/**
 * View containers to hide by default (developer-focused)
 */
const HIDDEN_VIEW_CONTAINERS = [
	'workbench.view.leapfrog',      // Removed Leapfrog sidebar (projects handled elsewhere)
	'workbench.view.scm',           // Source Control
	'workbench.view.debug',         // Run and Debug
	'workbench.view.extensions',    // Extensions
	'workbench.view.remote',        // Remote Explorer
	'workbench.view.testing',       // Testing
];

interface IPinnedViewContainer {
	id: string;
	pinned: boolean;
	visible: boolean;
	order?: number;
}

/**
 * Contribution that configures the Activity Bar for qualitative research
 */
class LeapfrogActivityBarContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.leapfrogActivityBar';

	constructor(
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();

		// Only initialize once per profile
		const isInitialized = this.storageService.getBoolean(LEAPFROG_INITIALIZED_KEY, StorageScope.PROFILE, false);

		if (!isInitialized) {
			this.initializeActivityBar();
			this.storageService.store(LEAPFROG_INITIALIZED_KEY, true, StorageScope.PROFILE, StorageTarget.USER);
		}
	}

	private initializeActivityBar(): void {
		// Get current pinned view containers or start fresh
		const currentValue = this.storageService.get(PINNED_VIEW_CONTAINERS_KEY, StorageScope.PROFILE, '[]');
		let pinnedContainers: IPinnedViewContainer[];

		try {
			pinnedContainers = JSON.parse(currentValue);
		} catch {
			pinnedContainers = [];
		}

		// Create a map for easy lookup
		const containerMap = new Map<string, IPinnedViewContainer>();
		for (const container of pinnedContainers) {
			containerMap.set(container.id, container);
		}

		// Ensure visible containers are shown
		let order = 0;
		for (const id of VISIBLE_VIEW_CONTAINERS) {
			if (containerMap.has(id)) {
				const container = containerMap.get(id)!;
				container.visible = true;
				container.pinned = true;
				container.order = order++;
			} else {
				containerMap.set(id, { id, visible: true, pinned: true, order: order++ });
			}
		}

		// Hide developer-focused containers
		for (const id of HIDDEN_VIEW_CONTAINERS) {
			if (containerMap.has(id)) {
				const container = containerMap.get(id)!;
				container.visible = false;
				container.pinned = false;
			} else {
				containerMap.set(id, { id, visible: false, pinned: false });
			}
		}

		// Save the updated configuration
		const newPinnedContainers = Array.from(containerMap.values());
		this.storageService.store(
			PINNED_VIEW_CONTAINERS_KEY,
			JSON.stringify(newPinnedContainers),
			StorageScope.PROFILE,
			StorageTarget.USER
		);
	}
}

// Register contributions
registerWorkbenchContribution2(LeapfrogViewsContribution.ID, LeapfrogViewsContribution, WorkbenchPhase.BlockStartup);
registerWorkbenchContribution2(LeapfrogActivityBarContribution.ID, LeapfrogActivityBarContribution, WorkbenchPhase.BlockRestore);
