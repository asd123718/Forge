/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { promisify } from 'util';
import { join } from '../../../../base/common/path.js';
import { isWindows } from '../../../../base/common/platform.js';
import type { WorkerCredentialSource } from '../../common/orchestration/orchestrationTypes.js';

const execFileAsync = promisify(execFile);

export function forgeUserHome(): string {
	return process.env.FORGE_HOME || homedir();
}

export function deepSeekHarnessRoots(repoRoot: string): readonly string[] {
	const home = forgeUserHome();
	return [
		join(repoRoot, '..', 'deepseek-harness-master'),
		join(repoRoot, '..', '..', 'deepseek-harness-master'),
		join(home, '.forge', 'deepseek-harness'),
		join(home, '.forge', 'deepseek-harness-master'),
	];
}

export function grokBuildBinaryCandidates(repoRoot: string): readonly string[] {
	const home = forgeUserHome();
	const binary = isWindows ? 'xai-grok-pager.exe' : 'xai-grok-pager';
	return [
		join(repoRoot, '..', 'grok-build-main', 'target', 'release', binary),
		join(repoRoot, '..', '..', 'grok-build-main', 'target', 'release', binary),
		join(home, '.forge', 'bin', binary),
		join(home, '.forge', 'grok-build-main', 'target', 'release', binary),
	];
}

export function deepSeekCredentialsPath(userHome = forgeUserHome()): string {
	return join(process.env.DSH_HOME || join(userHome, '.dsh'), '.credentials.yaml');
}

export function grokAuthPath(userHome = forgeUserHome()): string {
	return join(userHome, '.grok', 'auth.json');
}

export function readDeepSeekApiKeyFromCredentials(userHome = forgeUserHome()): string | undefined {
	try {
		const text = readFileSync(deepSeekCredentialsPath(userHome), 'utf8');
		const match = text.match(/^\s*DEEPSEEK_API_KEY\s*:\s*(.+)\s*$/m);
		const value = match?.[1]?.trim().replace(/^['"]|['"]$/g, '');
		return value || undefined;
	} catch {
		return undefined;
	}
}

export function readGrokApiKeyFromAuth(userHome = forgeUserHome()): string | undefined {
	try {
		const raw = JSON.parse(readFileSync(grokAuthPath(userHome), 'utf8')) as Record<string, unknown>;
		for (const value of Object.values(raw)) {
			if (!value || typeof value !== 'object') {
				continue;
			}
			const entry = value as Record<string, unknown>;
			if (typeof entry.key === 'string' && entry.key.trim() !== '') {
				return entry.key;
			}
		}
	} catch {
		return undefined;
	}
	return undefined;
}

export function deepSeekCredentialSource(env: NodeJS.ProcessEnv, userHome = forgeUserHome()): WorkerCredentialSource {
	if (env.DEEPSEEK_API_KEY?.trim()) {
		return 'env';
	}
	if (readDeepSeekApiKeyFromCredentials(userHome)) {
		return 'saved';
	}
	return 'none';
}

export function grokCredentialSource(env: NodeJS.ProcessEnv, userHome = forgeUserHome()): WorkerCredentialSource {
	if (env.XAI_API_KEY?.trim() || env.GROK_CODE_XAI_API_KEY?.trim()) {
		return 'env';
	}
	if (readGrokApiKeyFromAuth(userHome)) {
		return 'saved';
	}
	return 'none';
}

export function hasDeepSeekWorkerCredentials(env: NodeJS.ProcessEnv, userHome = forgeUserHome()): boolean {
	return deepSeekCredentialSource(env, userHome) !== 'none';
}

export function hasGrokWorkerCredentials(env: NodeJS.ProcessEnv, userHome = forgeUserHome()): boolean {
	return grokCredentialSource(env, userHome) !== 'none';
}

export function isExecutablePath(command: string): boolean {
	if (!command) {
		return false;
	}
	if (command.includes('/') || command.includes('\\')) {
		return existsSync(command);
	}
	return true;
}

export async function probeExecutable(command: string, args: readonly string[] = ['--version'], env: NodeJS.ProcessEnv = process.env, timeoutMs = 4_000): Promise<boolean> {
	if (!isExecutablePath(command)) {
		return false;
	}
	try {
		await execFileAsync(command, [...args], {
			env,
			timeout: timeoutMs,
			windowsHide: true,
		});
		return true;
	} catch {
		try {
			await execFileAsync(command, ['--help'], {
				env,
				timeout: timeoutMs,
				windowsHide: true,
			});
			return true;
		} catch {
			return false;
		}
	}
}
