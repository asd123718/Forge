/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ILeaderPlanContext, IOrchestrationRunState, IOrchestrationTaskState } from './orchestrationTypes.js';

export function leaderPlanPrompt(context: ILeaderPlanContext): string {
	return [
		'You are the Forge Leader. Do not write implementation code.',
		'Understand the request, define shared interfaces/style/directory boundaries/acceptance, and emit a JSON task DAG.',
		'Prefer two or more independent worker tasks that can run in parallel.',
		`Available workers: ${context.workers.map(worker => `${worker.providerId}${worker.model ? ` (${worker.model})` : ''}`).join(', ')}`,
		'Reply with JSON only:',
		'{"summary":"...","contract":"...","tasks":[{"id":"t1","title":"...","prompt":"...","files":[],"dependsOn":[],"workerHint":"deepseek-harness"}]}',
		`Request:\n${context.goal}`,
	].join('\n\n');
}

export function leaderReviewPrompt(run: IOrchestrationRunState): string {
	const body = run.tasks.map(task => [
		`# ${task.title} [${task.status}] (${task.workerLabel})`,
		task.result?.summary ?? task.error ?? '',
		`files: ${(task.result?.changedFiles ?? []).join(', ') || '(none)'}`,
		task.result?.testsPassed === undefined ? '' : `testsPassed: ${task.result.testsPassed}`,
		task.result?.risk ? `risk: ${task.result.risk}` : '',
	].filter(Boolean).join('\n')).join('\n\n');
	return [
		'You are the Forge Leader reviewing worker results. Do not rewrite the whole change unless a worker failed and needs escalation.',
		'Summarize what landed, what is still risky, and whether the user request is satisfied.',
		`Original request:\n${run.goal}`,
		`Worker reports:\n${body}`,
	].join('\n\n');
}

export function leaderImplementPrompt(task: IOrchestrationTaskState, contract: string): string {
	return [
		'A worker failed this task. Implement it yourself with a small patch.',
		`Contract:\n${contract}`,
		`Task: ${task.title}`,
		task.prompt,
		'When finished, reply with a short structured summary only: status, changed files, test result, risks. No chat transcript.',
	].join('\n\n');
}
