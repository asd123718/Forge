/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { execFile } from 'child_process';
import { access, mkdtemp, readFile, rename, rm, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from '../../../../../base/common/path.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { openWorkerWorkspace } from '../../../node/orchestration/workerWorkspace.js';

function git(cwd: string, args: readonly string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile('git', [...args], { cwd, windowsHide: true, encoding: 'utf8' }, (error, stdout) => error ? reject(error) : resolve(stdout));
	});
}

async function createRepository(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'forge-worker-workspace-'));
	await git(root, ['init']);
	await writeFile(join(root, 'modify.txt'), 'committed\n');
	await writeFile(join(root, 'delete.txt'), 'delete me\n');
	await writeFile(join(root, 'rename-old.txt'), 'rename me\n');
	await git(root, ['add', '--all']);
	await git(root, ['-c', 'user.name=Forge Test', '-c', 'user.email=forge-test@invalid', 'commit', '--no-gpg-sign', '-m', 'initial']);
	return root;
}

async function missing(path: string): Promise<boolean> {
	try {
		await access(path);
		return false;
	} catch {
		return true;
	}
}

suite('Forge worker workspace', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('mirrors dirty state and merges add, modify, delete, and rename', async () => {
		const root = await createRepository();
		try {
			await writeFile(join(root, 'modify.txt'), 'dirty baseline\n');
			await unlink(join(root, 'delete.txt'));
			await writeFile(join(root, 'untracked.txt'), 'untracked baseline\n');

			const worker = await openWorkerWorkspace(root, 'all-file-operations');
			try {
				assert.strictEqual(await readFile(join(worker.path, 'modify.txt'), 'utf8'), 'dirty baseline\n');
				assert.ok(await missing(join(worker.path, 'delete.txt')));
				assert.strictEqual(await readFile(join(worker.path, 'untracked.txt'), 'utf8'), 'untracked baseline\n');

				await writeFile(join(worker.path, 'modify.txt'), 'worker result\n');
				await unlink(join(worker.path, 'untracked.txt'));
				await rename(join(worker.path, 'rename-old.txt'), join(worker.path, 'rename-new.txt'));
				await writeFile(join(worker.path, 'added.txt'), 'added\n');

				const changed = await worker.collectChangedFiles();
				assert.deepStrictEqual([...changed].sort(), ['added.txt', 'modify.txt', 'rename-new.txt', 'rename-old.txt', 'untracked.txt']);
				assert.deepStrictEqual([...(await worker.mergeInto(root))].sort(), [...changed].sort());
			} finally {
				await worker.dispose();
			}

			assert.strictEqual(await readFile(join(root, 'modify.txt'), 'utf8'), 'worker result\n');
			assert.ok(await missing(join(root, 'delete.txt')));
			assert.ok(await missing(join(root, 'untracked.txt')));
			assert.ok(await missing(join(root, 'rename-old.txt')));
			assert.strictEqual((await readFile(join(root, 'rename-new.txt'), 'utf8')).trim(), 'rename me');
			assert.strictEqual(await readFile(join(root, 'added.txt'), 'utf8'), 'added\n');
			assert.strictEqual((await git(root, ['branch', '--list', 'forge/orch-*'])).trim(), '');
			assert.ok(await missing(join(dirname(root), `${root.split(/[\\/]/).pop()}.worktrees`)));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('rejects a merge when the user changed the same file', async () => {
		const root = await createRepository();
		try {
			const worker = await openWorkerWorkspace(root, 'conflict');
			try {
				await writeFile(join(worker.path, 'modify.txt'), 'worker result\n');
				await writeFile(join(root, 'modify.txt'), 'new user edit\n');
				await assert.rejects(worker.mergeInto(root), /conflict.*modify\.txt/i);
				assert.strictEqual(await readFile(join(root, 'modify.txt'), 'utf8'), 'new user edit\n');
			} finally {
				await worker.dispose();
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('refuses to run without Git isolation', async () => {
		const root = await mkdtemp(join(tmpdir(), 'forge-worker-no-git-'));
		try {
			await assert.rejects(openWorkerWorkspace(root, 'unsafe'), /require a Git workspace/i);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
