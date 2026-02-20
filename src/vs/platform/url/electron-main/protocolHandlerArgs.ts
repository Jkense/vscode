/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Builds the command-line arguments passed to the executable when registering
 * as a protocol handler on Windows. Including --user-data-dir ensures protocol
 * links (e.g. leapfrog://connect) open in the SAME instance, avoiding a second
 * window when the app uses a custom userDataDir (e.g. debugger with userDataDir).
 */

export interface IProtocolHandlerArgsOptions {
	readonly isBuilt: boolean;
	readonly isPortable: boolean;
	readonly appRoot: string;
	readonly userDataPath: string;
}

/**
 * Returns the args array for setAsDefaultProtocolClient on Windows.
 * Empty array when portable (caller should skip registration).
 */
export function getWindowsProtocolHandlerArgs(options: IProtocolHandlerArgsOptions): string[] {
	if (options.isPortable) {
		return [];
	}
	const args = options.isBuilt ? [] : [`"${options.appRoot}"`];
	// Pass --user-data-dir so protocol links open in the SAME instance
	args.push('--user-data-dir', options.userDataPath);
	args.push('--open-url', '--');
	return args;
}
