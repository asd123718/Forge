/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Parse the table printed by `ollama list` into model names.
 */
export function parseOllamaListOutput(stdout: string): string[] {
	const lines = stdout.split(/\r?\n/).map(line => line.trim()).filter(line => line !== '');
	if (lines.length === 0) {
		return [];
	}
	const start = /^NAME(\s|$)/i.test(lines[0]) ? 1 : 0;
	const names: string[] = [];
	const seen = new Set<string>();
	for (const line of lines.slice(start)) {
		const name = line.split(/\s+/)[0];
		if (!name || /^NAME$/i.test(name) || seen.has(name)) {
			continue;
		}
		seen.add(name);
		names.push(name);
	}
	return names;
}

/**
 * Parse Ollama's `/api/tags` JSON body into model names.
 */
export function parseOllamaTagsJson(body: unknown): string[] {
	const raw = body && typeof body === 'object' && !Array.isArray(body) && Array.isArray((body as { models?: unknown }).models)
		? (body as { models: unknown[] }).models
		: Array.isArray(body) ? body : [];
	return uniqueModelNames(raw.map(entry => {
		if (!entry || typeof entry !== 'object') {
			return '';
		}
		const record = entry as { model?: unknown; name?: unknown; id?: unknown };
		return (typeof record.model === 'string' && record.model)
			|| (typeof record.name === 'string' && record.name)
			|| (typeof record.id === 'string' && record.id)
			|| '';
	}));
}

export function uniqueModelNames(names: readonly string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const name of names) {
		const trimmed = name.trim();
		if (trimmed === '' || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		result.push(trimmed);
	}
	return result;
}

export function ollamaTagsUrl(baseUrl: string): string {
	const url = new URL(baseUrl || 'http://127.0.0.1:11434/v1');
	url.search = '';
	url.hash = '';
	url.pathname = `${url.pathname.replace(/\/(?:v1|api)\/?$/, '').replace(/\/$/, '')}/api/tags`;
	return url.toString();
}
