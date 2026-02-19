/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Leapfrog project config - stores projectId for backend sync.
 * Read/write from .leapfrog/config.json
 */

import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { joinPath } from '../../../../base/common/resources.js';

const CONFIG_FILENAME = 'config.json';

export interface ILeapfrogProjectConfig {
	projectId?: string;
}

export class LeapfrogProjectConfig {

	constructor(private readonly fileService: IFileService) { }

	async getProjectId(projectPath: string): Promise<string | undefined> {
		try {
			const config = await this.loadConfig(projectPath);
			return config.projectId;
		} catch {
			return undefined;
		}
	}

	async setProjectId(projectPath: string, projectId: string): Promise<void> {
		const config: ILeapfrogProjectConfig = await this.loadConfig(projectPath).catch(() => ({}));
		config.projectId = projectId;
		await this.saveConfig(projectPath, config);
	}

	private async loadConfig(projectPath: string): Promise<ILeapfrogProjectConfig> {
		const configUri = this.getConfigUri(projectPath);
		const content = await this.fileService.readFile(configUri);
		return JSON.parse(content.value.toString()) as ILeapfrogProjectConfig;
	}

	private async saveConfig(projectPath: string, config: ILeapfrogProjectConfig): Promise<void> {
		const projectUri = URI.file(projectPath);
		const leapfrogDir = joinPath(projectUri, '.leapfrog');
		const configUri = joinPath(leapfrogDir, CONFIG_FILENAME);

		try {
			await this.fileService.createFolder(leapfrogDir);
		} catch {
			// Folder may already exist
		}

		await this.fileService.writeFile(configUri, VSBuffer.fromString(JSON.stringify(config, null, '\t')));
	}

	private getConfigUri(projectPath: string): URI {
		const projectUri = URI.file(projectPath);
		const leapfrogDir = joinPath(projectUri, '.leapfrog');
		return joinPath(leapfrogDir, CONFIG_FILENAME);
	}
}
