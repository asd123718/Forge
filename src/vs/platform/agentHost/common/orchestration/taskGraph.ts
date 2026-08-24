/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IOrchestrationPlan, IOrchestrationTaskSpec } from './orchestrationTypes.js';

const PLAN_FENCE = /```(?:json)?\s*([\s\S]*?)```/i;

export function readyTaskIds(tasks: readonly IOrchestrationTaskSpec[], completed: ReadonlySet<string>, blocked: ReadonlySet<string> = new Set()): string[] {
	const ids = new Set(tasks.map(task => task.id));
	return tasks
		.filter(task => {
			if (completed.has(task.id) || blocked.has(task.id)) {
				return false;
			}
			return task.dependsOn.every(dep => !ids.has(dep) || completed.has(dep));
		})
		.map(task => task.id);
}

export function parseOrchestrationPlan(raw: string, depth = 0): IOrchestrationPlan | undefined {
	if (depth > 3) {
		return undefined;
	}
	const fenced = PLAN_FENCE.exec(raw)?.[1]?.trim();
	const candidates = [fenced, extractJsonObject(raw), raw.trim()].filter((value): value is string => !!value);
	for (const candidate of candidates) {
		try {
			const parsed = JSON.parse(candidate) as Record<string, unknown>;
			if (typeof parsed.text === 'string' && parsed.text !== candidate) {
				const nested = parseOrchestrationPlan(parsed.text, depth + 1);
				if (nested) {
					return nested;
				}
			}
			const plan = normalizePlan(parsed);
			if (plan.tasks.length > 0) {
				return plan;
			}
		} catch {
			continue;
		}
	}
	return undefined;
}

export function fallbackOrchestrationPlan(goal: string, workerIds: readonly string[]): IOrchestrationPlan {
	const first = workerIds[0] ?? 'deepseek-harness';
	const second = workerIds[1] ?? workerIds[0] ?? 'grok-build';
	return {
		summary: 'Split the request into two parallel worker tasks.',
		contract: [
			'Stay inside the workspace.',
			'Do not rewrite unrelated files.',
			'Prefer small, reviewable patches.',
			'Run the cheapest relevant test if one exists.',
			'Return a short summary, changed files, test result, and risks. No transcript.',
		].join('\n'),
		tasks: [
			{
				id: 'discover',
				title: 'Map the change and shared interfaces',
				prompt: `Inspect the repository and prepare the shared contract for this request. Do not implement the full feature. Request:\n${goal}`,
				files: [],
				dependsOn: [],
				workerHint: first,
			},
			{
				id: 'implement',
				title: 'Implement the requested change',
				prompt: `Implement the user request with the smallest correct patch. Request:\n${goal}`,
				files: [],
				dependsOn: [],
				workerHint: second,
			},
		],
	};
}

export function normalizePlan(value: Record<string, unknown>): IOrchestrationPlan {
	const tasksRaw = Array.isArray(value.tasks) ? value.tasks : [];
	const tasks: IOrchestrationTaskSpec[] = [];
	const seen = new Set<string>();
	for (let index = 0; index < tasksRaw.length; index++) {
		const entry = tasksRaw[index];
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
			continue;
		}
		const raw = entry as Record<string, unknown>;
		const id = typeof raw.id === 'string' && raw.id.trim() !== '' ? raw.id.trim() : `task-${index + 1}`;
		if (seen.has(id)) {
			continue;
		}
		seen.add(id);
		const files = Array.isArray(raw.files) ? raw.files.filter((file): file is string => typeof file === 'string' && file.trim() !== '').map(file => file.trim()) : [];
		const dependsOn = Array.isArray(raw.dependsOn)
			? raw.dependsOn.filter((dep): dep is string => typeof dep === 'string' && dep.trim() !== '').map(dep => dep.trim())
			: [];
		tasks.push({
			id,
			title: typeof raw.title === 'string' && raw.title.trim() !== '' ? raw.title.trim() : id,
			prompt: typeof raw.prompt === 'string' && raw.prompt.trim() !== '' ? raw.prompt.trim() : typeof raw.title === 'string' ? raw.title : id,
			files,
			dependsOn: dependsOn.filter(dep => dep !== id),
			workerHint: typeof raw.workerHint === 'string' ? raw.workerHint.trim() : typeof raw.worker === 'string' ? raw.worker.trim() : undefined,
			acceptance: typeof raw.acceptance === 'string' ? raw.acceptance.trim() : undefined,
			testCommand: typeof raw.testCommand === 'string' ? raw.testCommand.trim() : undefined,
		});
	}
	return {
		summary: typeof value.summary === 'string' ? value.summary.trim() : '',
		contract: typeof value.contract === 'string' ? value.contract.trim() : '',
		tasks,
	};
}

function extractJsonObject(raw: string): string | undefined {
	const start = raw.indexOf('{');
	const end = raw.lastIndexOf('}');
	if (start < 0 || end <= start) {
		return undefined;
	}
	return raw.slice(start, end + 1);
}
