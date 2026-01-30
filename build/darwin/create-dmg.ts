/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import { spawn } from '@malept/cross-spawn-promise';

const root = path.dirname(path.dirname(import.meta.dirname));
const product = JSON.parse(fs.readFileSync(path.join(root, 'product.json'), 'utf8'));

const DMGBUILD_REPO = 'https://github.com/dmgbuild/dmgbuild.git';
const DMGBUILD_COMMIT = '75c8a6c7835c5b73dfd4510d92a8f357f93a5fbf';

function getDmgBuildPath(): string {
	return path.join(import.meta.dirname, '.dmgbuild');
}

function getVenvPath(): string {
	return path.join(getDmgBuildPath(), 'venv');
}

function getPythonPath(): string {
	return path.join(getVenvPath(), 'bin', 'python3');
}

async function ensureDmgBuild(): Promise<void> {
	const dmgBuildPath = getDmgBuildPath();
	const venvPath = getVenvPath();
	const markerFile = path.join(dmgBuildPath, '.installed');
	if (fs.existsSync(markerFile)) {
		console.log('dmgbuild already installed, skipping setup');
		return;
	}

	console.log('Setting up dmgbuild from GitHub...');
	if (fs.existsSync(dmgBuildPath)) {
		fs.rmSync(dmgBuildPath, { recursive: true });
	}

	console.log(`Cloning dmgbuild from ${DMGBUILD_REPO} at ${DMGBUILD_COMMIT}...`);
	await spawn('git', ['clone', '--depth', '1', '--branch', DMGBUILD_COMMIT, DMGBUILD_REPO, dmgBuildPath], {
		stdio: 'inherit'
	});

	console.log('Creating Python virtual environment...');
	await spawn('python3', ['-m', 'venv', venvPath], {
		stdio: 'inherit'
	});

	console.log('Installing dmgbuild dependencies...');
	const pipPath = path.join(venvPath, 'bin', 'pip');
	await spawn(pipPath, ['install', '-e', dmgBuildPath], {
		stdio: 'inherit'
	});

	fs.writeFileSync(markerFile, `Installed at ${new Date().toISOString()}\nCommit: ${DMGBUILD_COMMIT}\n`);
	console.log('dmgbuild setup complete');
}

async function runDmgBuild(settingsFile: string, volumeName: string, artifactPath: string): Promise<void> {
	await ensureDmgBuild();

	const pythonPath = getPythonPath();
	await spawn(pythonPath, ['-m', 'dmgbuild', '-s', settingsFile, volumeName, artifactPath], {
		stdio: 'inherit'
	});
}

async function main(buildDir?: string, outDir?: string): Promise<void> {
	const arch = process.env['VSCODE_ARCH'];
	const quality = process.env['VSCODE_QUALITY'];

	if (!buildDir) {
		throw new Error('Build directory argument is required');
	}

	if (!arch) {
		throw new Error('$VSCODE_ARCH not set');
	}

	if (!outDir) {
		throw new Error('Output directory argument is required');
	}

	const appRoot = path.join(buildDir, `VSCode-darwin-${arch}`);
	const appName = product.nameLong + '.app';
	const appPath = path.join(appRoot, appName);
	const dmgName = `VSCode-darwin-${arch}`;
	const artifactPath = path.join(outDir, `${dmgName}.dmg`);
	const backgroundPath = path.join(import.meta.dirname, `dmg-background-${quality}.tiff`);
	const diskIconPath = path.join(root, 'resources', 'darwin', 'code.icns');
	let title = 'Code OSS';
	switch (quality) {
		case 'stable':
			title = 'VS Code';
			break;
		case 'insider':
			title = 'VS Code Insiders';
			break;
		case 'exploration':
			title = 'VS Code Exploration';
			break;
	}

	if (!fs.existsSync(appPath)) {
		throw new Error(`App path does not exist: ${appPath}`);
	}

	console.log(`Creating DMG for ${product.nameLong}...`);
	console.log(`  App path: ${appPath}`);
	console.log(`  Output directory: ${outDir}`);
	console.log(`  DMG name: ${dmgName}`);

	if (fs.existsSync(artifactPath)) {
		fs.unlinkSync(artifactPath);
	}

	// Generate Python settings file for dmgbuild
	const settingsFile = path.join(outDir, '.dmg-settings.py');
	const settingsContent = `
volume_name = ${JSON.stringify(title)}
format = 'ULMO'
badge_icon = ${JSON.stringify(diskIconPath)}
background = ${JSON.stringify(backgroundPath)}

# Volume size (None = auto-calculate)
size = None

# Files and symlinks
files = [${JSON.stringify(appPath)}]
symlinks = {
	'Applications': '/Applications'
}

# Window settings
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
sidebar_width = 180

# Window position and size
window_rect = ((100, 400), (480, 352))

# Icon view settings
default_view = 'icon-view'
icon_locations = {
	${JSON.stringify(product.nameLong + '.app')}: (120, 160),
	'Applications': (360, 160)
}

# Text size for icon labels
text_size = 12
icon_size = 80
`;
	fs.writeFileSync(settingsFile, settingsContent);

	try {
		await runDmgBuild(settingsFile, dmgName, artifactPath);
	} finally {
		if (fs.existsSync(settingsFile)) {
			fs.unlinkSync(settingsFile);
		}
	}

	if (!fs.existsSync(artifactPath)) {
		throw new Error(`DMG was not created at expected path: ${artifactPath}`);
	}

	const stats = fs.statSync(artifactPath);
	console.log(`Successfully created DMG: ${artifactPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
}

if (import.meta.main) {
	main(process.argv[2], process.argv[3]).catch(err => {
		console.error('Failed to create DMG:', err);
		process.exit(1);
	});
}
