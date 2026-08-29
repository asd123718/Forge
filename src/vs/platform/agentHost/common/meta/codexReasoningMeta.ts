/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type CodexReasoningKind = 'summary' | 'text';

interface IHasCodexReasoningMeta {
	readonly _meta?: Record<string, unknown>;
}

const CODEX_REASONING_KIND_KEY = 'codexReasoningKind';

export function readCodexReasoningKind(source: IHasCodexReasoningMeta): CodexReasoningKind | undefined {
	// eslint-disable-next-line local/code-no-untyped-meta-access -- sanctioned reader for the namespaced Codex reasoning slot; validated below.
	const value = source._meta?.[CODEX_REASONING_KIND_KEY];
	return value === 'summary' || value === 'text' ? value : undefined;
}

export function toCodexReasoningMeta(kind: CodexReasoningKind): Record<string, unknown> {
	return { [CODEX_REASONING_KIND_KEY]: kind };
}
