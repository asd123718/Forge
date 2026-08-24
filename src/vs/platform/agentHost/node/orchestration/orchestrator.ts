/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ILogService } from '../../../log/common/log.js';
import { INativeEnvironmentService } from '../../../environment/common/environment.js';
import type { IAgent } from '../../common/agent.js';
import type {
	ILeaderProvider,
	IOrchestrationAssignment,
	IOrchestrationCommand,
	IOrchestrationPlan,
	IOrchestrationRequest,
	IOrchestrationRunState,
	IOrchestrationTaskState,
	IOrchestrationUsage,
	IWorkerProvider,
	IWorkerTaskResult,
} from '../../common/orchestration/orchestrationTypes.js';
import {
	DEFAULT_ORCHESTRATION_ASSIGNMENT,
	FORGE_ORCHESTRATION_ASSIGNMENT_KEY,
	FORGE_ORCHESTRATION_COMMAND_KEY,
	FORGE_ORCHESTRATION_REQUEST_KEY,
	FORGE_ORCHESTRATION_STATE_KEY,
	isOrchestrationRequest,
	readAssignment,
} from '../../common/orchestration/orchestrationTypes.js';
import { readyTaskIds } from '../../common/orchestration/taskGraph.js';
import { IAgentConfigurationService } from '../agentConfigurationService.js';
import { CodexLeaderProvider, CodexWorkerProvider, LocalLeaderProvider } from './codexLeader.js';
import { createDeepSeekLeader, createGrokLeader } from './cliLeader.js';
import { IAgentHostStateManager } from '../agentHostStateManager.js';
import { createNodeProcessRunner, DeepSeekHarnessWorker, GrokBuildWorker, resolveDeepSeekCommand, resolveGrokCommand } from './workerAdapters.js';
import { openWorkerWorkspace } from './workerWorkspace.js';
import { CODEX_MODELS_ROOT_CONFIG_KEY, normalizeCodexModelsConfig } from '../../common/codexModelsConfig.js';
import { parseForgeVendorAccountInfo, vendorAccountMetaKey } from '../../common/forgeVendorAccount.js';
import { findOfficialModelProvider, officialApiFallbackReady, remainingPercentFromUsed } from '../../common/officialModelCards.js';
import { getVendorAccountSecret, providerSecretId } from './vendorAccountSecrets.js';

const MAX_TASK_ATTEMPTS = 2;

export class ForgeOrchestrationService extends Disposable {
	private _run: IOrchestrationRunState | undefined;
	private _abort: AbortController | undefined;
	private _paused = false;
	private _getCodex: (() => IAgent | undefined) | undefined;
	private _lastRequestId: string | undefined;
	private _lastCommandId: string | undefined;
	private readonly _workers = new Map<string, IWorkerProvider>();
	private readonly _leaders = new Map<string, ILeaderProvider>();
	private readonly _fallbackLeader = new LocalLeaderProvider();
	private _overrideLeader: ILeaderProvider | undefined;
	private _activeLeader: ILeaderProvider = this._fallbackLeader;

	constructor(
		@IAgentConfigurationService private readonly _configuration: IAgentConfigurationService,
		@IAgentHostStateManager stateManager: IAgentHostStateManager,
		@ILogService private readonly _logService: ILogService,
		@INativeEnvironmentService environment: INativeEnvironmentService,
	) {
		super();
		const runner = createNodeProcessRunner();
		const repoRoot = environment.appRoot;
		const resolveDeepSeek = async () => resolveDeepSeekCommand(repoRoot, this._workerEnv('deepseek'));
		const resolveGrok = async () => resolveGrokCommand(repoRoot, this._workerEnv('grok'));
		this._workers.set('codex', new CodexWorkerProvider(() => this._getCodex?.(), stateManager, this._logService));
		this._workers.set('deepseek-harness', new DeepSeekHarnessWorker(runner, resolveDeepSeek));
		this._workers.set('grok-build', new GrokBuildWorker(runner, resolveGrok, 'grok-4.6'));
		this._leaders.set('codex', new CodexLeaderProvider(() => this._getCodex?.(), stateManager, this._fallbackLeader, this._logService));
		this._leaders.set('deepseek-harness', createDeepSeekLeader(runner, resolveDeepSeek, this._fallbackLeader));
		this._leaders.set('grok-build', createGrokLeader(runner, resolveGrok, this._fallbackLeader));
		this._activeLeader = this._leaders.get('codex') ?? this._fallbackLeader;
		this._register(toDisposable(() => this._abort?.abort()));
		this._register(this._configuration.onDidRootConfigChange(() => this._onRootConfig()));
		this._configuration.publishRootTransientValues?.({
			[FORGE_ORCHESTRATION_REQUEST_KEY]: undefined,
			[FORGE_ORCHESTRATION_COMMAND_KEY]: undefined,
			[FORGE_ORCHESTRATION_STATE_KEY]: undefined,
		});
		this._publish();
	}

