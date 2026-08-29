/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';
import { copyFile, lstat, mkdir, readFile, rm, rmdir, stat } from 'fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from '../../../../base/common/path.js';
import { generateUuid } from '../../../../base/common/uuid.js';

const gitMaxBuffer = 32 * 1024 * 1024;

export interface IWorkerWorkspace {
	readonly path: string;
	collectChangedFiles(): Promise<readonly string[]>;
	mergeInto(target: string): Promise<readonly string[]>;
	dispose(): Promise<void>;
}

interface IWorkspaceChange {
	readonly kind: 'add' | 'modify' | 'delete' | 'rename' | 'copy';
	readonly path: string;
	readonly beforePath?: string;
}

/**
 * Creates an isolated detached worktree whose initial commit exactly mirrors
 * the caller's tracked and untracked workspace state. Failing to create that
 * isolation is fatal: parallel workers must never fall back to writing the
 * user's checkout in place.
 */
export async function openWorkerWorkspace(workspace: string, taskId: string): Promise<IWorkerWorkspace> {
	if (!await isGitRepo(workspace)) {
		throw new Error('Forge workers require a Git workspace so edits can be isolated and merged safely.');
	}
	const safeTaskId = taskId.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 40) || 'task';
	const worktreeRoot = join(workspace, '..', `${baseName(workspace)}.worktrees`);
	const worktree = join(worktreeRoot, `${safeTaskId}-${generateUuid().slice(0, 8)}`);
	await mkdir(worktreeRoot, { recursive: true });
	try {
		await git(workspace, ['worktree', 'add', '--detach', worktree]);
		await mirrorWorkspaceState(workspace, worktree);
		await git(worktree, ['add', '--all']);
		await git(worktree, [
			'-c', 'user.name=Forge Worker',
			'-c', 'user.email=worker@forge.invalid',
			'commit', '--allow-empty', '--no-gpg-sign', '-m', 'Forge worker baseline',
		]);
		return new GitWorktreeWorkspace(workspace, worktree);
	} catch (error) {
		await removeWorktree(workspace, worktree);
		throw new Error(`Unable to create an isolated Forge worker workspace: ${error instanceof Error ? error.message : String(error)}`);
	}
}

class GitWorktreeWorkspace implements IWorkerWorkspace {
	constructor(
		private readonly _repo: string,
		readonly path: string,
	) { }

	async collectChangedFiles(): Promise<readonly string[]> {
		return uniquePaths((await workspaceChanges(this.path)).flatMap(change => [change.beforePath, change.path].filter((path): path is string => !!path)));
	}

	async mergeInto(target: string): Promise<readonly string[]> {
		const changes = await workspaceChanges(this.path);
		if (changes.length === 0) {
			return [];
		}
		await validateMerge(this.path, target, changes);
		for (const change of changes) {
			await applyChange(this.path, target, change);
		}
		return uniquePaths(changes.flatMap(change => [change.beforePath, change.path].filter((path): path is string => !!path)));
	}

	async dispose(): Promise<void> {
		await removeWorktree(this._repo, this.path);
	}
}

async function removeWorktree(repo: string, worktree: string): Promise<void> {
	try {
		await git(repo, ['worktree', 'remove', '--force', worktree]);
	} catch {
		try {
			await rm(worktree, { recursive: true, force: true });
		} catch {
			// Best effort after Git has already rejected cleanup.
		}
		try {
			await git(repo, ['worktree', 'prune']);
		} catch {
			// Best effort cleanup only.
		}
	}
	try {
		await rmdir(dirname(worktree));
	} catch {
		// Other parallel worker worktrees may still live in the shared parent.
	}
}

async function mirrorWorkspaceState(source: string, target: string): Promise<void> {
	for (const path of await workspaceStatusPaths(source)) {
		const from = safeWorkspacePath(source, path);
		const to = safeWorkspacePath(target, path);
		await assertNoSymbolicLinkTraversal(source, path, true);
		await assertNoSymbolicLinkTraversal(target, path, true);
		if (await isFile(from)) {
			await mkdir(dirname(to), { recursive: true });
			await copyFile(from, to);
		} else {
			await rm(to, { recursive: true, force: true });
		}
	}
}

async function workspaceStatusPaths(cwd: string): Promise<readonly string[]> {
	const output = await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
	const tokens = output.split('\0');
	const paths: string[] = [];
	for (let index = 0; index < tokens.length;) {
		const token = tokens[index++];
		if (!token) {
			continue;
		}
		const status = token.slice(0, 2);
		paths.push(token.slice(3));
		if (status.includes('R') || status.includes('C')) {
			const beforePath = tokens[index++];
			if (beforePath) {
				paths.push(beforePath);
			}
		}
	}
	return uniquePaths(paths);
}

