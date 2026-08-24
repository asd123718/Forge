/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Forge multi-agent orchestration contracts.
 *
 * Leader/Worker providers are identified by stable adapter ids, not by a
 * hardcoded model name. Any catalog agent can be Leader or Worker. Defaults
 * live in {@link DEFAULT_ORCHESTRATION_ASSIGNMENT} and can be changed from the UI.
 */

export const FORGE_ORCHESTRATION_STATE_KEY = 'forge.orchestration.state';
export const FORGE_ORCHESTRATION_REQUEST_KEY = 'forge.orchestration.request';
export const FORGE_ORCHESTRATION_COMMAND_KEY = 'forge.orchestration.command';
export const FORGE_ORCHESTRATION_ASSIGNMENT_KEY = 'forge.orchestration.assignment';

export const CODEX_LEADER_PROVIDER_ID = 'codex';
export const DEEPSEEK_WORKER_PROVIDER_ID = 'deepseek-harness';
export const GROK_WORKER_PROVIDER_ID = 'grok-build';

export interface IOrchestrationAgentInfo {
	readonly providerId: string;
	readonly label: string;
	readonly defaultModel: string;
}

export const FORGE_ORCHESTRATION_AGENTS: readonly IOrchestrationAgentInfo[] = [
	{ providerId: CODEX_LEADER_PROVIDER_ID, label: 'Codex', defaultModel: 'gpt-5.6-sol' },
	{ providerId: DEEPSEEK_WORKER_PROVIDER_ID, label: 'DeepSeek Harness', defaultModel: 'deepseek-v4-flash' },
	{ providerId: GROK_WORKER_PROVIDER_ID, label: 'Grok Build', defaultModel: 'grok-4.6' },
];

export function orchestrationAgentInfo(providerId: string): IOrchestrationAgentInfo | undefined {
	return FORGE_ORCHESTRATION_AGENTS.find(agent => agent.providerId === providerId);
}

export function orchestrationAgentRef(providerId: string, role: 'leader' | 'worker', model?: string): IOrchestrationProviderRef {
	const agent = orchestrationAgentInfo(providerId);
	return {
		providerId,
		label: agent?.label ?? providerId,
		model: model ?? agent?.defaultModel,
		role,
	};
}

function optionalString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function readProviderRef(raw: Record<string, unknown>, role: 'leader' | 'worker'): IOrchestrationProviderRef {
	return {
		providerId: String(raw.providerId ?? ''),
		label: typeof raw.label === 'string' && raw.label.trim() !== '' ? raw.label : String(raw.providerId ?? ''),
		model: optionalString(raw.model),
		thinkingLevel: optionalString(raw.thinkingLevel),
		contextSize: optionalString(raw.contextSize),
		role,
	};
}

export type OrchestrationTaskStatus =
	| 'queued'
	| 'running'
	| 'completed'
	| 'failed'
	| 'retry'
	| 'escalated'
	| 'cancelled';

export type OrchestrationRunStatus =
	| 'idle'
	| 'planning'
	| 'running'
	| 'reviewing'
	| 'completed'
	| 'failed'
	| 'cancelled'
	| 'paused';

export interface IOrchestrationProviderRef {
	readonly providerId: string;
	readonly label: string;
	readonly model?: string;
	readonly thinkingLevel?: string;
	readonly contextSize?: string;
	readonly role: 'leader' | 'worker';
}

export interface IOrchestrationAssignment {
	readonly leader: IOrchestrationProviderRef;
	readonly workers: readonly IOrchestrationProviderRef[];
}

export const DEFAULT_ORCHESTRATION_ASSIGNMENT: IOrchestrationAssignment = {
	leader: orchestrationAgentRef(CODEX_LEADER_PROVIDER_ID, 'leader'),
	workers: [
		orchestrationAgentRef(DEEPSEEK_WORKER_PROVIDER_ID, 'worker'),
		orchestrationAgentRef(GROK_WORKER_PROVIDER_ID, 'worker'),
	],
};

export interface IOrchestrationTaskSpec {
	readonly id: string;
	readonly title: string;
	readonly prompt: string;
	readonly files: readonly string[];
	readonly dependsOn: readonly string[];
	readonly workerHint?: string;
	readonly acceptance?: string;
	readonly testCommand?: string;
}

export interface IOrchestrationPlan {
	readonly summary: string;
	readonly contract: string;
	readonly tasks: readonly IOrchestrationTaskSpec[];
}

export interface IOrchestrationUsage {
	readonly durationMs: number;
	readonly inputTokens?: number;
	readonly outputTokens?: number;
	readonly costUsd?: number;
}

