/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Logos uses a single Diff editor. Dialectic assigns each worker a split pane. */
export type LiveEditPane = 'diff' | 0 | 1;

export interface IDialecticLiveEditTaskRef {
	readonly workerProviderId: string;
	readonly files: readonly string[];
	readonly changedFiles?: readonly string[];
}

export function liveEditPreviewUsesSplit(pane: LiveEditPane | undefined): pane is 0 | 1 {
	return pane === 0 || pane === 1;
}

export function liveEditPreviewPaneKey(pane: LiveEditPane | undefined): string {
	return liveEditPreviewUsesSplit(pane) ? String(pane) : 'diff';
}

export function dialecticLiveEditContextKey(chatKey: string, runId: string | undefined, requestId: string): string {
	return runId ? `${chatKey}\0${runId}` : `${chatKey}\0${requestId}`;
}

/**
 * Pins Dialectic workers to stable panes: assignment[0] stays left, assignment[1]
 * stays right. Unknown sources fall back to first-come slots so two files still
 * land in two groups.
 */
export function dialecticLiveEditPane(sourceId: string, workerIds: readonly string[], slots: DialecticLiveEditSlotMap): 0 | 1 {
	const index = workerIds.indexOf(sourceId);
	if (index === 1) {
		return 1;
	}
	if (index === 0) {
		return 0;
	}
	return slots.slotFor(sourceId);
}

export function dialecticLiveEditSourceId(filePath: string, tasks: readonly IDialecticLiveEditTaskRef[]): string {
	const normalized = normalizeLiveEditPath(filePath);
	if (normalized === '') {
		return filePath;
	}
	const name = liveEditPathName(normalized);
	for (const task of tasks) {
		const candidates = [...task.files, ...(task.changedFiles ?? [])];
		if (candidates.some(candidate => liveEditPathsOverlap(normalized, normalizeLiveEditPath(candidate), name))) {
			return task.workerProviderId;
		}
	}
	return normalized;
}

/** First distinct source keeps the left pane, second source keeps the right. Extra sources reuse the left. */
export class DialecticLiveEditSlotMap {
	private readonly _slots = new Map<string, 0 | 1>();

	reset(): void {
		this._slots.clear();
	}

	slotFor(sourceId: string): 0 | 1 {
		const existing = this._slots.get(sourceId);
		if (existing !== undefined) {
			return existing;
		}
		const used = new Set(this._slots.values());
		const slot: 0 | 1 = !used.has(0) ? 0 : !used.has(1) ? 1 : 0;
		this._slots.set(sourceId, slot);
		return slot;
	}
}

export function normalizeLiveEditPath(path: string): string {
	return path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

function liveEditPathName(path: string): string {
	const parts = path.split('/');
	return parts[parts.length - 1] ?? path;
}

function liveEditPathsOverlap(left: string, right: string, leftName: string): boolean {
	if (right === '') {
		return false;
	}
	if (left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`)) {
		return true;
	}
	return !right.includes('/') && right === leftName;
}
