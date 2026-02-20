/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Leapfrog project config - stores projectId for backend sync.
 * Read/write from .leapfrog/config.json
 * Project ID is auto-generated from workspace path when not present.
 */

import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { joinPath } from '../../../../base/common/resources.js';

const CONFIG_FILENAME = 'config.json';

export interface ILeapfrogProjectConfig {
	projectId?: string;
}

/**
 * Derive a stable project ID from workspace path.
 * Uses first 12 chars of SHA-256 hash for cross-machine consistency.
 */
async function deriveProjectIdFromPath(projectPath: string): Promise<string> {
	const normalized = projectPath.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
	const encoder = new TextEncoder();
	const data = encoder.encode(normalized);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
	return 'lf-' + hashHex.slice(0, 12);
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

	/**
	 * Get or auto-create project ID. If not in config, derives from path and saves.
	 */
	async getOrCreateProjectId(projectPath: string): Promise<string> {
		const existing = await this.getProjectId(projectPath);
		if (existing) {
			return existing;
		}
		const projectId = await deriveProjectIdFromPath(projectPath);
		await this.setProjectId(projectPath, projectId);
		return projectId;
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
