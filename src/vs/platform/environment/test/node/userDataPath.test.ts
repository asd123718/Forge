/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { OPTIONS, parseArgs } from '../../node/argv.js';
import { getUserDataPath } from '../../node/userDataPath.js';
import product from '../../../product/common/product.js';

suite('User data path', () => {

	test('getUserDataPath - default', () => {
		const path = getUserDataPath(parseArgs(process.argv, OPTIONS), product.nameShort);
		assert.ok(path.length > 0);
	});

	test('getUserDataPath - portable mode', () => {
		const origPortable = process.env['VSCODE_PORTABLE'];
		try {
			const portableDir = 'portable-dir';
			process.env['VSCODE_PORTABLE'] = portableDir;

			const path = getUserDataPath(parseArgs(process.argv, OPTIONS), product.nameShort);
			assert.ok(path.includes(portableDir));
		} finally {
			if (typeof origPortable === 'string') {
				process.env['VSCODE_PORTABLE'] = origPortable;
			} else {
				delete process.env['VSCODE_PORTABLE'];
			}
		}
	});

	test('getUserDataPath - --user-data-dir', () => {
		const cliUserDataDir = 'cli-data-dir';
		const args = parseArgs(process.argv, OPTIONS);
		args['user-data-dir'] = cliUserDataDir;

		const path = getUserDataPath(args, product.nameShort);
		assert.ok(path.includes(cliUserDataDir));
	});

	test('getUserDataPath - VSCODE_APPDATA', () => {
		const origAppData = process.env['VSCODE_APPDATA'];
		try {
			const appDataDir = 'appdata-dir';
			process.env['VSCODE_APPDATA'] = appDataDir;

			const path = getUserDataPath(parseArgs(process.argv, OPTIONS), product.nameShort);
			assert.ok(path.includes(appDataDir));
		} finally {
			if (typeof origAppData === 'string') {
				process.env['VSCODE_APPDATA'] = origAppData;
			} else {
				delete process.env['VSCODE_APPDATA'];
			}
		}
	});

	test('getUserDataPath - VSCODE_DEV shares the shipped product folder', () => {
		const origDev = process.env['VSCODE_DEV'];
		const origAppData = process.env['VSCODE_APPDATA'];
		const origPortable = process.env['VSCODE_PORTABLE'];
		try {
			delete process.env['VSCODE_PORTABLE'];
			process.env['VSCODE_DEV'] = '1';
			process.env['VSCODE_APPDATA'] = 'appdata-dir';

			const fromWindowTitle = getUserDataPath(parseArgs(process.argv, OPTIONS), 'Forge Dev');
			const fromShippedName = getUserDataPath(parseArgs(process.argv, OPTIONS), 'Forge');
			assert.ok(/[\\/]Forge$/.test(fromWindowTitle), fromWindowTitle);
			assert.ok(/[\\/]Forge$/.test(fromShippedName), fromShippedName);
			assert.ok(fromWindowTitle.includes('appdata-dir'));
			assert.ok(!fromWindowTitle.toLowerCase().includes('code-oss-dev'));
		} finally {
			if (typeof origDev === 'string') {
				process.env['VSCODE_DEV'] = origDev;
			} else {
				delete process.env['VSCODE_DEV'];
			}
			if (typeof origAppData === 'string') {
				process.env['VSCODE_APPDATA'] = origAppData;
			} else {
				delete process.env['VSCODE_APPDATA'];
			}
			if (typeof origPortable === 'string') {
				process.env['VSCODE_PORTABLE'] = origPortable;
			} else {
				delete process.env['VSCODE_PORTABLE'];
			}
		}
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
