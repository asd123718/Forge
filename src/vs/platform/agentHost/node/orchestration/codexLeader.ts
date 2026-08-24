/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../../base/common/async.js';
import { URI } from '../../../../base/common/uri.js';
import { ILogService } from '../../../log/common/log.js';
import type { IAgent } from '../../common/agent.js';
import { CODEX_AGENT_PROVIDER_ID } from '../../common/agent.js';
import { leaderImplementPrompt, leaderPlanPrompt, leaderReviewPrompt } from '../../common/orchestration/leaderPrompts.js';
import type { ILeaderPlanContext, ILeaderProvider, IOrchestrationPlan, IOrchestrationRunState, IOrchestrationTaskState, IWorkerProvider, IWorkerRunRequest, IWorkerTaskResult } from '../../common/orchestration/orchestrationTypes.js';
import { CODEX_LEADER_PROVIDER_ID } from '../../common/orchestration/orchestrationTypes.js';
import { fallbackOrchestrationPlan, parseOrchestrationPlan } from '../../common/orchestration/taskGraph.js';
import { AHP_CHAT_SCHEME, buildDefaultChatUri, parseChatUri, ResponsePartKind, type Turn } from '../../common/state/sessionState.js';
import { IAgentHostStateManager } from '../agentHostStateManager.js';
import { workerPrompt } from './workerAdapters.js';

export class LocalLeaderProvider implements ILeaderProvider {
	readonly id = 'local-fallback';
	readonly label = 'Local planner';

	async plan(context: ILeaderPlanContext, _abort: AbortSignal): Promise<IOrchestrationPlan> {
		return fallbackOrchestrationPlan(context.goal, context.workers.map(worker => worker.providerId));
	}

	async review(run: IOrchestrationRunState, _abort: AbortSignal): Promise<string> {
		const failed = run.tasks.filter(task => task.status === 'failed' || task.status === 'escalated');
		if (failed.length === 0) {
			return 'Workers finished. Review the native Diff / Changes view, then keep or revert the patch.';
		}
		return `Workers finished with ${failed.length} failed task(s): ${failed.map(task => task.title).join(', ')}. Retry or escalate those tasks.`;
	}

	async implement(task: IOrchestrationTaskState, _workspace: string, _contract: string, _abort: AbortSignal): Promise<IWorkerTaskResult> {
		return {
			status: 'failed',
			summary: '',
			changedFiles: [],
			error: `No high-intelligence leader is available to escalate "${task.title}".`,
			usage: { durationMs: 0 },
		};
	}
}

export class CodexLeaderProvider implements ILeaderProvider {
	readonly id = CODEX_AGENT_PROVIDER_ID;
	readonly label = 'Codex';

	constructor(
		private readonly _getAgent: () => IAgent | undefined,
		private readonly _stateManager: IAgentHostStateManager,
		private readonly _fallback: ILeaderProvider,
		@ILogService private readonly _logService: ILogService,
	) { }

	async plan(context: ILeaderPlanContext, abort: AbortSignal): Promise<IOrchestrationPlan> {
		const text = await askCodex(this._getAgent, this._stateManager, this._logService, context.chatUri, context.workspace, context.sessionUri, leaderPlanPrompt(context), abort);
		return parseOrchestrationPlan(text) ?? this._fallback.plan(context, abort);
	}

	async review(run: IOrchestrationRunState, abort: AbortSignal): Promise<string> {
		const text = await askCodex(this._getAgent, this._stateManager, this._logService, run.chatUri, run.workspace, run.sessionUri, leaderReviewPrompt(run), abort);
		return text.trim() !== '' ? text : this._fallback.review(run, abort);
	}

	async implement(task: IOrchestrationTaskState, workspace: string, contract: string, abort: AbortSignal, run?: IOrchestrationRunState): Promise<IWorkerTaskResult> {
		if (!run) {
			return this._fallback.implement(task, workspace, contract, abort, run);
		}
		const startedAt = Date.now();
		try {
			const summary = await askCodex(this._getAgent, this._stateManager, this._logService, run.chatUri, workspace, run.sessionUri, leaderImplementPrompt(task, contract), abort);
			return {
				status: summary.trim() === '' ? 'failed' : 'completed',
				summary,
				changedFiles: [],
				usage: { durationMs: Date.now() - startedAt },
			};
		} catch (error) {
			return {
				status: 'failed',
				summary: '',
				changedFiles: [],
				error: error instanceof Error ? error.message : String(error),
				usage: { durationMs: Date.now() - startedAt },
			};
		}
	}
}

