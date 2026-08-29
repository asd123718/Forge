/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { ForgeDiagnosticsLog, redactForgeDiagnosticValue } from '../../node/forgeDiagnosticsLog.js';

suite('ForgeDiagnosticsLog', () => {
	test('redacts secret keys recursively', () => {
		assert.deepStrictEqual(redactForgeDiagnosticValue({ token: 'visible-nope', nested: { apiKey: 'also-nope', value: 'safe' } }), {
			token: '<redacted>',
			nested: { apiKey: '<redacted>', value: 'safe' },
		});
	});

	test('redacts common credentials embedded in text', () => {
		const result = redactForgeDiagnosticValue('Authorization: Bearer abcdefghijklmnop and sk-abcdefghijklmnop api_key="plain-key"');
		assert.strictEqual(result, 'Authorization: <redacted> and <redacted> api_key=<redacted>');
	});

	test('preserves normal user and agent content', () => {
		const text = '请修改 src/main.ts，并运行 npm test。';
		assert.strictEqual(redactForgeDiagnosticValue(text), text);
	});

	test('replaces large base64 payloads with compact metadata', () => {
		const encoded = Buffer.alloc(1_024, 7).toString('base64');
		const result = String(redactForgeDiagnosticValue(encoded));
		assert.match(result, /^<base64 omitted chars=\d+ sha256=[a-f0-9]{64}>$/);
	});

	test('writes separated text logs and coalesces streamed content', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'forge-diagnostics-'));
		const log = new ForgeDiagnosticsLog(URI.file(directory), 'test');
		try {
			log.recordText('chat', 'USER', 'hello sk-abcdefghijklmnop', { turn: 'turn-1' });
			log.recordStream('chat', 'turn-1:assistant', 'ASSISTANT', 'hel', { turn: 'turn-1' });
			log.recordStream('chat', 'turn-1:assistant', 'ASSISTANT', 'lo', { turn: 'turn-1' });
			log.recordLatestText('files', 'turn-1:diff', 'UNIFIED-DIFF', 'obsolete diff', { turn: 'turn-1' });
			log.recordLatestText('files', 'turn-1:diff', 'UNIFIED-DIFF', 'latest diff', { turn: 'turn-1' });
			await log.flush();
			const content = await readFile(join(directory, '20-chat.txt'), 'utf8');
			const files = await readFile(join(directory, '50-files.txt'), 'utf8');
			assert.ok(content.includes('@@BEGIN USER'));
			assert.ok(content.includes('hello <redacted>'));
			assert.ok(content.includes('@@BEGIN ASSISTANT'));
			assert.ok(content.includes('\nhello\n'));
			assert.strictEqual(content.includes('sk-abcdefghijklmnop'), false);
			assert.ok(files.includes('latest diff'));
			assert.strictEqual(files.includes('obsolete diff'), false);
		} finally {
			log.dispose();
			await log.flush();
			await rm(directory, { recursive: true, force: true });
		}
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