	bindCodex(getAgent: () => IAgent | undefined): void {
		this._getCodex = getAgent;
	}

	registerWorker(worker: IWorkerProvider): void {
		this._workers.set(worker.id, worker);
	}

	registerLeader(leader: ILeaderProvider): void {
		this._leaders.set(leader.id, leader);
	}

	setLeader(leader: ILeaderProvider): void {
		this._overrideLeader = leader;
		this._activeLeader = leader;
	}

	get state(): IOrchestrationRunState | undefined {
		return this._run;
	}

	private _onRootConfig(): void {
		const values = this._configuration.getRootConfigValues?.() ?? {};
		const request = values[FORGE_ORCHESTRATION_REQUEST_KEY];
		if (isOrchestrationRequest(request) && request.requestId !== this._lastRequestId) {
			this._lastRequestId = request.requestId ?? request.goal;
			this._configuration.updateRootConfig({ [FORGE_ORCHESTRATION_REQUEST_KEY]: { consumed: this._lastRequestId } });
			void this.start(request).catch(error => {
				this._logService.error(`[ForgeOrchestration] run failed: ${error instanceof Error ? error.message : String(error)}`);
			});
		}
		const command = values[FORGE_ORCHESTRATION_COMMAND_KEY];
		if (command && typeof command === 'object' && !Array.isArray(command) && typeof (command as IOrchestrationCommand).type === 'string') {
			const typed = command as IOrchestrationCommand;
			if (typed.commandId && typed.commandId === this._lastCommandId) {
				return;
			}
			this._lastCommandId = typed.commandId ?? `${typed.type}:${typed.taskId ?? ''}`;
			this._configuration.updateRootConfig({ [FORGE_ORCHESTRATION_COMMAND_KEY]: { consumed: this._lastCommandId } });
			void this.command(typed);
		}
	}

	async start(request: IOrchestrationRequest): Promise<IOrchestrationRunState> {
		this._abort?.abort();
		this._abort = new AbortController();
		this._paused = false;
		const stored = readAssignment(this._configuration.getRootConfigValues?.()?.[FORGE_ORCHESTRATION_ASSIGNMENT_KEY]);
		const assignment = request.mode === 'logos'
			? request.assignment ?? stored ?? DEFAULT_ORCHESTRATION_ASSIGNMENT
			: stored ?? request.assignment ?? DEFAULT_ORCHESTRATION_ASSIGNMENT;
		this._run = {
			runId: generateUuid(),
			status: request.mode === 'logos' ? 'running' : 'planning',
			goal: request.goal,
			chatUri: request.chatUri,
			sessionUri: request.sessionUri,
			workspace: request.workspace,
			assignment,
			tasks: [],
			startedAt: Date.now(),
			updatedAt: Date.now(),
			usage: emptyUsage(),
		};
		this._publish();
		try {
			this._activeLeader = this._leaderFor(assignment);
			if (request.mode === 'logos') {
				return await this._runLogos(request, assignment, this._abort.signal);
			}
			const plan = await this._activeLeader.plan({
				goal: request.goal,
				workspace: request.workspace,
				chatUri: request.chatUri,
				sessionUri: request.sessionUri,
				leader: assignment.leader,
				workers: assignment.workers,
			}, this._abort.signal);
			this._run = {
				...this._run,
				status: 'running',
				planSummary: plan.summary,
				contract: plan.contract,
				tasks: plan.tasks.map((task, index) => this._toTaskState(task, assignment, index)),
				updatedAt: Date.now(),
			};
			this._publish();
			await this._pump(this._abort.signal);
			if (this._run.status === 'cancelled' || this._run.status === 'paused') {
				return this._run;
			}
			this._run = { ...this._run, status: 'reviewing', updatedAt: Date.now() };
			this._publish();
			const review = await this._activeLeader.review(this._run, this._abort.signal);
			this._run = { ...this._run, status: 'completed', review, updatedAt: Date.now(), usage: this._sumUsage(this._run.tasks) };
			this._publish();
			return this._run;
		} catch (error) {
			if (this._run) {
				this._run = {
					...this._run,
					status: this._abort?.signal.aborted ? 'cancelled' : 'failed',
					error: error instanceof Error ? error.message : String(error),
					updatedAt: Date.now(),
				};
				this._publish();
				return this._run;
			}
			throw error;
		}
	}

