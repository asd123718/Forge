/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import { join } from '../../../../../base/common/path.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { prepareForgeCodexHome, resolveForgeCodexHome } from '../../../node/codex/codexHome.js';

suite('Forge Codex home', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function createUserHome(): string {
		const userHome = fs.mkdtempSync(join(os.tmpdir(), 'forge-codex-home-'));
		disposables.add(toDisposable(() => fs.rmSync(userHome, { recursive: true, force: true })));
		return userHome;
	}

	test('uses a Forge-owned home unless explicitly overridden', () => {
		const userHome = createUserHome();
		assert.deepStrictEqual({
			defaultHome: resolveForgeCodexHome(userHome, undefined),
			override: resolveForgeCodexHome(userHome, join(userHome, 'custom')),
		}, {
			defaultHome: join(userHome, '.forge', 'codex'),
			override: join(userHome, 'custom'),
		});
	});

	test('migrates auth and config once without copying versioned cache', () => {
		const userHome = createUserHome();
		const legacyHome = join(userHome, '.codex');
		fs.mkdirSync(legacyHome);
		fs.writeFileSync(join(legacyHome, 'auth.json'), 'auth-v1');
		fs.writeFileSync(join(legacyHome, 'config.toml'), 'config-v1');
		fs.writeFileSync(join(legacyHome, 'models_cache.json'), 'incompatible-cache');
		const migrated: string[] = [];

		const codexHome = prepareForgeCodexHome(userHome, undefined, fileName => migrated.push(fileName));
		fs.writeFileSync(join(legacyHome, 'auth.json'), 'auth-v2');
		prepareForgeCodexHome(userHome, undefined, fileName => migrated.push(fileName));

		assert.deepStrictEqual({
			codexHome,
			migrated,
			auth: fs.readFileSync(join(codexHome, 'auth.json'), 'utf8'),
			config: fs.readFileSync(join(codexHome, 'config.toml'), 'utf8'),
			cacheCopied: fs.existsSync(join(codexHome, 'models_cache.json')),
		}, {
			codexHome: join(userHome, '.forge', 'codex'),
			migrated: ['auth.json', 'config.toml'],
			auth: 'auth-v1',
			config: 'config-v1',
			cacheCopied: false,
		});
	});
});
