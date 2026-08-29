/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { createForgeLogSessionName, formatForgeLocalTimestamp, isForgeLogSessionName } from '../../common/forgeLogSession.js';

suite('Forge log session', () => {
	test('creates a detailed Windows-safe local session name', () => {
		const date = new Date(2026, 7, 29, 18, 31, 2, 347);
		const name = createForgeLogSessionName(date, 'Asia/Shanghai');
		assert.match(name, /^2026-08-29_18-31-02\.347_UTC[+-]\d{2}-\d{2}_Asia-Shanghai_run-[a-z0-9]+$/);
		assert.strictEqual(isForgeLogSessionName(name), true);
		assert.strictEqual(name.includes(':'), false);
	});

	test('formats 24-hour timestamps with offset and zone', () => {
		const date = new Date(2026, 7, 29, 8, 9, 7, 6);
		assert.match(formatForgeLocalTimestamp(date, 'Asia/Shanghai'), /^2026-08-29 08:09:07\.006 [+-]\d{2}:\d{2} Asia\/Shanghai$/);
	});

	test('retains recognition of historical Code - OSS sessions', () => {
		assert.strictEqual(isForgeLogSessionName('20260829T183102'), true);
		assert.strictEqual(isForgeLogSessionName('not-a-log-session'), false);
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