	async command(command: IOrchestrationCommand): Promise<void> {
		if (!this._run || (command.runId && command.runId !== this._run.runId)) {
			return;
		}
		if (command.type === 'cancel') {
			this._abort?.abort();
			this._run = { ...this._run, status: 'cancelled', updatedAt: Date.now() };
			this._publish();
			return;
		}
		if (command.type === 'pause') {
			this._paused = true;
			this._run = { ...this._run, status: 'paused', updatedAt: Date.now() };
			this._publish();
			return;
		}
		if (command.type === 'resume') {
			this._paused = false;
			this._abort = new AbortController();
			this._run = { ...this._run, status: 'running', updatedAt: Date.now() };
			this._publish();
			await this._pump(this._abort.signal);
			return;
		}
		if (!command.taskId) {
			return;
		}
		const task = this._run.tasks.find(candidate => candidate.id === command.taskId);
		if (!task) {
			return;
		}
		if (command.type === 'retry') {
			this._updateTask(task.id, { status: 'queued', error: undefined });
			this._paused = false;
			this._abort = new AbortController();
			this._run = { ...this._run, status: 'running', updatedAt: Date.now() };
			this._publish();
			await this._pump(this._abort.signal);
			return;
		}
		if (command.type === 'escalate') {
			await this._escalate(task, this._abort?.signal ?? new AbortController().signal);
			return;
		}
		if (command.type === 'reassign' && command.workerProviderId) {
			const worker = this._workerRef(this._run.assignment, command.workerProviderId);
			this._updateTask(task.id, {
				status: 'queued',
				workerProviderId: worker.providerId,
				workerLabel: worker.label,
				workerModel: worker.model,
			});
			this._publish();
		}
	}

	private async _runLogos(request: IOrchestrationRequest, assignment: IOrchestrationAssignment, abort: AbortSignal): Promise<IOrchestrationRunState> {
		if (!this._run) {
			throw new Error('Logos run was not initialized.');
		}
		const worker = assignment.leader;
		this._run = {
			...this._run,
			status: 'running',
			planSummary: request.goal,
			tasks: [{
				id: 'logos',
				title: request.goal.slice(0, 80) || worker.label,
				prompt: request.goal,
				files: [],
				dependsOn: [],
				workerProviderId: worker.providerId,
				workerLabel: worker.label,
				workerModel: worker.model,
				thinkingLevel: worker.thinkingLevel,
				contextSize: worker.contextSize,
				status: 'queued',
				attempt: 0,
			}],
			updatedAt: Date.now(),
		};
		this._publish();
		await this._pump(abort);
		if (this._run.status === 'cancelled' || this._run.status === 'paused') {
			return this._run;
		}
		const failed = this._run.tasks.some(task => task.status === 'failed');
		this._run = {
			...this._run,
			status: failed ? 'failed' : 'completed',
			error: failed ? this._run.tasks.find(task => task.error)?.error : undefined,
			updatedAt: Date.now(),
			usage: this._sumUsage(this._run.tasks),
		};
		this._publish();
		return this._run;
	}

