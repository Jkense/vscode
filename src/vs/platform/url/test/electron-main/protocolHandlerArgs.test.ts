/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { getWindowsProtocolHandlerArgs } from '../../electron-main/protocolHandlerArgs.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('protocolHandlerArgs', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	suite('getWindowsProtocolHandlerArgs', () => {

		test('returns empty array when portable', () => {
			const args = getWindowsProtocolHandlerArgs({
				isBuilt: true,
				isPortable: true,
				appRoot: '/app',
				userDataPath: '/data',
			});
			assert.deepStrictEqual(args, []);
		});

		test('includes --user-data-dir so protocol links open in same instance', () => {
			const args = getWindowsProtocolHandlerArgs({
				isBuilt: true,
				isPortable: false,
				appRoot: '/app',
				userDataPath: '/custom/user-data',
			});
			const userDataDirIndex = args.indexOf('--user-data-dir');
			assert.ok(userDataDirIndex >= 0, 'should include --user-data-dir');
			assert.strictEqual(args[userDataDirIndex + 1], '/custom/user-data');
		});

		test('includes --open-url and -- for protocol handler identification', () => {
			const args = getWindowsProtocolHandlerArgs({
				isBuilt: true,
				isPortable: false,
				appRoot: '/app',
				userDataPath: '/data',
			});
			assert.ok(args.includes('--open-url'), 'should include --open-url');
			assert.ok(args.includes('--'), 'should include --');
		});

		test('includes app root in dev mode (isBuilt: false)', () => {
			const args = getWindowsProtocolHandlerArgs({
				isBuilt: false,
				isPortable: false,
				appRoot: 'C:\\app\\vscode',
				userDataPath: 'C:\\Users\\test\\.vscode-oss-dev',
			});
			assert.ok(args.some(a => a.includes('vscode')), 'should include app root in dev mode');
		});

		test('full args order: appRoot (dev), --user-data-dir, path, --open-url, --', () => {
			const args = getWindowsProtocolHandlerArgs({
				isBuilt: false,
				isPortable: false,
				appRoot: '/app',
				userDataPath: '/user-data',
			});
			const expected = ['"/app"', '--user-data-dir', '/user-data', '--open-url', '--'];
			assert.deepStrictEqual(args, expected);
		});
	});
});
