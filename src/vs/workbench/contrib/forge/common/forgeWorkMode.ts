/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const FORGE_WORK_MODE_SETTING_ID = 'forge.workMode';

export type ForgeWorkMode = 'logos' | 'dialectic';

export function readForgeWorkMode(value: unknown): ForgeWorkMode {
	return value === 'dialectic' ? 'dialectic' : 'logos';
}