	private async _pump(abort: AbortSignal): Promise<void> {
		while (this._run && !this._paused && !abort.aborted) {
			const completed = new Set(this._run.tasks.filter(task => task.status === 'completed' || task.status === 'escalated').map(task => task.id));
			const blocked = new Set(this._run.tasks.filter(task => task.status === 'running' || task.status === 'cancelled').map(task => task.id));
			const ready = readyTaskIds(this._run.tasks, completed, blocked)
				.filter(id => this._run!.tasks.find(task => task.id === id)?.status === 'queued' || this._run!.tasks.find(task => task.id === id)?.status === 'retry');
			if (ready.length === 0) {
				if (this._run.tasks.some(task => task.status === 'running')) {
					await delay(200, abort);
					continue;
				}
				return;
			}
			await Promise.all(ready.map(id => this._runTask(id, abort)));
		}
	}

	private async _runTask(taskId: string, abort: AbortSignal): Promise<void> {
		const task = this._run?.tasks.find(candidate => candidate.id === taskId);
		if (!task || !this._run) {
			return;
		}
		this._updateTask(taskId, { status: 'running', attempt: task.attempt + 1 });
		this._publish();
		const workspace = await openWorkerWorkspace(this._run.workspace, taskId);
		try {
			const worker = this._workers.get(task.workerProviderId);
			let result: IWorkerTaskResult;
			if (!worker || !(await worker.isAvailable())) {
				result = {
					status: 'failed',
					summary: '',
					changedFiles: [],
					error: `${task.workerLabel} is unavailable. Install the runtime or set its API key.`,
					usage: { durationMs: 0 },
				};
			} else {
				result = await worker.run({
					task,
					workspace: workspace.path,
					contract: this._run.contract ?? '',
					goal: this._run.goal,
					chatUri: this._run.chatUri,
					sessionUri: this._run.sessionUri,
					abort,
				});
			}
			if (abort.aborted) {
				this._updateTask(taskId, { status: 'cancelled' });
				return;
			}
			const merged = await workspace.mergeInto(this._run.workspace);
			result = { ...result, changedFiles: uniquePaths([...result.changedFiles, ...merged]) };
			if (result.status === 'completed') {
				this._updateTask(taskId, { status: 'completed', result });
			} else if (task.attempt + 1 < MAX_TASK_ATTEMPTS) {
				this._updateTask(taskId, { status: 'retry', result, error: result.error });
			} else {
				await this._escalate({ ...task, result, error: result.error, attempt: task.attempt + 1 }, abort);
				return;
			}
		} catch (error) {
			this._updateTask(taskId, { status: 'failed', error: error instanceof Error ? error.message : String(error) });
		} finally {
			await workspace.dispose();
			this._publish();
		}
	}

	private async _escalate(task: IOrchestrationTaskState, abort: AbortSignal): Promise<void> {
		if (!this._run) {
			return;
		}
		this._updateTask(task.id, { status: 'escalated' });
		this._publish();
		const result = await this._activeLeader.implement(task, this._run.workspace, this._run.contract ?? '', abort, this._run);
		this._updateTask(task.id, { status: result.status === 'completed' ? 'escalated' : 'failed', result, error: result.error });
		this._publish();
	}

	private _toTaskState(task: IOrchestrationPlan['tasks'][number], assignment: IOrchestrationAssignment, index: number): IOrchestrationTaskState {
		const hint = task.workerHint ?? '';
		const workerIndex = index % Math.max(assignment.workers.length, 1);
		const worker = assignment.workers.find(candidate => candidate.providerId === hint || (hint !== '' && candidate.label.toLowerCase().includes(hint.toLowerCase())))
			?? assignment.workers[workerIndex]
			?? assignment.workers[0]
			?? { providerId: 'deepseek-harness', label: 'DeepSeek Harness', role: 'worker' as const };
		return {
			id: task.id,
			title: task.title,
			prompt: task.prompt,
			files: task.files,
			dependsOn: task.dependsOn,
			workerProviderId: worker.providerId,
			workerLabel: worker.label,
			workerModel: worker.model,
			thinkingLevel: worker.thinkingLevel,
			contextSize: worker.contextSize,
			acceptance: task.acceptance,
			testCommand: task.testCommand,
			status: 'queued',
			attempt: 0,
		};
	}

	private _leaderFor(assignment: IOrchestrationAssignment): ILeaderProvider {
		return this._overrideLeader
			?? this._leaders.get(assignment.leader.providerId)
			?? this._fallbackLeader;
	}

