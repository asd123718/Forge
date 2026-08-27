/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { join } from '../../../../base/common/path.js';
import { generateUuid } from '../../../../base/common/uuid.js';

const execFileAsync = promisify(execFile);

export interface IWorkerWorkspace {
	readonly path: string;
	collectChangedFiles(): Promise<readonly string[]>;
	mergeInto(target: string): Promise<readonly string[]>;
	dispose(): Promise<void>;
}

export async function openWorkerWorkspace(workspace: string, taskId: string): Promise<IWorkerWorkspace> {
	if (await isGitRepo(workspace)) {
		const branch = `forge/orch-${taskId}-${generateUuid().slice(0, 8)}`;
		const worktree = join(workspace, '..', `${baseName(workspace)}.worktrees`, branch.replace(/\//g, '-'));
		try {
			await execFileAsync('git', ['worktree', 'add', '-b', branch, worktree], { cwd: workspace, windowsHide: true });
			return new GitWorktreeWorkspace(workspace, worktree, branch);
		} catch {
			return new InPlaceWorkspace(workspace);
		}
	}
	return new InPlaceWorkspace(workspace);
}

class InPlaceWorkspace implements IWorkerWorkspace {
	constructor(readonly path: string) { }
	async collectChangedFiles(): Promise<readonly string[]> {
		return gitChangedFiles(this.path);
	}
	async mergeInto(): Promise<readonly string[]> {
		return this.collectChangedFiles();
	}
	async dispose(): Promise<void> { }
}

class GitWorktreeWorkspace implements IWorkerWorkspace {
	constructor(
		private readonly _repo: string,
		readonly path: string,
		private readonly _branch: string,
	) { }

	async collectChangedFiles(): Promise<readonly string[]> {
		return gitChangedFiles(this.path);
	}

	async mergeInto(target: string): Promise<readonly string[]> {
		const files = await gitChangedFiles(this.path);
		if (files.length === 0) {
			return [];
		}
		return copyChangedFiles(this.path, target, files);
	}

	async dispose(): Promise<void> {
		try {
			await execFileAsync('git', ['-C', this._repo, 'worktree', 'remove', '--force', this.path], { windowsHide: true });
		} catch {
			// Best-effort cleanup; leftover worktrees are under .worktrees.
		}
	}
}

async function isGitRepo(workspace: string): Promise<boolean> {
	if (!existsSync(join(workspace, '.git'))) {
		try {
			await execFileAsync('git', ['-C', workspace, 'rev-parse', '--is-inside-work-tree'], { windowsHide: true });
			return true;
		} catch {
			return false;
		}
	}
	return true;
}

async function gitChangedFiles(cwd: string): Promise<readonly string[]> {
	try {
		const { stdout } = await execFileAsync('git', ['-C', cwd, 'status', '--porcelain'], { windowsHide: true });
		return stdout.split(/\r?\n/).map(line => line.slice(3).trim()).filter(path => path !== '');
	} catch {
		return [];
	}
}

async function copyChangedFiles(from: string, to: string, files: readonly string[]): Promise<readonly string[]> {
	const { cp } = await import('fs/promises');
	const copied: string[] = [];
	for (const file of files) {
		try {
			await cp(join(from, file), join(to, file), { recursive: true, force: true });
			copied.push(file);
		} catch {
			continue;
		}
	}
	return copied;
}

function baseName(path: string): string {
	return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? 'workspace';
}
