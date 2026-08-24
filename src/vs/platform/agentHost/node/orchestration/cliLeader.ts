/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ILeaderPlanContext, ILeaderProvider, IOrchestrationPlan, IOrchestrationRunState, IOrchestrationTaskState, IWorkerTaskResult } from '../../common/orchestration/orchestrationTypes.js';
import { leaderImplementPrompt, leaderPlanPrompt, leaderReviewPrompt } from '../../common/orchestration/leaderPrompts.js';
import { parseOrchestrationPlan } from '../../common/orchestration/taskGraph.js';
import type { ProcessRunner } from './workerAdapters.js';
import { parseWorkerSummary } from './workerAdapters.js';

export type CliLeaderInvoke = (prompt: string, workspace: string, model: string | undefined, abort: AbortSignal) => Promise<string>;

export class CliLeaderProvider implements ILeaderProvider {
	constructor(
		readonly id: string,
		readonly label: string,
		private readonly _invoke: CliLeaderInvoke,
		private readonly _fallback: ILeaderProvider,
	) { }

	async plan(context: ILeaderPlanContext, abort: AbortSignal): Promise<IOrchestrationPlan> {
		const text = await this._safeInvoke(leaderPlanPrompt(context), context.workspace, context.leader.model, abort);
		return parseOrchestrationPlan(text) ?? this._fallback.plan(context, abort);
	}

	async review(run: IOrchestrationRunState, abort: AbortSignal): Promise<string> {
		const text = (await this._safeInvoke(leaderReviewPrompt(run), run.workspace, run.assignment.leader.model, abort)).trim();
		return text !== '' ? text : this._fallback.review(run, abort);
	}

	async implement(task: IOrchestrationTaskState, workspace: string, contract: string, abort: AbortSignal, run?: IOrchestrationRunState): Promise<IWorkerTaskResult> {
		const startedAt = Date.now();
		const text = await this._safeInvoke(leaderImplementPrompt(task, contract), workspace, run?.assignment.leader.model, abort);
		if (text.trim() === '') {
			return this._fallback.implement(task, workspace, contract, abort, run);
		}
		return parseWorkerSummary(text, 0, startedAt);
	}

	private async _safeInvoke(prompt: string, workspace: string, model: string | undefined, abort: AbortSignal): Promise<string> {
		try {
			return await this._invoke(prompt, workspace, model, abort);
		} catch {
			return '';
		}
	}
}

export function createDeepSeekLeader(
	runner: ProcessRunner,
	resolveCommand: () => Promise<{ command: string; args: string[]; env: NodeJS.ProcessEnv } | undefined>,
	fallback: ILeaderProvider,
): CliLeaderProvider {
	return new CliLeaderProvider('deepseek-harness', 'DeepSeek Harness', async (prompt, workspace, _model, abort) => {
		const resolved = await resolveCommand();
		if (!resolved) {
			return '';
		}
		const result = await runner(resolved.command, [...resolved.args, prompt], { cwd: workspace, env: resolved.env, abort });
		return result.stdout || result.stderr;
	}, fallback);
}

export function createGrokLeader(
	runner: ProcessRunner,
	resolveCommand: () => Promise<{ command: string; prefixArgs: string[]; env: NodeJS.ProcessEnv } | undefined>,
	fallback: ILeaderProvider,
): CliLeaderProvider {
	return new CliLeaderProvider('grok-build', 'Grok Build', async (prompt, workspace, model, abort) => {
		const resolved = await resolveCommand();
		if (!resolved) {
			return '';
		}
		const result = await runner(resolved.command, [
			...resolved.prefixArgs,
			'-p', prompt,
			'--cwd', workspace,
			'--yolo',
			'--no-auto-update',
			'--output-format', 'json',
			'-m', model ?? 'grok-4.6',
		], { cwd: workspace, env: resolved.env, abort });
		return result.stdout || result.stderr;
	}, fallback);
}