	private _workerRef(assignment: IOrchestrationAssignment, providerId: string) {
		return assignment.workers.find(worker => worker.providerId === providerId) ?? { providerId, label: providerId, role: 'worker' as const };
	}

	private _updateTask(taskId: string, patch: Partial<IOrchestrationTaskState>): void {
		if (!this._run) {
			return;
		}
		this._run = {
			...this._run,
			tasks: this._run.tasks.map(task => task.id === taskId ? { ...task, ...patch } : task),
			updatedAt: Date.now(),
			usage: this._sumUsage(this._run.tasks.map(task => task.id === taskId ? { ...task, ...patch } : task)),
		};
	}

	private _sumUsage(tasks: readonly IOrchestrationTaskState[]): IOrchestrationUsage {
		return tasks.reduce<IOrchestrationUsage>((sum, task) => ({
			durationMs: Date.now() - (this._run?.startedAt ?? Date.now()),
			inputTokens: add(sum.inputTokens, task.result?.usage?.inputTokens),
			outputTokens: add(sum.outputTokens, task.result?.usage?.outputTokens),
			costUsd: add(sum.costUsd, task.result?.usage?.costUsd),
		}), { durationMs: Date.now() - (this._run?.startedAt ?? Date.now()), inputTokens: 0, outputTokens: 0, costUsd: 0 });
	}

	private _workerEnv(kind: 'grok' | 'deepseek'): NodeJS.ProcessEnv {
		const values = this._configuration.getRootConfigValues?.() ?? {};
		const models = normalizeCodexModelsConfig(values[CODEX_MODELS_ROOT_CONFIG_KEY]);
		const official = findOfficialModelProvider(models, kind);
		const account = parseForgeVendorAccountInfo(values[vendorAccountMetaKey(kind)]);
		const loginKey = getVendorAccountSecret(kind);
		const cardKey = official ? getVendorAccountSecret(providerSecretId(official.id)) : undefined;
		const remaining = remainingPercentFromUsed(account.rateLimit?.usedPercent);
		const useFallback = officialApiFallbackReady(official, !!cardKey) && remaining === 0;
		const env: NodeJS.ProcessEnv = { ...process.env };
		if (kind === 'grok') {
			if (useFallback && cardKey) {
				env.XAI_API_KEY = cardKey;
				if (official?.baseUrl) {
					env.XAI_API_BASE_URL = official.baseUrl;
				}
			} else if (loginKey) {
				env.XAI_API_KEY = loginKey;
			}
			if (account.status === 'signedIn' || loginKey) {
				env.FORGE_GROK_SIGNED_IN = '1';
			}
		} else if (useFallback && cardKey) {
			env.DEEPSEEK_API_KEY = cardKey;
			if (official?.baseUrl) {
				env.DEEPSEEK_BASE_URL = official.baseUrl;
			}
		} else {
			if (loginKey) {
				env.DEEPSEEK_API_KEY = loginKey;
			}
			if (account.status === 'signedIn' || loginKey) {
				env.FORGE_DEEPSEEK_SIGNED_IN = '1';
			}
		}
		if (kind === 'deepseek' && (account.status === 'signedIn' || loginKey) && !env.FORGE_DEEPSEEK_SIGNED_IN) {
			env.FORGE_DEEPSEEK_SIGNED_IN = '1';
		}
		return env;
	}

	private _publish(): void {
		this._configuration.publishRootTransientValues?.({
			[FORGE_ORCHESTRATION_STATE_KEY]: this._run,
		});
	}
}

function emptyUsage(): IOrchestrationUsage {
	return { durationMs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
}

function add(left: number | undefined, right: number | undefined): number {
	return (left ?? 0) + (right ?? 0);
}

function delay(ms: number, abort?: AbortSignal): Promise<void> {
	return new Promise(resolve => {
		if (abort?.aborted) {
			resolve();
			return;
		}
		const timer = setTimeout(resolve, ms);
		abort?.addEventListener('abort', () => {
			clearTimeout(timer);
			resolve();
		}, { once: true });
	});
}

function uniquePaths(paths: readonly string[]): string[] {
	return [...new Set(paths.map(path => path.replace(/\\/g, '/')).filter(path => path !== ''))];
}
