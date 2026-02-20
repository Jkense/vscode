/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import * as nls from '../../../../nls.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';

const LeapfrogSettingsIcon = registerIcon('leapfrog-settings-editor-label-icon', Codicon.settingsGear, nls.localize('leapfrogSettingsEditorLabelIcon', 'Icon of the Leapfrog Settings editor label.'));

export class LeapfrogSettingsEditorInput extends EditorInput {

	static readonly ID: string = 'leapfrog.input.settings';

	readonly resource: URI = URI.from({
		scheme: 'leapfrog-settings',
		path: 'leapfrog-settings-editor'
	});

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		return super.matches(otherInput) || otherInput instanceof LeapfrogSettingsEditorInput;
	}

	override get typeId(): string {
		return LeapfrogSettingsEditorInput.ID;
	}

	override getName(): string {
		return nls.localize('leapfrogSettingsInputName', "Leapfrog Settings");
	}

	override getIcon(): ThemeIcon {
		return LeapfrogSettingsIcon;
	}

	override async resolve(): Promise<null> {
		return null;
	}
}