export interface IWorkerTaskResult {
	readonly status: 'completed' | 'failed';
	readonly summary: string;
	readonly changedFiles: readonly string[];
	readonly testCommand?: string;
	readonly testOutput?: string;
	readonly testsPassed?: boolean;
	readonly risk?: string;
	readonly usage?: IOrchestrationUsage;
	readonly error?: string;
}

export interface IOrchestrationTaskState {
	readonly id: string;
	readonly title: string;
	readonly prompt: string;
	readonly files: readonly string[];
	readonly dependsOn: readonly string[];
	readonly workerProviderId: string;
	readonly workerLabel: string;
	readonly workerModel?: string;
	readonly thinkingLevel?: string;
	readonly contextSize?: string;
	readonly acceptance?: string;
	readonly testCommand?: string;
	readonly status: OrchestrationTaskStatus;
	readonly attempt: number;
	readonly result?: IWorkerTaskResult;
	readonly error?: string;
}

export interface IOrchestrationRunState {
	readonly runId: string;
	readonly status: OrchestrationRunStatus;
	readonly goal: string;
	readonly chatUri: string;
	readonly sessionUri: string;
	readonly workspace: string;
	readonly assignment: IOrchestrationAssignment;
	readonly planSummary?: string;
	readonly contract?: string;
	readonly tasks: readonly IOrchestrationTaskState[];
	readonly review?: string;
	readonly error?: string;
	readonly startedAt: number;
	readonly updatedAt: number;
	readonly usage: IOrchestrationUsage;
}

export interface IOrchestrationRequest {
	readonly requestId?: string;
	readonly chatUri: string;
	readonly sessionUri: string;
	readonly workspace: string;
	readonly goal: string;
	readonly assignment?: IOrchestrationAssignment;
	readonly mode?: 'dialectic' | 'logos';
}

export type OrchestrationCommandType = 'cancel' | 'pause' | 'resume' | 'retry' | 'escalate' | 'reassign';

export interface IOrchestrationCommand {
	readonly commandId?: string;
	readonly runId?: string;
	readonly type: OrchestrationCommandType;
	readonly taskId?: string;
	readonly workerProviderId?: string;
}

export interface ILeaderPlanContext {
	readonly goal: string;
	readonly workspace: string;
	readonly chatUri: string;
	readonly sessionUri: string;
	readonly leader: IOrchestrationProviderRef;
	readonly workers: readonly IOrchestrationProviderRef[];
}

export interface ILeaderProvider {
	readonly id: string;
	readonly label: string;
	plan(context: ILeaderPlanContext, abort: AbortSignal): Promise<IOrchestrationPlan>;
	review(run: IOrchestrationRunState, abort: AbortSignal): Promise<string>;
	implement(task: IOrchestrationTaskState, workspace: string, contract: string, abort: AbortSignal, run?: IOrchestrationRunState): Promise<IWorkerTaskResult>;
}

export interface IWorkerRunRequest {
	readonly task: IOrchestrationTaskState;
	readonly workspace: string;
	readonly contract: string;
	readonly goal: string;
	readonly chatUri: string;
	readonly sessionUri: string;
	readonly abort: AbortSignal;
}

export interface IWorkerProvider {
	readonly id: string;
	readonly label: string;
	readonly defaultModel: string;
	isAvailable(): Promise<boolean>;
	run(request: IWorkerRunRequest): Promise<IWorkerTaskResult>;
}

export function isOrchestrationRequest(value: unknown): value is IOrchestrationRequest {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return false;
	}
	const raw = value as Record<string, unknown>;
	return typeof raw.goal === 'string' && raw.goal.trim() !== '' && typeof raw.workspace === 'string';
}

export function readAssignment(value: unknown): IOrchestrationAssignment | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const raw = value as Record<string, unknown>;
	const leader = raw.leader && typeof raw.leader === 'object' ? raw.leader as Record<string, unknown> : undefined;
	const workers = Array.isArray(raw.workers) ? raw.workers : [];
	if (!leader || typeof leader.providerId !== 'string') {
		return undefined;
	}
	return {
		leader: readProviderRef(leader, 'leader'),
		workers: workers.filter(worker => worker && typeof worker === 'object').map(worker => readProviderRef(worker as Record<string, unknown>, 'worker')).filter(worker => worker.providerId !== ''),
	};
}

export function readOrchestrationState(values: Record<string, unknown> | undefined): IOrchestrationRunState | undefined {
	const value = values?.[FORGE_ORCHESTRATION_STATE_KEY];
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	return value as IOrchestrationRunState;
}

export function isActiveOrchestrationStatus(status: OrchestrationRunStatus | undefined): boolean {
	return status === 'planning' || status === 'running' || status === 'reviewing' || status === 'paused';
}