async function workspaceChanges(cwd: string): Promise<readonly IWorkspaceChange[]> {
	const output = await git(cwd, ['diff', '--name-status', '-z', '--find-renames', 'HEAD']);
	const tokens = output.split('\0');
	const changes: IWorkspaceChange[] = [];
	for (let index = 0; index < tokens.length;) {
		const status = tokens[index++];
		if (!status) {
			continue;
		}
		const kind = status[0];
		if (kind === 'R' || kind === 'C') {
			const beforePath = tokens[index++];
			const path = tokens[index++];
			if (beforePath && path) {
				changes.push({ kind: kind === 'R' ? 'rename' : 'copy', beforePath, path });
			}
			continue;
		}
		const path = tokens[index++];
		if (!path) {
			continue;
		}
		changes.push({
			kind: kind === 'A' ? 'add' : kind === 'D' ? 'delete' : 'modify',
			path,
		});
	}
	const trackedPaths = new Set(changes.map(change => change.path));
	const untracked = (await git(cwd, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
	for (const path of untracked) {
		if (!trackedPaths.has(path)) {
			changes.push({ kind: 'add', path });
		}
	}
	return changes;
}

async function validateMerge(from: string, target: string, changes: readonly IWorkspaceChange[]): Promise<void> {
	const conflicts: string[] = [];
	for (const change of changes) {
		if ((change.kind === 'add' || change.kind === 'copy') && await pathExists(safeWorkspacePath(target, change.path))) {
			conflicts.push(change.path);
		}
		if ((change.kind === 'modify' || change.kind === 'delete') && !await targetMatchesBaseline(from, target, change.path)) {
			conflicts.push(change.path);
		}
		if (change.kind === 'rename' && change.beforePath) {
			if (!await targetMatchesBaseline(from, target, change.beforePath)) {
				conflicts.push(change.beforePath);
			}
			if (change.path !== change.beforePath && await pathExists(safeWorkspacePath(target, change.path))) {
				conflicts.push(change.path);
			}
		}
	}
	if (conflicts.length > 0) {
		throw new Error(`Worker changes conflict with newer workspace edits: ${uniquePaths(conflicts).join(', ')}`);
	}
}

async function targetMatchesBaseline(from: string, target: string, path: string): Promise<boolean> {
	try {
		await assertNoSymbolicLinkTraversal(target, path, true);
		const [baseline, current] = await Promise.all([
			gitBuffer(from, ['show', `HEAD:${path}`]),
			readFile(safeWorkspacePath(target, path)),
		]);
		return baseline.equals(current);
	} catch {
		return false;
	}
}

async function applyChange(from: string, target: string, change: IWorkspaceChange): Promise<void> {
	await assertNoSymbolicLinkTraversal(target, change.path, true);
	if (change.kind === 'delete') {
		await rm(safeWorkspacePath(target, change.path), { recursive: true, force: true });
		return;
	}
	await assertNoSymbolicLinkTraversal(from, change.path, true);
	const source = safeWorkspacePath(from, change.path);
	const destination = safeWorkspacePath(target, change.path);
	await mkdir(dirname(destination), { recursive: true });
	await copyFile(source, destination);
	if (change.kind === 'rename' && change.beforePath && change.beforePath !== change.path) {
		await assertNoSymbolicLinkTraversal(target, change.beforePath, true);
		await rm(safeWorkspacePath(target, change.beforePath), { recursive: true, force: true });
	}
}

async function assertNoSymbolicLinkTraversal(root: string, path: string, includeLeaf: boolean): Promise<void> {
	const candidate = safeWorkspacePath(root, path);
	const relative = candidate.slice(resolve(root).length).replace(/^[\\/]+/, '');
	const segments = relative.split(/[\\/]+/).filter(Boolean);
	const count = includeLeaf ? segments.length : Math.max(0, segments.length - 1);
	let current = resolve(root);
	for (let index = 0; index < count; index++) {
		current = join(current, segments[index]);
		try {
			if ((await lstat(current)).isSymbolicLink()) {
				throw new Error(`Worker changes cannot traverse symbolic links: ${path}`);
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
			return;
		}
	}
}

async function isGitRepo(workspace: string): Promise<boolean> {
	try {
		return (await git(workspace, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true';
	} catch {
		return false;
	}
}

function safeWorkspacePath(root: string, path: string): string {
	if (isAbsolute(path)) {
		throw new Error(`Worker returned an absolute path outside its merge contract: ${path}`);
	}
	const resolvedRoot = resolve(root);
	const candidate = resolve(resolvedRoot, path);
	const normalizedRoot = process.platform === 'win32' ? resolvedRoot.toLowerCase() : resolvedRoot;
	const normalizedCandidate = process.platform === 'win32' ? candidate.toLowerCase() : candidate;
	if (normalizedCandidate !== normalizedRoot && !normalizedCandidate.startsWith(`${normalizedRoot}${sep}`)) {
		throw new Error(`Worker returned a path outside its workspace: ${path}`);
	}
	return candidate;
}

async function isFile(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

function git(cwd: string, args: readonly string[]): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		execFile('git', [...args], { cwd, windowsHide: true, encoding: 'utf8', maxBuffer: gitMaxBuffer }, (error, stdout) => {
			if (error) {
				reject(error);
			} else {
				resolvePromise(stdout);
			}
		});
	});
}

function gitBuffer(cwd: string, args: readonly string[]): Promise<Buffer> {
	return new Promise((resolvePromise, reject) => {
		execFile('git', [...args], { cwd, windowsHide: true, encoding: 'buffer', maxBuffer: gitMaxBuffer }, (error, stdout) => {
			if (error) {
				reject(error);
			} else {
				resolvePromise(stdout);
			}
		});
	});
}

function uniquePaths(paths: readonly string[]): string[] {
	return [...new Set(paths.filter(path => path !== ''))];
}

function baseName(path: string): string {
	return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? 'workspace';
}