export class CodexWorkerProvider implements IWorkerProvider {
	readonly id = CODEX_LEADER_PROVIDER_ID;
	readonly label = 'Codex';
	readonly defaultModel = 'gpt-5.6-sol';

	constructor(
		private readonly _getAgent: () => IAgent | undefined,
		private readonly _stateManager: IAgentHostStateManager,
		@ILogService private readonly _logService: ILogService,
	) { }

	async isAvailable(): Promise<boolean> {
		return !!this._getAgent();
	}

	async run(request: IWorkerRunRequest): Promise<IWorkerTaskResult> {
		const startedAt = Date.now();
		try {
			const summary = await askCodex(this._getAgent, this._stateManager, this._logService, request.chatUri, request.workspace, request.sessionUri, workerPrompt(request), request.abort);
			return {
				status: summary.trim() === '' ? 'failed' : 'completed',
				summary: summary.slice(0, 2000),
				changedFiles: [],
				error: summary.trim() === '' ? 'Codex worker returned an empty result.' : undefined,
				usage: { durationMs: Date.now() - startedAt },
			};
		} catch (error) {
			return {
				status: 'failed',
				summary: '',
				changedFiles: [],
				error: error instanceof Error ? error.message : String(error),
				usage: { durationMs: Date.now() - startedAt },
			};
		}
	}
}

async function askCodex(
	getAgent: () => IAgent | undefined,
	stateManager: IAgentHostStateManager,
	logService: ILogService,
	chatUri: string,
	workspace: string,
	sessionUri: string,
	prompt: string,
	abort: AbortSignal,
): Promise<string> {
	const agent = getAgent();
	if (!agent) {
		return '';
	}
	const { chat, session } = resolveLeaderAddresses(chatUri, sessionUri);
	try {
		await agent.chats.sendMessage(chat, prompt, URI.file(workspace), undefined, undefined, undefined, undefined, session);
		await waitForCodexIdle(stateManager, chat, abort);
		const turns = await agent.chats.getMessages(chat, session);
		return lastMarkdown(turns);
	} catch (error) {
		logService.warn(`[ForgeOrchestration] Codex turn failed: ${error instanceof Error ? error.message : String(error)}`);
		return '';
	}
}

async function waitForCodexIdle(stateManager: IAgentHostStateManager, chat: URI, abort: AbortSignal): Promise<void> {
	const deadline = Date.now() + 8 * 60_000;
	while (Date.now() < deadline) {
		if (abort.aborted) {
			throw new Error('Cancelled');
		}
		if (!stateManager.getActiveTurnId(chat)) {
			await timeout(350);
			if (!stateManager.getActiveTurnId(chat)) {
				return;
			}
		}
		await timeout(350);
	}
}

function lastMarkdown(turns: readonly Turn[]): string {
	for (let index = turns.length - 1; index >= 0; index--) {
		const text = turns[index].responseParts
			.filter(part => part.kind === ResponsePartKind.Markdown)
			.map(part => part.content)
			.join('\n')
			.trim();
		if (text) {
			return text;
		}
	}
	return '';
}

export function resolveLeaderAddresses(chatUri: string, sessionUri: string): { chat: URI; session: URI } {
	const parsedChat = tryParseUri(chatUri);
	const parsedSession = tryParseUri(sessionUri);
	const fromChat = parsedChat ? parseChatUri(parsedChat) : undefined;
	let session = parsedSession ?? (fromChat ? URI.parse(fromChat.session) : parsedChat);
	if (session && session.scheme.startsWith('agent-host-')) {
		session = URI.from({
			scheme: session.scheme.slice('agent-host-'.length),
			path: session.path.startsWith('/') ? session.path : `/${session.path}`,
		});
	}
	if (!session) {
		session = URI.parse('codex:///forge-orchestration');
	}
	const chat = parsedChat?.scheme === AHP_CHAT_SCHEME ? parsedChat : URI.parse(buildDefaultChatUri(session));
	return { chat, session };
}

function tryParseUri(value: string): URI | undefined {
	if (!value) {
		return undefined;
	}
	try {
		return URI.parse(value);
	} catch {
		return undefined;
	}
}
