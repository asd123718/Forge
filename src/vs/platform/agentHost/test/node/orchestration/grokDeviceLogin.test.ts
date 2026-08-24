/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from '../../../../../base/common/path.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { decodeJwtClaims, grokAuthPath, grokAuthScope, grokLoginUrl, grokNetworkErrorMessage, pollGrokDeviceToken, requestGrokDeviceCode, writeGrokOidcAuth } from '../../../node/orchestration/grokDeviceLogin.js';

suite('Grok device login helpers', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('decodes email and subject from a JWT payload', () => {
		const payload = Buffer.from(JSON.stringify({ sub: 'user-1', email: 'a@x.ai' })).toString('base64url');
		assert.deepStrictEqual(decodeJwtClaims(`hdr.${payload}.sig`), { sub: 'user-1', email: 'a@x.ai' });
	});

	test('parses a device-code response from a mock fetch', async () => {
		const fetchImpl = async () => new Response(JSON.stringify({
			device_code: 'dev-1',
			user_code: 'ABCD-EFGH',
			verification_uri: 'https://auth.x.ai/device',
			verification_uri_complete: 'https://auth.x.ai/device?user_code=ABCD-EFGH',
			expires_in: 600,
			interval: 5,
		}), { status: 200 });
		const device = await requestGrokDeviceCode(fetchImpl);
		assert.strictEqual(device.userCode, 'ABCD-EFGH');
		assert.strictEqual(grokLoginUrl(device), 'https://auth.x.ai/device?user_code=ABCD-EFGH');
	});

	test('polls until an access token is returned', async () => {
		let calls = 0;
		const fetchImpl = async () => {
			calls += 1;
			if (calls === 1) {
				return new Response(JSON.stringify({ error: 'authorization_pending' }), { status: 400 });
			}
			return new Response(JSON.stringify({ access_token: 'tok', id_token: 'id' }), { status: 200 });
		};
		const tokens = await pollGrokDeviceToken(fetchImpl, {
			deviceCode: 'dev-1',
			userCode: 'ABCD-EFGH',
			verificationUri: 'https://auth.x.ai/device',
			intervalSec: 0,
			expiresInSec: 60,
		}, new AbortController().signal);
		assert.strictEqual(tokens.accessToken, 'tok');
		assert.strictEqual(calls, 2);
	});

	test('maps network failures to a Chinese retry hint', () => {
		assert.ok(grokNetworkErrorMessage(new TypeError('fetch failed')).includes('API 密钥'));
	});

	test('writes an oidc auth.json entry without dropping other scopes', () => {
		const home = mkdtempSync(join(tmpdir(), 'forge-grok-auth-'));
		const previous = process.env.GROK_HOME;
		delete process.env.GROK_HOME;
		try {
			mkdirSync(join(home, '.grok'), { recursive: true });
			writeFileSync(join(home, '.grok', 'auth.json'), JSON.stringify({ other: { key: 'keep' } }), 'utf8');
			const payload = Buffer.from(JSON.stringify({ email: 'b@x.ai', sub: 'u2' })).toString('base64url');
			writeGrokOidcAuth(home, { accessToken: 'token-b', idToken: `h.${payload}.s` });
			const saved = JSON.parse(readFileSync(grokAuthPath(home), 'utf8')) as Record<string, { key: string; email?: string }>;
			assert.strictEqual(saved.other.key, 'keep');
			assert.strictEqual(saved[grokAuthScope()].key, 'token-b');
			assert.strictEqual(saved[grokAuthScope()].email, 'b@x.ai');
		} finally {
			if (previous === undefined) {
				delete process.env.GROK_HOME;
			} else {
				process.env.GROK_HOME = previous;
			}
		}
	});
});
