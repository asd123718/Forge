/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CodexModelProviderKind } from '../../common/codexModelsConfig.js';

export interface ICodexDiscoveredLocalModel {
	readonly id: string;
	readonly name: string;
	readonly contextWindow?: number;
}

export class CodexLocalModelDiscoveryError extends Error {
	constructor(readonly kind: 'unavailable' | 'timeout' | 'unauthorized' | 'invalid-response', message: string) {
		super(message);
	}
}

export async function discoverCodexLocalModels(
	kind: Extract<CodexModelProviderKind, 'ollama' | 'lmstudio'>,
	baseUrl: string,
	fetchFn: typeof fetch = fetch,
	timeoutMs = 5_000,
): Promise<readonly ICodexDiscoveredLocalModel[]> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const url = localDiscoveryUrl(kind, baseUrl);
		let response: Response;
		try {
			response = await fetchFn(url, { signal: controller.signal });
		} catch (error) {
			if (controller.signal.aborted) {
				throw new CodexLocalModelDiscoveryError('timeout', `${kind} did not respond within ${timeoutMs}ms`);
			}
			throw new CodexLocalModelDiscoveryError('unavailable', `${kind} is not reachable at ${url}: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (response.status === 401 || response.status === 403) {
			throw new CodexLocalModelDiscoveryError('unauthorized', `${kind} rejected the model discovery request`);
		}
		if (!response.ok) {
			throw new CodexLocalModelDiscoveryError('unavailable', `${kind} model discovery returned HTTP ${response.status}`);
		}
		const body: unknown = await response.json();
		const models = kind === 'ollama' ? readOllamaModels(body) : readLmStudioModels(body);
		if (!models) {
			throw new CodexLocalModelDiscoveryError('invalid-response', `${kind} returned an invalid model list`);
		}
		return models;
	} finally {
		clearTimeout(timeout);
	}
}

function localDiscoveryUrl(kind: 'ollama' | 'lmstudio', baseUrl: string): string {
	const url = new URL(baseUrl);
	url.pathname = url.pathname.replace(/\/(?:v1|api)\/?$/, '');
	url.search = '';
	url.hash = '';
	url.pathname = `${url.pathname.replace(/\/$/, '')}${kind === 'ollama' ? '/api/tags' : '/api/v0/models'}`;
	return url.toString();
}

function readOllamaModels(body: unknown): readonly ICodexDiscoveredLocalModel[] | undefined {
	if (!body || typeof body !== 'object' || !Array.isArray((body as { models?: unknown }).models)) {
		return undefined;
	}
	return (body as { models: unknown[] }).models.flatMap(raw => {
		if (!raw || typeof raw !== 'object') {
			return [];
		}
		const record = raw as { name?: unknown; model?: unknown };
		const id = typeof record.model === 'string' ? record.model : typeof record.name === 'string' ? record.name : undefined;
		return id ? [{ id, name: id }] : [];
	});
}

function readLmStudioModels(body: unknown): readonly ICodexDiscoveredLocalModel[] | undefined {
	const rawModels = Array.isArray(body)
		? body
		: body && typeof body === 'object' && Array.isArray((body as { data?: unknown }).data)
			? (body as { data: unknown[] }).data
			: undefined;
	if (!rawModels) {
		return undefined;
	}
	return rawModels.flatMap(raw => {
		if (!raw || typeof raw !== 'object') {
			return [];
		}
		const record = raw as { id?: unknown; max_context_length?: unknown; loaded_context_length?: unknown };
		if (typeof record.id !== 'string') {
			return [];
		}
		const contextWindow = typeof record.loaded_context_length === 'number'
			? record.loaded_context_length
			: typeof record.max_context_length === 'number' ? record.max_context_length : undefined;
		return [{ id: record.id, name: record.id, ...(contextWindow ? { contextWindow } : {}) }];
	});
}
