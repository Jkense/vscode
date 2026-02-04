/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../../nls.js';
import { IViewletViewOptions } from '../../../../browser/parts/views/viewsViewlet.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ViewPane, IViewPaneOptions } from '../../../../browser/parts/views/viewPane.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../../common/views.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { ILocalizedString } from '../../../../../platform/action/common/action.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { $, append } from '../../../../../base/browser/dom.js';
import { LEAPFROG_PROJECTS_VIEW_ID } from '../../common/leapfrog.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { URI } from '../../../../../base/common/uri.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';

export class LeapfrogProjectsView extends ViewPane {

	static readonly ID: string = LEAPFROG_PROJECTS_VIEW_ID;
	static readonly NAME: ILocalizedString = nls.localize2('leapfrogProjects', "Projects");

	constructor(
		options: IViewletViewOptions,
		@IThemeService themeService: IThemeService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IOpenerService openerService: IOpenerService,
		@IHoverService hoverService: IHoverService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ICommandService private readonly commandService: ICommandService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IFileService private readonly fileService: IFileService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super(options as IViewPaneOptions, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	override shouldShowWelcome(): boolean {
		// Show welcome content when no workspace is open
		return this.workspaceContextService.getWorkspace().folders.length === 0;
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		container.classList.add('leapfrog-projects-view');

		// Check if we have an open workspace
		const hasWorkspace = this.workspaceContextService.getWorkspace().folders.length > 0;

		if (hasWorkspace) {
			this.renderProjectInfo(container);
		} else {
			this.renderWelcome(container);
		}
	}

	private renderWelcome(container: HTMLElement): void {
		// Create welcome message
		const welcomeContainer = append(container, $('.leapfrog-projects-welcome'));

		const icon = append(welcomeContainer, $('.leapfrog-welcome-icon'));
		// allow-any-unicode-next-line
		icon.textContent = '🐸';

		const title = append(welcomeContainer, $('h3'));
		title.textContent = nls.localize('leapfrogProjectsWelcome', "Welcome to Leapfrog");

		const description = append(welcomeContainer, $('p'));
		description.textContent = nls.localize('leapfrogProjectsDescription', "Create or open a qualitative research project to get started.");

		// Create button container
		const buttonContainer = append(welcomeContainer, $('.leapfrog-projects-buttons'));

		// New Project button
		const newProjectButton = append(buttonContainer, $('button.monaco-button'));
		newProjectButton.textContent = nls.localize('leapfrogNewProject', "New Project");
		newProjectButton.onclick = () => this.createNewProject();

		// Open Project button
		const openProjectButton = append(buttonContainer, $('button.monaco-button.secondary'));
		openProjectButton.textContent = nls.localize('leapfrogOpenProject', "Open Project");
		openProjectButton.onclick = () => this.openProject();

		// Recent projects section
		const recentContainer = append(welcomeContainer, $('.leapfrog-recent-projects'));
		const recentTitle = append(recentContainer, $('h4'));
		recentTitle.textContent = nls.localize('leapfrogRecentProjects', "Recent Projects");

		const recentList = append(recentContainer, $('ul.leapfrog-recent-list'));
		// TODO: Populate with actual recent projects from storage
		const emptyItem = append(recentList, $('li.empty'));
		emptyItem.textContent = nls.localize('leapfrogNoRecentProjects', "No recent projects");
	}

	private renderProjectInfo(container: HTMLElement): void {
		const workspace = this.workspaceContextService.getWorkspace();
		const folder = workspace.folders[0];

		const projectContainer = append(container, $('.leapfrog-project-info'));

		const header = append(projectContainer, $('.leapfrog-project-header'));

		const icon = append(header, $('.leapfrog-project-icon'));
		// allow-any-unicode-next-line
		icon.textContent = '📁';

		const name = append(header, $('h3.leapfrog-project-name'));
		name.textContent = folder.name;

		const path = append(projectContainer, $('p.leapfrog-project-path'));
		path.textContent = folder.uri.fsPath;

		// Project actions
		const actionsContainer = append(projectContainer, $('.leapfrog-project-actions'));

		const closeButton = append(actionsContainer, $('button.monaco-button.secondary'));
		closeButton.textContent = nls.localize('leapfrogCloseProject', "Close Project");
		closeButton.onclick = () => this.closeProject();

		const openAnotherButton = append(actionsContainer, $('button.monaco-button.secondary'));
		openAnotherButton.textContent = nls.localize('leapfrogOpenAnother', "Open Another");
		openAnotherButton.onclick = () => this.openProject();

		// Project stats placeholder
		const statsContainer = append(projectContainer, $('.leapfrog-project-stats'));

		const statsTitle = append(statsContainer, $('h4'));
		statsTitle.textContent = nls.localize('leapfrogProjectStats', "Project Statistics");

		const statsList = append(statsContainer, $('ul'));

		const stats = [
			{ label: 'Files', value: '0' },
			{ label: 'Transcripts', value: '0' },
			{ label: 'Tags', value: '0' },
			{ label: 'Coded Segments', value: '0' },
		];

		for (const stat of stats) {
			const item = append(statsList, $('li'));
			const label = append(item, $('span.stat-label'));
			label.textContent = stat.label + ':';
			const value = append(item, $('span.stat-value'));
			value.textContent = stat.value;
		}
	}

	private async createNewProject(): Promise<void> {
		// Step 1: Get project name
		const projectName = await this.quickInputService.input({
			prompt: nls.localize('leapfrogProjectNamePrompt', "Enter a name for your new project"),
			placeHolder: nls.localize('leapfrogProjectNamePlaceholder', "My Research Project"),
			validateInput: async (value) => {
				if (!value || value.trim().length === 0) {
					return nls.localize('leapfrogProjectNameRequired', "Project name is required");
				}
				// Check for invalid filename characters
				if (/[<>:"/\\|?*]/.test(value)) {
					return nls.localize('leapfrogProjectNameInvalid', "Project name contains invalid characters");
				}
				return null;
			}
		});

		if (!projectName) {
			return; // User cancelled
		}

		// Step 2: Pick folder location
		const folderUri = await this.fileDialogService.showOpenDialog({
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			title: nls.localize('leapfrogSelectProjectLocation', "Select location for new project"),
			openLabel: nls.localize('leapfrogSelectFolder', "Select Folder")
		});

		if (!folderUri || folderUri.length === 0) {
			return; // User cancelled
		}

		// Step 3: Create project folder
		const parentFolder = folderUri[0];
		const projectFolderUri = URI.joinPath(parentFolder, projectName.trim());

		try {
			// Check if folder already exists
			const exists = await this.fileService.exists(projectFolderUri);
			if (exists) {
				this.notificationService.error(nls.localize('leapfrogProjectExists', "A folder with this name already exists. Please choose a different name."));
				return;
			}

			// Create the project folder
			await this.fileService.createFolder(projectFolderUri);

			// Create initial project structure
			await this.createProjectStructure(projectFolderUri, projectName.trim());

			// Open the project folder
			await this.commandService.executeCommand('vscode.openFolder', projectFolderUri, { forceNewWindow: false });

			this.notificationService.info(nls.localize('leapfrogProjectCreated', "Project '{0}' created successfully!", projectName.trim()));

		} catch (error) {
			this.notificationService.error(nls.localize('leapfrogProjectCreateError', "Failed to create project: {0}", String(error)));
		}
	}

	private async createProjectStructure(projectUri: URI, projectName: string): Promise<void> {
		// Create subdirectories
		const directories = ['transcripts', 'media', 'exports', 'notes'];
		for (const dir of directories) {
			await this.fileService.createFolder(URI.joinPath(projectUri, dir));
		}

		// Create project config file
		const configContent = JSON.stringify({
			name: projectName,
			version: '1.0.0',
			created: new Date().toISOString(),
			leapfrog: {
				version: '1.0.0'
			}
		}, null, 2);

		await this.fileService.writeFile(
			URI.joinPath(projectUri, 'leapfrog.json'),
			VSBuffer.fromString(configContent)
		);

		// Create README
		const readmeContent = `# ${projectName}\n\nA qualitative research project created with Leapfrog.\n\n## Folders\n\n- **transcripts/** - Interview and focus group transcripts\n- **media/** - Audio and video files\n- **exports/** - Exported reports and data\n- **notes/** - Research notes and memos\n`;

		await this.fileService.writeFile(
			URI.joinPath(projectUri, 'README.md'),
			VSBuffer.fromString(readmeContent)
		);
	}

	private async openProject(): Promise<void> {
		// Use the built-in open folder command
		await this.commandService.executeCommand('workbench.action.files.openFolder');
	}

	private async closeProject(): Promise<void> {
		// Close the current folder/workspace
		await this.commandService.executeCommand('workbench.action.closeFolder');
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}
