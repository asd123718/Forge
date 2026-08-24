/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from '../../../../../base/common/path.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	deepSeekCredentialsPath,
	deepSeekHarnessRoots,
	grokBuildBinaryCandidates,
	hasDeepSeekWorkerCredentials,
	hasGrokWorkerCredentials,
	readDeepSeekApiKeyFromCredentials,
} from '../../../node/orchestration/workerRuntime.js';
import { resolveDeepSeekCommand, resolveGrokCommand } from '../../../node/orchestration/workerAdapters.js';

suite('Forge worker runtime', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('discovers harness roots under repo and user home', () => {
		const roots = deepSeekHarnessRoots('/app/resources/app');
		assert.ok(roots.some(root => root.includes('deepseek-harness-master')));
		assert.ok(roots.some(root => root.includes('.forge')));
	});

	test('discovers grok binary candidates under repo and user home', () => {
		const roots = grokBuildBinaryCandidates('/app/resources/app');
		assert.ok(roots.some(root => root.includes('grok-build-main')));
		assert.ok(roots.some(root => root.includes('.forge')));
	});

	test('reads deepseek credentials from the harness yaml file', () => {
		const home = mkdtempSync(join(tmpdir(), 'forge-dsh-'));
		try {
			const path = deepSeekCredentialsPath(home);
			mkdirSync(join(path, '..'), { recursive: true });
			writeFileSync(path, 'DEEPSEEK_API_KEY: "from-file"\n', 'utf8');
			assert.strictEqual(readDeepSeekApiKeyFromCredentials(home), 'from-file');
			assert.strictEqual(hasDeepSeekWorkerCredentials({}, home), true);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test('signed-in flags alone do not count as worker credentials', () => {
		const env = { FORGE_DEEPSEEK_SIGNED_IN: '1', FORGE_GROK_SIGNED_IN: '1' } as NodeJS.ProcessEnv;
		assert.strictEqual(hasDeepSeekWorkerCredentials(env), false);
		assert.strictEqual(hasGrokWorkerCredentials(env), false);
		assert.strictEqual(resolveDeepSeekCommand('/missing-root', env), undefined);
		assert.strictEqual(resolveGrokCommand('/missing-root', env), undefined);
	});
});
