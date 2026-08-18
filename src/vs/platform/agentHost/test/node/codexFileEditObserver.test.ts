/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { applyUnifiedDiff, invertUnifiedDiff, parseGitTurnDiff, previewFileChange, shellCommandFileCandidates } from '../../node/codex/codexFileEditObserver.js';

suite('CodexFileEditObserver', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('previews streamed add and delete changes', () => {
		assert.strictEqual(previewFileChange('', {
			path: 'new.txt',
			kind: { type: 'add' },
			diff: 'one\ntwo\n',
		}), 'one\ntwo\n');
		assert.strictEqual(previewFileChange('old\n', {
			path: 'old.txt',
			kind: { type: 'delete' },
			diff: 'old\n',
		}), '');
	});

	test('applies multiple unified diff hunks to the original content', () => {
		const original = 'one\ntwo\nthree\nfour\nfive\n';
		const diff = [
			'@@ -1,3 +1,3 @@',
			' one',
			'-two',
			'+TWO',
			' three',
			'@@ -4,2 +4,3 @@',
			' four',
			'+four-and-a-half',
			' five',
			'',
		].join('\n');

		assert.strictEqual(applyUnifiedDiff(original, diff), 'one\nTWO\nthree\nfour\nfour-and-a-half\nfive\n');
	});

	test('removes Codex move metadata before previewing an update', () => {
		assert.strictEqual(previewFileChange('before\n', {
			path: 'old.txt',
			kind: { type: 'update', move_path: 'new.txt' },
			diff: '@@ -1 +1 @@\n-before\n+after\n\nMoved to: new.txt',
		}), 'after\n');
	});

	test('parses and reverses a cumulative turn diff', () => {
		const patch = [
			'diff --git a/src/a.ts b/src/a.ts',
			'--- a/src/a.ts',
			'+++ b/src/a.ts',
			'@@ -1,3 +1,4 @@',
			' one',
			'-two',
			'+TWO',
			' three',
			'+four',
			'',
		].join('\n');
		const files = parseGitTurnDiff(patch);
		assert.deepStrictEqual(files.map(file => ({ path: file.path, beforeExisted: file.beforeExisted, afterExists: file.afterExists })), [
			{ path: 'src/a.ts', beforeExisted: true, afterExists: true },
		]);
		assert.strictEqual(applyUnifiedDiff('one\nTWO\nthree\nfour\n', invertUnifiedDiff(files[0].patch)), 'one\ntwo\nthree\n');
	});

	test('extracts absolute and relative shell write targets', () => {
		const candidates = shellCommandFileCandidates(
			`$p='D:\\Test\\index.html'; [IO.File]::WriteAllText($p, 'x'); Set-Content .\\src\\app.ts 'y'`,
			'D:\\Test',
		);
		assert.ok(candidates.some(path => path.toLowerCase() === 'd:\\test\\index.html'));
		assert.ok(candidates.some(path => path.toLowerCase() === 'd:\\test\\src\\app.ts'));
	});
});
