/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getNLSLanguage } from '../../../nls.js';

export type ForgeDisplayLanguage = 'en' | 'zh-cn';

export const FORGE_DISPLAY_LANGUAGE_STORAGE_KEY = 'forge.displayLanguage';
export const FORGE_LANGUAGE_PACK_EXTENSION_ID = 'forge.forge-language-pack-zh-hans';

let override: ForgeDisplayLanguage | undefined;

export function setForgeDisplayLanguageOverride(locale: ForgeDisplayLanguage | undefined): void {
	override = locale;
}

export function getForgeDisplayLanguage(): ForgeDisplayLanguage {
	if (override === 'en' || override === 'zh-cn') {
		return override;
	}
	const language = (getNLSLanguage() ?? '').toLowerCase();
	return language === 'zh-cn' || language === 'zh-hans' || language.startsWith('zh') ? 'zh-cn' : 'en';
}

export function isForgeChineseLocale(): boolean {
	return getForgeDisplayLanguage() === 'zh-cn';
}

function format(message: string, args: readonly (string | number | boolean | undefined | null)[]): string {
	if (args.length === 0) {
		return message;
	}
	return message.replace(/\{(\d+)\}/g, (match, index) => {
		const arg = args[Number(index)];
		return arg === undefined || arg === null ? match : String(arg);
	});
}

/**
 * Codex settings strings that must switch immediately between English and
 * Chinese. Do not call `localize()` with a variable key here: the desktop NLS
 * bundler only accepts string-literal keys.
 */
export function forgeLocalize(_key: string, english: string, chinese: string, ...args: (string | number | boolean | undefined | null)[]): string {
	return format(isForgeChineseLocale() ? chinese : english, args);
}
