/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { LeapfrogSettingsEditorInput } from './leapfrogSettingsEditorInput.js';

suite('LeapfrogSettingsEditorInput', () => {

	test('typeId returns correct ID', () => {
		const input = new LeapfrogSettingsEditorInput();
		assert.strictEqual(input.typeId, 'leapfrog.input.settings');
	});

	test('getName returns "Leapfrog Settings"', () => {
		const input = new LeapfrogSettingsEditorInput();
		assert.strictEqual(input.getName(), 'Leapfrog Settings');
	});

	test('resource URI has correct scheme and path', () => {
		const input = new LeapfrogSettingsEditorInput();
		assert.strictEqual(input.resource.scheme, 'leapfrog-settings');
		assert.strictEqual(input.resource.path, 'leapfrog-settings-editor');
	});

	test('two instances are equal by matches()', () => {
		const input1 = new LeapfrogSettingsEditorInput();
		const input2 = new LeapfrogSettingsEditorInput();
		assert.strictEqual(input1.matches(input2), true);
	});

	test('matches() returns false for different input type', () => {
		const input1 = new LeapfrogSettingsEditorInput();
		const input2 = { typeId: 'other.input' } as any;
		assert.strictEqual(input1.matches(input2), false);
	});

	test('getIcon returns settingsGear icon', () => {
		const input = new LeapfrogSettingsEditorInput();
		const icon = input.getIcon();
		assert.ok(icon);
		assert.strictEqual(icon.id, 'settingsGear');
	});

	test('resolve() returns null', async () => {
		const input = new LeapfrogSettingsEditorInput();
		const result = await input.resolve();
		assert.strictEqual(result, null);
	});

});
