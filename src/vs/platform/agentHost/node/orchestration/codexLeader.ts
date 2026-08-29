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
import type { ILeaderPlanContext, ILeaderProvider, IOrchestrationPlan, IOrchestrationProgressHooks, IOrchestrationRunState, IOrchestrationTaskState, IWorkerAvailability, IWorkerProvider, IWorkerRunRequest, IWorkerTaskResult } from '../../common/orchestration/orchestrationTypes.js';
import { CODEX_LEADER_PROVIDER_ID } from '../../common/orchestration/orchestrationTypes.js';
import { fallbackOrchestrationPlan, parseOrchestrationPlan } from '../../common/orchestration/taskGraph.js';
import { buildDefaultChatUri, parseChatUri, ResponsePartKind, type Turn } from '../../common/state/sessionState.js';
import type { AgentHostStateManager } from '../agentHostStateManager.js';
import { workerPrompt } from './workerAdapters.js';

export class LocalLeaderProvider implements ILeaderProvider {
	readonly id = 'local-fallback';
	readonly label = 'Local planner';

	async plan(context: ILeaderPlanContext, _abort: AbortSignal): Promise<IOrchestrationPlan> {
		const plan = fallbackOrchestrationPlan(context.goal, context.workers.map(worker => worker.providerId));
		context.hooks?.onProgress?.({ progress: 'Using local fallback planner.', output: plan.summary });
		return plan;
	}

	async review(run: IOrchestrationRunState, _abort: AbortSignal, hooks?: IOrchestrationProgressHooks): Promise<string> {
		const failed = run.tasks.filter(task => task.status === 'failed' || task.status === 'cancelled');
		const review = failed.length === 0
			? 'Workers finished. Review the native Diff / Changes view, then keep or revert the patch.'
			: `Workers finished with ${failed.length} failed task(s): ${failed.map(task => task.title).join(', ')}. Retry or escalate those tasks.`;
		hooks?.onProgress?.({ progress: review, output: review });
		return review;
	}

	async implement(task: IOrchestrationTaskState, _workspace: string, _contract: string, _abort: AbortSignal, _run?: IOrchestrationRunState, hooks?: IOrchestrationProgressHooks): Promise<IWorkerTaskResult> {
		const error = `No high-intelligence leader is available to escalate "${task.title}".`;
		hooks?.onProgress?.({ progress: error, output: error });
		return {
			status: 'failed',
			summary: '',
			changedFiles: [],
			error,
			usage: { durationMs: 0 },
		};
	}
}

export class CodexLeaderProvider implements ILeaderProvider {
	readonly id = CODEX_AGENT_PROVIDER_ID;
	readonly label = 'Codex';

	constructor(
		private readonly _getAgent: () => IAgent | undefined,
		private readonly _stateManager: AgentHostStateManager,
		private readonly _fallback: ILeaderProvider,
		@ILogService private readonly _logService: ILogService,
	) { }

	async plan(context: ILeaderPlanContext, abort: AbortSignal): Promise<IOrchestrationPlan> {
		const content = await askCodex(this._getAgent, this._stateManager, this._logService, context.chatUri, context.workspace, context.sessionUri, leaderPlanPrompt(context), abort, context.hooks);
		return parseOrchestrationPlan(content.output) ?? this._fallback.plan(context, abort);
	}

	async review(run: IOrchestrationRunState, abort: AbortSignal, hooks?: IOrchestrationProgressHooks): Promise<string> {
		const content = await askCodex(this._getAgent, this._stateManager, this._logService, run.chatUri, run.workspace, run.sessionUri, leaderReviewPrompt(run), abort, hooks);
		return content.output.trim() !== '' ? content.output : this._fallback.review(run, abort, hooks);
	}

