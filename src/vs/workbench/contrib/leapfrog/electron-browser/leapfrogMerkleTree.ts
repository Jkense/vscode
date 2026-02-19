/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Merkle tree computation for change detection.
 * Enables incremental sync by identifying only changed files.
 */

import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { joinPath } from '../../../../base/common/resources.js';
import { VSBuffer } from '../../../../base/common/buffer.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MerkleFileInfo {
	path: string;
	content: string;
}

export interface MerkleTreeNode {
	path: string;
	hash: string;
	children?: MerkleTreeNode[];
	isFile?: boolean;
}

export interface MerkleTree {
	rootHash: string;
	nodes: Record<string, MerkleTreeNode>;
	fileHashes: Record<string, string>;
	createdAt: string;
}

export interface ChangedFile {
	path: string;
	changeType: 'added' | 'modified' | 'removed';
	hash?: string;
}

// ---------------------------------------------------------------------------
// Merkle Tree Service
// ---------------------------------------------------------------------------

const MERKLE_FILENAME = 'merkle.json';

export class LeapfrogMerkleTree {

	constructor(private readonly fileService: IFileService) { }

	/**
	 * Compute SHA-256 hash of file content.
	 */
	async computeFileHash(content: string): Promise<string> {
		const encoder = new TextEncoder();
		const data = encoder.encode(content);
		const hashBuffer = await crypto.subtle.digest('SHA-256', data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
	}

	private async hashString(input: string): Promise<string> {
		const encoder = new TextEncoder();
		const data = encoder.encode(input);
		const hashBuffer = await crypto.subtle.digest('SHA-256', data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
	}

	/**
	 * Build Merkle tree from file list.
	 * File-level hashes, then root hash from sorted file hashes.
	 */
	async buildMerkleTree(files: MerkleFileInfo[]): Promise<MerkleTree> {
		const fileHashes: Record<string, string> = {};
		const nodes: Record<string, MerkleTreeNode> = {};

		// Phase 1: Compute file hashes
		for (const file of files) {
			const hash = await this.computeFileHash(file.content);
			fileHashes[file.path] = hash;
			nodes[file.path] = { path: file.path, hash, isFile: true };
		}

		// Phase 2: Compute root hash from sorted path:hash pairs (deterministic)
		const sortedEntries = Object.entries(fileHashes).sort(([a], [b]) => a.localeCompare(b));
		const combined = sortedEntries.map(([path, hash]) => `${path}:${hash}`).join('|');
		const rootHash = await this.hashString(combined || 'empty');

		return {
			rootHash,
			nodes,
			fileHashes,
			createdAt: new Date().toISOString(),
		};
	}

	/**
	 * Build Merkle tree with relative paths for sync (cross-machine consistency).
	 */
	async buildMerkleTreeForSync(projectPath: string, files: MerkleFileInfo[]): Promise<MerkleTree> {
		const normalizedProject = projectPath.replace(/\\/g, '/').replace(/\/$/, '');
		const toRelative = (p: string) => {
			const n = p.replace(/\\/g, '/');
			return n.startsWith(normalizedProject + '/') ? n.slice(normalizedProject.length + 1) : p;
		};
		const relFiles: MerkleFileInfo[] = files.map(f => ({ path: toRelative(f.path), content: f.content }));
		return this.buildMerkleTree(relFiles);
	}

	/**
	 * Build Merkle tree from file hashes with path conversion to relative.
	 */
	async buildMerkleTreeFromHashes(projectPath: string, fileHashes: Record<string, string>): Promise<MerkleTree> {
		const normalizedProject = projectPath.replace(/\\/g, '/').replace(/\/$/, '');
		const toRelative = (p: string) => {
			const n = p.replace(/\\/g, '/');
			return n.startsWith(normalizedProject + '/') ? n.slice(normalizedProject.length + 1) : p;
		};
		const relHashes: Record<string, string> = {};
		for (const [path, hash] of Object.entries(fileHashes)) {
			relHashes[toRelative(path)] = hash;
		}
		const sortedEntries = Object.entries(relHashes).sort(([a], [b]) => a.localeCompare(b));
		const combined = sortedEntries.map(([path, hash]) => `${path}:${hash}`).join('|');
		const rootHash = await this.hashString(combined || 'empty');
		const nodes: Record<string, { path: string; hash: string; isFile?: boolean }> = {};
		for (const [path, hash] of Object.entries(relHashes)) {
			nodes[path] = { path, hash, isFile: true };
		}
		return {
			rootHash,
			nodes,
			fileHashes: relHashes,
			createdAt: new Date().toISOString(),
		};
	}

	/**
	 * Get root hash from tree (for quick comparison).
	 */
	getRootHash(tree: MerkleTree): string {
		return tree.rootHash;
	}

	/**
	 * Compare two Merkle trees and return list of changed files.
	 */
	compareTrees(local: MerkleTree, remote: MerkleTree | null): ChangedFile[] {
		const changed: ChangedFile[] = [];

		if (!remote) {
			// No remote tree - all files are "added"
			for (const [path, hash] of Object.entries(local.fileHashes)) {
				changed.push({ path, changeType: 'added', hash });
			}
			return changed;
		}

		const localPaths = new Set(Object.keys(local.fileHashes));
		const remotePaths = new Set(Object.keys(remote.fileHashes));

		// Added or modified
		for (const path of localPaths) {
			const localHash = local.fileHashes[path];
			const remoteHash = remote.fileHashes[path];
			if (!remoteHash) {
				changed.push({ path, changeType: 'added', hash: localHash });
			} else if (localHash !== remoteHash) {
				changed.push({ path, changeType: 'modified', hash: localHash });
			}
		}

		// Removed
		for (const path of remotePaths) {
			if (!localPaths.has(path)) {
				changed.push({ path, changeType: 'removed' });
			}
		}

		return changed;
	}

	/**
	 * Load Merkle tree from .leapfrog/merkle.json
	 */
	async loadMerkleTree(projectPath: string): Promise<MerkleTree | null> {
		const projectUri = URI.file(projectPath);
		const leapfrogDir = joinPath(projectUri, '.leapfrog');
		const merkleUri = joinPath(leapfrogDir, MERKLE_FILENAME);

		try {
			const content = await this.fileService.readFile(merkleUri);
			return JSON.parse(content.value.toString()) as MerkleTree;
		} catch {
			return null;
		}
	}

	/**
	 * Save Merkle tree to .leapfrog/merkle.json
	 */
	async saveMerkleTree(projectPath: string, tree: MerkleTree): Promise<void> {
		const projectUri = URI.file(projectPath);
		const leapfrogDir = joinPath(projectUri, '.leapfrog');
		const merkleUri = joinPath(leapfrogDir, MERKLE_FILENAME);

		try {
			await this.fileService.createFolder(leapfrogDir);
		} catch {
			// Folder may already exist
		}

		const json = JSON.stringify(tree, null, '\t');
		await this.fileService.writeFile(merkleUri, VSBuffer.fromString(json));
	}
}
