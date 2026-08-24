/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	LIVE_PREVIEW_UNAVAILABLE_MESSAGE,
	applyUnifiedDiff,
	invertUnifiedDiff,
	parseGitTurnDiff,
	previewFileChange,
	readShellSnapshot,
	resolveTurnDiffPath,
	shellCommandFileCandidates,
	shellSnapshotMaxFileBytes,
	shellSnapshotMaxFiles,
	shellSnapshotMaxTotalBytes,
	snapshotDirectory,
} from '../../node/codex/codexFileEditObserver.js';

suite('CodexFileEditObserver', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('previews streamed add and delete changes with first-class identities', () => {
		assert.deepStrictEqual(previewFileChange('', {
			path: 'new.txt',
			kind: { type: 'add' },
			diff: 'one\ntwo\n',
		}), { ok: true, after: 'one\ntwo\n', omitBefore: true, omitAfter: false });
		assert.deepStrictEqual(previewFileChange('old\n', {
			path: 'old.txt',
			kind: { type: 'delete' },
			diff: 'old\n',
		}), { ok: true, after: '', omitBefore: false, omitAfter: true });
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
		assert.deepStrictEqual(previewFileChange('before\n', {
			path: 'old.txt',
			kind: { type: 'update', move_path: 'new.txt' },
			diff: '@@ -1 +1 @@\n-before\n+after\n\nMoved to: new.txt',
		}), { ok: true, after: 'after\n', afterPath: 'new.txt', omitBefore: false, omitAfter: false });
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

	test('skips PowerShell variable and wildcard paths', () => {
		const candidates = shellCommandFileCandidates(
			`Set-Content $env:TEMP\\out.txt 'x'; Copy-Item .\\src\\*.ts .\\dest`,
			'D:\\Test',
		);
		assert.ok(!candidates.some(path => path.toLowerCase().includes('$env')));
		assert.ok(!candidates.some(path => path.includes('*')));
	});

	test('applies a patch to an empty file', () => {
		const diff = ['@@ -0,0 +1,2 @@', '+hello', '+world', ''].join('\n');
		assert.strictEqual(applyUnifiedDiff('', diff), 'hello\nworld\n');
	});

	test('preserves CRLF when the baseline uses CRLF', () => {
		const original = 'one\r\ntwo\r\nthree\r\n';
		const diff = ['@@ -1,3 +1,3 @@', ' one', '-two', '+TWO', ' three', ''].join('\n');
		assert.strictEqual(applyUnifiedDiff(original, diff), 'one\r\nTWO\r\nthree\r\n');
	});

	test('handles a file with no trailing newline', () => {
		const original = 'one\ntwo';
		const diff = ['@@ -1,2 +1,2 @@', ' one', '-two', '+TWO', '\\ No newline at end of file', ''].join('\n');
		assert.strictEqual(applyUnifiedDiff(original, diff), 'one\nTWO');
	});

	test('fails closed when hunk context does not match', () => {
		const original = 'one\ntwo\nthree\n';
		const diff = ['@@ -1,3 +1,3 @@', ' one', '-nope', '+TWO', ' three', ''].join('\n');
		assert.strictEqual(applyUnifiedDiff(original, diff), undefined);
		assert.deepStrictEqual(previewFileChange(original, {
			path: 'a.ts',
			kind: { type: 'update', move_path: null },
			diff,
		}), { ok: false, reason: LIVE_PREVIEW_UNAVAILABLE_MESSAGE });
	});

	test('fails closed when a later hunk mismatches after an earlier hunk succeeds', () => {
		const original = 'one\ntwo\nthree\nfour\n';
		const diff = [
			'@@ -1,2 +1,2 @@',
			' one',
			'-two',
			'+TWO',
			'@@ -3,2 +3,2 @@',
			' wrong',
			'-four',
			'+FOUR',
			'',
		].join('\n');
		assert.strictEqual(applyUnifiedDiff(original, diff), undefined);
	});

	test('fails closed when the update diff contains no hunks', () => {
		assert.strictEqual(applyUnifiedDiff('keep\n', 'not a patch'), undefined);
		assert.deepStrictEqual(previewFileChange('keep\n', {
			path: 'a.ts',
			kind: { type: 'update', move_path: null },
			diff: 'not a patch',
		}), { ok: false, reason: LIVE_PREVIEW_UNAVAILABLE_MESSAGE });
	});

	test('refuses a turn-diff reconstruction when the inverted patch does not apply', () => {
		const after = 'one\nTWO\nthree\n';
		const inverted = invertUnifiedDiff([
			'diff --git a/a.ts b/a.ts',
			'--- a/a.ts',
			'+++ b/a.ts',
			'@@ -1,3 +1,3 @@',
			' one',
			'-two',
			'+TWO',
			' three',
			'',
		].join('\n'));
		assert.ok(applyUnifiedDiff(after, inverted));
		assert.strictEqual(applyUnifiedDiff('unrelated\n', inverted), undefined);
	});

	test('parses rename and delete turn diffs', () => {
		const patch = [
			'diff --git a/old.ts b/new.ts',
			'--- a/old.ts',
			'+++ b/new.ts',
			'@@ -1 +1 @@',
			'-old',
			'+new',
			'diff --git a/gone.ts b/gone.ts',
			'--- a/gone.ts',
			'+++ /dev/null',
			'@@ -1 +0,0 @@',
			'-bye',
			'',
		].join('\n');
		assert.deepStrictEqual(parseGitTurnDiff(patch).map(file => ({ path: file.path, beforeExisted: file.beforeExisted, afterExists: file.afterExists })), [
			{ path: 'new.ts', beforeExisted: true, afterExists: true },
			{ path: 'gone.ts', beforeExisted: true, afterExists: false },
		]);
	});

	test('resolves a turn-diff path against the matching multi-root folder', async () => {
		const rootA = URI.file('C:\\work\\alpha');
		const rootB = URI.file('C:\\work\\beta');
		const path = await resolveTurnDiffPath('beta/src/app.ts', true, [rootA, rootB], async candidate => candidate.replace(/\\/g, '/').endsWith('beta/src/app.ts'));
		assert.ok(path.replace(/\\/g, '/').toLowerCase().endsWith('beta/src/app.ts'));
	});

	test('documents snapshot limits used for shell walk truncation', () => {
		assert.strictEqual(shellSnapshotMaxFiles, 3_000);
		assert.strictEqual(shellSnapshotMaxFileBytes, 2 * 1024 * 1024);
		assert.strictEqual(shellSnapshotMaxTotalBytes, 24 * 1024 * 1024);
	});

	test('shell snapshots include empty files and skip binaries, oversized files, and node_modules', async () => {
		const root = await mkdtemp(join(tmpdir(), 'forge-observer-'));
		try {
			await writeFile(join(root, 'empty.txt'), '');
			await writeFile(join(root, 'ok.txt'), 'hello');
			await writeFile(join(root, 'binary.bin'), Buffer.from([0x00, 0x01, 0x02]));
			await writeFile(join(root, 'huge.txt'), Buffer.alloc(shellSnapshotMaxFileBytes + 1, 0x61));
			await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
			await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), 'skipped');

			const empty = await readShellSnapshot(join(root, 'empty.txt'));
			const ok = await readShellSnapshot(join(root, 'ok.txt'));
			const binary = await readShellSnapshot(join(root, 'binary.bin'));
			const huge = await readShellSnapshot(join(root, 'huge.txt'));
			assert.deepStrictEqual({ existed: empty.existed, content: empty.content, skippedContent: empty.skippedContent }, { existed: true, content: '', skippedContent: false });
			assert.deepStrictEqual({ existed: ok.existed, content: ok.content, skippedContent: ok.skippedContent }, { existed: true, content: 'hello', skippedContent: false });
			assert.strictEqual(binary.skippedContent, true);
			assert.strictEqual(huge.skippedContent, true);

			const snapshots = new Map();
			await snapshotDirectory(root, snapshots, 50, 1024 * 1024);
			const keys = [...snapshots.keys()].map(path => path.replace(/\\/g, '/'));
			assert.ok(keys.some(path => path.endsWith('/empty.txt')));
			assert.ok(keys.some(path => path.endsWith('/ok.txt')));
			assert.ok(!keys.some(path => path.includes('/node_modules/')));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('truncates a directory walk at the file-count and byte budgets', async () => {
		const root = await mkdtemp(join(tmpdir(), 'forge-observer-limit-'));
		try {
			for (let index = 0; index < 5; index++) {
				await writeFile(join(root, `f${index}.txt`), 'x');
			}
			const byCount = new Map();
			const countResult = await snapshotDirectory(root, byCount, 3, 1024 * 1024);
			assert.strictEqual(countResult.files, 3);
			assert.strictEqual(byCount.size, 3);

			const byteRoot = join(root, 'bytes');
			await mkdir(byteRoot);
			await writeFile(join(byteRoot, 'a.txt'), 'aaaa');
			await writeFile(join(byteRoot, 'b.txt'), 'bbbb');
			await writeFile(join(byteRoot, 'c.txt'), 'cccc');
			const byBytes = new Map();
			await snapshotDirectory(byteRoot, byBytes, 50, 6);
			const stored = [...byBytes.values()].filter(snapshot => !snapshot.skippedContent);
			assert.ok(stored.length <= 1);
			assert.ok([...byBytes.values()].reduce((total, snapshot) => total + (snapshot.skippedContent ? 0 : snapshot.size), 0) <= 6);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