	async implement(task: IOrchestrationTaskState, workspace: string, contract: string, abort: AbortSignal, run?: IOrchestrationRunState, hooks?: IOrchestrationProgressHooks): Promise<IWorkerTaskResult> {
		if (!run) {
			return this._fallback.implement(task, workspace, contract, abort, run, hooks);
		}
		const startedAt = Date.now();
		try {
			const content = await askCodex(this._getAgent, this._stateManager, this._logService, run.chatUri, workspace, run.sessionUri, leaderImplementPrompt(task, contract), abort, hooks);
			return {
				status: content.output.trim() === '' ? 'failed' : 'completed',
				summary: content.output,
				changedFiles: [],
				error: content.output.trim() === '' ? 'Codex leader returned an empty result.' : undefined,
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
		private readonly _stateManager: AgentHostStateManager,
		@ILogService private readonly _logService: ILogService,
	) { }

	async checkAvailability(): Promise<IWorkerAvailability> {
		const available = !!this._getAgent();
		return { available, executable: 'codex', reason: available ? undefined : 'agent-unavailable' };
	}

	async isAvailable(): Promise<boolean> {
		return (await this.checkAvailability()).available;
	}

	async run(request: IWorkerRunRequest): Promise<IWorkerTaskResult> {
		const startedAt = Date.now();
		try {
			const content = await askCodex(this._getAgent, this._stateManager, this._logService, request.chatUri, request.workspace, request.sessionUri, workerPrompt(request), request.abort, request.hooks);
			return {
				status: content.output.trim() === '' ? 'failed' : 'completed',
				summary: content.output.slice(0, 2000),
				changedFiles: [],
				error: content.output.trim() === '' ? 'Codex worker returned an empty result.' : undefined,
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

interface ICodexTurnContent {
	readonly thinking: string;
	readonly output: string;
}

async function askCodex(
	getAgent: () => IAgent | undefined,
	stateManager: AgentHostStateManager,
	logService: ILogService,
	chatUri: string,
	workspace: string,
	sessionUri: string,
	prompt: string,
	abort: AbortSignal,
	hooks?: IOrchestrationProgressHooks,
): Promise<ICodexTurnContent> {
	const agent = getAgent();
	if (!agent) {
		const message = 'Codex agent is not available.';
		hooks?.onProgress?.({ progress: message, output: '' });
		return { thinking: '', output: '' };
	}
	const { chat, session } = resolveLeaderAddresses(chatUri, sessionUri);
	try {
		// Prefer the live chat binding; passing an unbound session URI makes Codex look up the wrong session.
		try {
			await agent.chats.sendMessage(chat, prompt, URI.file(workspace));
		} catch (bindingError) {
			await agent.chats.sendMessage(chat, prompt, URI.file(workspace), undefined, undefined, undefined, undefined, session);
			if (bindingError instanceof Error) {
				logService.trace(`[ForgeOrchestration] Codex chat binding retry: ${bindingError.message}`);
			}
		}
		let lastContent: ICodexTurnContent = { thinking: '', output: '' };
		const deadline = Date.now() + 8 * 60_000;
		while (Date.now() < deadline) {
			if (abort.aborted) {
				throw new Error('Cancelled');
			}
			const turns = await agent.chats.getMessages(chat, session);
			const content = lastTurnContent(turns);
			if (content.thinking !== lastContent.thinking || content.output !== lastContent.output) {
				lastContent = content;
				hooks?.onProgress?.(content);
			}
			if (!stateManager.getActiveTurnId(chat.toString())) {
				await timeout(350);
				if (!stateManager.getActiveTurnId(chat.toString())) {
					return lastTurnContent(await agent.chats.getMessages(chat, session));
				}
			}
			await timeout(350);
		}
		return lastContent;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logService.warn(`[ForgeOrchestration] Codex turn failed: ${message}`);
		hooks?.onProgress?.({ progress: message, output: '' });
		return { thinking: '', output: '' };
	}
}

function lastTurnContent(turns: readonly Turn[]): ICodexTurnContent {
	for (let index = turns.length - 1; index >= 0; index--) {
		const thinking = turns[index].responseParts
			.filter(part => part.kind === ResponsePartKind.Reasoning)
			.map(part => part.content)
			.join('\n')
			.trim();
		const output = turns[index].responseParts
			.filter(part => part.kind === ResponsePartKind.Markdown)
			.map(part => part.content)
			.join('\n')
			.trim();
		if (thinking || output) {
			return { thinking, output };
		}
	}
	return { thinking: '', output: '' };
}

export function resolveLeaderAddresses(chatUri: string, sessionUri: string): { chat: URI; session: URI } {
	const parsedChat = tryParseUri(chatUri);
	const parsedSession = tryParseUri(sessionUri);
	const fromChat = parsedChat ? parseChatUri(parsedChat) : undefined;
	let session = parsedSession ?? (fromChat ? URI.parse(fromChat.session) : undefined);
	if (session && session.scheme.startsWith('agent-host-')) {
		session = URI.from({
			scheme: session.scheme.slice('agent-host-'.length),
			path: session.path.startsWith('/') ? session.path : `/${session.path}`,
		});
	}
	const chat = parsedChat ?? (session ? URI.parse(buildDefaultChatUri(session)) : undefined);
	if (!chat || !session) {
		throw new Error('Invalid orchestration chat/session address.');
	}
	return { chat, session };
}

function tryParseUri(value: string): URI | undefined {
	try {
		return value ? URI.parse(value) : undefined;
	} catch {
		return undefined;
	}
}
