/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { join } from '../../../../base/common/path.js';

const FORGE_CODEX_HOME_DIRECTORY = '.forge';
const FORGE_CODEX_HOME_NAME = 'codex';
const MIGRATED_CODEX_FILES = ['auth.json', 'config.toml'] as const;

/**
 * Resolves Forge's Codex home. An explicit override remains authoritative;
 * otherwise Forge uses its own directory and never shares versioned caches
 * or databases with another Codex client.
 */
export function resolveForgeCodexHome(userHome: string, configuredHome: string | undefined): string {
	return configuredHome || join(userHome, FORGE_CODEX_HOME_DIRECTORY, FORGE_CODEX_HOME_NAME);
}

/**
 * Creates Forge's isolated Codex home and performs a conservative one-time
 * migration of portable user configuration. Versioned caches, sessions, and
 * databases are deliberately not copied because their schemas belong to the
 * Codex binary that created them.
 */
export function prepareForgeCodexHome(
	userHome: string,
	configuredHome: string | undefined,
	onMigrated?: (fileName: string) => void,
): string {
	const codexHome = resolveForgeCodexHome(userHome, configuredHome);
	if (configuredHome) {
		return codexHome;
	}

	fs.mkdirSync(codexHome, { recursive: true });
	const legacyHome = join(userHome, '.codex');
	for (const fileName of MIGRATED_CODEX_FILES) {
		const source = join(legacyHome, fileName);
		const target = join(codexHome, fileName);
		if (!fs.existsSync(source) || fs.existsSync(target)) {
			continue;
		}
		try {
			fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
			onMigrated?.(fileName);
		} catch (error) {
			const code = error instanceof Error && 'code' in error ? error.code : undefined;
			if (code !== 'EEXIST') {
				throw error;
			}
		}
	}
	return codexHome;
}
