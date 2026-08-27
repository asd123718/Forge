/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';
import { existsSync } from 'fs';
import * as http from 'http';
import { homedir } from 'os';
import { join } from 'path';
import { ollamaTagsUrl, parseOllamaListOutput, parseOllamaTagsJson, uniqueModelNames } from '../common/ollamaList.js';

const OLLAMA_LIST_TIMEOUT_MS = 8_000;
const OLLAMA_HTTP_TIMEOUT_MS = 4_000;

/**
 * List installed Ollama models the same way `ollama list` does in a terminal:
 * resolve the real `ollama.exe` (GUI apps often lack it on PATH), run `list`,
 * then fall back to `GET /api/tags` on 127.0.0.1.
 */
export async function listOllamaModelsFromMachine(baseUrl?: string): Promise<string[]> {
	const fromCli = await listOllamaModelsFromCli();
	if (fromCli.length > 0) {
		return fromCli;
	}
	return listOllamaModelsFromHttp(baseUrl);
}

export async function listOllamaModelsFromCli(): Promise<string[]> {
	const env = ollamaProcessEnv();
	const binaries = await resolveOllamaBinaries(env);
	for (const binary of binaries) {
		try {
			const stdout = await execFileUtf8(binary, ['list'], env);
			const names = parseOllamaListOutput(stdout);
			if (names.length > 0) {
				return names;
			}
		} catch {
			continue;
		}
	}
	return [];
}

export async function listOllamaModelsFromHttp(baseUrl?: string): Promise<string[]> {
	const urls = uniqueModelNames([
		baseUrl ? ollamaTagsUrl(baseUrl) : '',
		ollamaTagsUrl(process.env.OLLAMA_HOST ? hostToBaseUrl(process.env.OLLAMA_HOST) : 'http://127.0.0.1:11434/v1'),
		'http://127.0.0.1:11434/api/tags',
		'http://localhost:11434/api/tags',
	]);
	for (const url of urls) {
		try {
			const names = parseOllamaTagsJson(await httpGetJson(url));
			if (names.length > 0) {
				return names;
			}
		} catch {
			continue;
		}
	}
	return [];
}

function hostToBaseUrl(host: string): string {
	if (/^https?:\/\//i.test(host)) {
		return host;
	}
	return `http://${host}`;
}

function ollamaProcessEnv(): NodeJS.ProcessEnv {
	const extra = ollamaInstallDirs().join(process.platform === 'win32' ? ';' : ':');
	const pathKey = process.platform === 'win32' && process.env.Path && !process.env.PATH ? 'Path' : 'PATH';
	const current = process.env[pathKey] || process.env.PATH || process.env.Path || '';
	return {
		...process.env,
		[pathKey]: extra ? `${extra}${process.platform === 'win32' ? ';' : ':'}${current}` : current,
	};
}

function ollamaInstallDirs(): string[] {
	if (process.platform !== 'win32') {
		return ['/usr/local/bin', '/opt/homebrew/bin'];
	}
	return uniqueModelNames([
		join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Programs', 'Ollama'),
		join(homedir(), 'AppData', 'Local', 'Programs', 'Ollama'),
		join(process.env.ProgramFiles || 'C:\\Program Files', 'Ollama'),
		join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Ollama'),
	]);
}

async function resolveOllamaBinaries(env: NodeJS.ProcessEnv): Promise<string[]> {
	const exe = process.platform === 'win32' ? 'ollama.exe' : 'ollama';
	const ordered: string[] = [];
	for (const dir of ollamaInstallDirs()) {
		ordered.push(join(dir, exe));
	}
	if (process.platform === 'win32') {
		try {
			const whereOutput = await execFileUtf8('where.exe', ['ollama'], env);
			for (const line of whereOutput.split(/\r?\n/)) {
				const candidate = line.trim();
				if (candidate) {
					ordered.push(candidate);
				}
			}
		} catch {
			// PATH may not contain ollama; the install-dir candidates still apply.
		}
	}
	ordered.push(process.platform === 'win32' ? 'ollama.exe' : 'ollama');
	return uniqueModelNames(ordered.filter(candidate => candidate === 'ollama' || candidate === 'ollama.exe' || existsSync(candidate)));
}

function execFileUtf8(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(command, args, {
			timeout: OLLAMA_LIST_TIMEOUT_MS,
			windowsHide: true,
			env,
			encoding: 'utf8',
			maxBuffer: 2 * 1024 * 1024,
		}, (error, stdout, stderr) => {
			if (error) {
				reject(error);
				return;
			}
			resolve(`${stdout ?? ''}\n${stderr ?? ''}`);
		});
	});
}

function httpGetJson(url: string): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const request = http.get(url, { timeout: OLLAMA_HTTP_TIMEOUT_MS }, response => {
			if (response.statusCode && response.statusCode >= 400) {
				response.resume();
				reject(new Error(`HTTP ${response.statusCode}`));
				return;
			}
			const chunks: Buffer[] = [];
			response.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
			response.on('end', () => {
				try {
					resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
				} catch (error) {
					reject(error);
				}
			});
			response.on('error', reject);
		});
		request.on('timeout', () => {
			request.destroy();
			reject(new Error(`timeout ${url}`));
		});
		request.on('error', reject);
	});
}
