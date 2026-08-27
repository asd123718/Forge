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
	IOrchestrationProgressHooks,
	IOrchestrationRequest,
	IOrchestrationRunState,
	IOrchestrationTaskState,
	IOrchestrationTranscriptEntry,
	IOrchestrationUsage,
	IWorkerAvailability,
	IWorkerProvider,
	IWorkerTaskResult,
	WorkerUnavailableReason,
} from '../../common/orchestration/orchestrationTypes.js';
import {
	DEFAULT_ORCHESTRATION_ASSIGNMENT,
	FORGE_ORCHESTRATION_ASSIGNMENT_KEY,
	FORGE_ORCHESTRATION_COMMAND_KEY,
	FORGE_ORCHESTRATION_REQUEST_KEY,
	FORGE_ORCHESTRATION_STATE_KEY,
	isOrchestrationRequest,
	orchestrationAgentInfo,
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
	private _transcriptPublishTimer: ReturnType<typeof setTimeout> | undefined;
	private _transcriptPublishPending = false;

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
			transcript: [],
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
			const planEntryId = this._beginTranscript('leader-plan', assignment.leader.label, '规划');
			const plan = await this._activeLeader.plan({
				goal: request.goal,
				workspace: request.workspace,
				chatUri: request.chatUri,
				sessionUri: request.sessionUri,
				leader: assignment.leader,
				workers: assignment.workers,
				hooks: this._transcriptHooks(planEntryId),
			}, this._abort.signal);
			this._completeTranscript(planEntryId, plan.summary, 'completed');
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
			const reviewEntryId = this._beginTranscript('leader-review', assignment.leader.label, '审核');
			const review = await this._activeLeader.review(this._run, this._abort.signal, this._transcriptHooks(reviewEntryId));
			this._completeTranscript(reviewEntryId, review, 'completed');
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
				requestedWorkerProviderId: worker.providerId,
				workerProviderId: worker.providerId,
				resolvedWorkerProviderId: undefined,
				workerFallbackReason: undefined,
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
				requestedWorkerProviderId: worker.providerId,
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
		const workerEntryId = this._beginTranscript('worker', task.workerLabel, task.title, task.id);
		const workspace = await openWorkerWorkspace(this._run.workspace, taskId);
		try {
			const resolvedWorker = await this._resolveWorker(task);
			let result: IWorkerTaskResult;
			if (!resolvedWorker.worker) {
				this._updateTask(taskId, {
					requestedWorkerProviderId: resolvedWorker.requestedWorkerProviderId,
					resolvedWorkerProviderId: resolvedWorker.resolvedWorkerProviderId,
					workerFallbackReason: resolvedWorker.workerFallbackReason,
				});
				result = {
					status: 'failed',
					summary: '',
					changedFiles: [],
					error: resolvedWorker.error ?? `${task.workerLabel} is unavailable. Install the runtime or set its API key.`,
					usage: { durationMs: 0 },
				};
				this._completeTranscript(workerEntryId, result.error ?? result.summary, 'failed');
			} else {
				this._updateTask(taskId, {
					requestedWorkerProviderId: resolvedWorker.requestedWorkerProviderId,
					resolvedWorkerProviderId: resolvedWorker.resolvedWorkerProviderId,
					workerProviderId: resolvedWorker.workerProviderId,
					workerLabel: resolvedWorker.workerLabel,
					workerFallbackReason: resolvedWorker.workerFallbackReason,
				});
				result = await resolvedWorker.worker.run({
					task: {
						...task,
						requestedWorkerProviderId: resolvedWorker.requestedWorkerProviderId,
						resolvedWorkerProviderId: resolvedWorker.resolvedWorkerProviderId,
						workerProviderId: resolvedWorker.workerProviderId,
						workerLabel: resolvedWorker.workerLabel,
						workerFallbackReason: resolvedWorker.workerFallbackReason,
					},
					workspace: workspace.path,
					contract: this._run.contract ?? '',
					goal: this._run.goal,
					chatUri: this._run.chatUri,
					sessionUri: this._run.sessionUri,
					abort,
					hooks: this._transcriptHooks(workerEntryId),
				});
			}
			if (abort.aborted) {
				this._updateTask(taskId, { status: 'cancelled' });
				this._completeTranscript(workerEntryId, 'Cancelled', 'failed');
				return;
			}
			const merged = await workspace.mergeInto(this._run.workspace);
			result = { ...result, changedFiles: uniquePaths([...result.changedFiles, ...merged]) };
			this._completeTranscript(workerEntryId, result.summary || result.error || '', result.status === 'completed' ? 'completed' : 'failed');
			if (result.status === 'completed') {
				this._updateTask(taskId, { status: 'completed', result });
			} else if (task.attempt + 1 < MAX_TASK_ATTEMPTS) {
				this._updateTask(taskId, { status: 'retry', result, error: result.error });
			} else {
				await this._escalate({ ...task, result, error: result.error, attempt: task.attempt + 1 }, abort);
				return;
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this._updateTask(taskId, { status: 'failed', error: message });
			this._completeTranscript(workerEntryId, message, 'failed');
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
		const entryId = this._beginTranscript('leader-implement', this._run.assignment.leader.label, task.title, task.id);
		const result = await this._activeLeader.implement(task, this._run.workspace, this._run.contract ?? '', abort, this._run, this._transcriptHooks(entryId));
		this._completeTranscript(entryId, result.summary || result.error || '', result.status === 'completed' ? 'completed' : 'failed');
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
			requestedWorkerProviderId: worker.providerId,
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

	private async _resolveWorker(task: IOrchestrationTaskState): Promise<{
		worker: IWorkerProvider | undefined;
		requestedWorkerProviderId: string;
		resolvedWorkerProviderId: string;
		workerProviderId: string;
		workerLabel: string;
		workerFallbackReason?: WorkerUnavailableReason;
		error?: string;
	}> {
		const requestedId = task.requestedWorkerProviderId ?? task.workerProviderId;
		const requestedLabel = orchestrationAgentInfo(requestedId)?.label ?? task.workerLabel;
		const primary = this._workers.get(requestedId);
		if (primary) {
			const availability = await primary.checkAvailability();
			if (availability.available) {
				return {
					worker: primary,
					requestedWorkerProviderId: requestedId,
					resolvedWorkerProviderId: primary.id,
					workerProviderId: primary.id,
					workerLabel: primary.label,
				};
			}
			const primaryReason = availability.reason ?? 'invalid-runtime';
			const codex = this._workers.get('codex');
			if (requestedId !== 'codex' && codex) {
				const codexAvailability = await codex.checkAvailability();
				if (codexAvailability.available) {
					this._logService.info(`[ForgeOrchestration] Falling back to Codex for task "${task.title}" (${requestedId}: ${primaryReason}).`);
					return {
						worker: codex,
						requestedWorkerProviderId: requestedId,
						resolvedWorkerProviderId: codex.id,
						workerProviderId: codex.id,
						workerLabel: codex.label,
						workerFallbackReason: primaryReason,
					};
				}
			}
			return {
				worker: undefined,
				requestedWorkerProviderId: requestedId,
				resolvedWorkerProviderId: requestedId,
				workerProviderId: requestedId,
				workerLabel: requestedLabel,
				workerFallbackReason: primaryReason,
				error: workerUnavailableMessage(requestedLabel, availability),
			};
		}
		return {
			worker: undefined,
			requestedWorkerProviderId: requestedId,
			resolvedWorkerProviderId: requestedId,
			workerProviderId: requestedId,
			workerLabel: requestedLabel,
			workerFallbackReason: 'invalid-runtime',
			error: `${requestedLabel} is unavailable. Install the runtime or set its API key.`,
		};
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

	private _beginTranscript(phase: IOrchestrationTranscriptEntry['phase'], agentLabel: string, title: string, taskId?: string): string {
		if (!this._run) {
			return generateUuid();
		}
		const id = generateUuid();
		const entry: IOrchestrationTranscriptEntry = {
			id,
			phase,
			agentLabel,
			title,
			taskId,
			status: 'running',
			thinking: '',
		};
		this._run = {
			...this._run,
			transcript: [...(this._run.transcript ?? []), entry],
			updatedAt: Date.now(),
		};
		this._publish();
		return id;
	}

	private _transcriptHooks(entryId: string): IOrchestrationProgressHooks {
		return {
			onProgress: update => {
				if (!this._run) {
					return;
				}
				this._run = {
					...this._run,
					transcript: (this._run.transcript ?? []).map(entry => entry.id === entryId ? {
						...entry,
						thinking: update.thinking,
						output: update.output ?? entry.output,
					} : entry),
					updatedAt: Date.now(),
				};
				this._publishTranscriptThrottled();
			},
		};
	}

	private _completeTranscript(entryId: string, output: string, status: 'completed' | 'failed'): void {
		if (!this._run) {
			return;
		}
		this._run = {
			...this._run,
			transcript: (this._run.transcript ?? []).map(entry => entry.id === entryId ? {
				...entry,
				output,
				status,
			} : entry),
			updatedAt: Date.now(),
		};
		this._publish();
	}

	private _publishTranscriptThrottled(): void {
		if (this._transcriptPublishTimer) {
			this._transcriptPublishPending = true;
			return;
		}
		this._publish();
		this._transcriptPublishTimer = setTimeout(() => {
			this._transcriptPublishTimer = undefined;
			if (this._transcriptPublishPending) {
				this._transcriptPublishPending = false;
				this._publish();
			}
		}, 250);
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

function workerUnavailableMessage(label: string, availability: IWorkerAvailability): string {
	switch (availability.reason) {
		case 'missing-credentials':
			return `${label} is unavailable: API key or saved credentials are missing.`;
		case 'missing-executable':
			return `${label} is unavailable: runtime binary was not found${availability.executable ? ` (${availability.executable})` : ''}.`;
		case 'probe-failed':
			return `${label} is unavailable: runtime probe failed${availability.executable ? ` (${availability.executable})` : ''}.`;
		case 'agent-unavailable':
			return `${label} is unavailable: Codex agent is not connected.`;
		default:
			return `${label} is unavailable. Install the runtime or set its API key.`;
	}
}
