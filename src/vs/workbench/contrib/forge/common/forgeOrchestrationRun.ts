/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { Emitter, type Event } from '../../../../base/common/event.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { localize } from '../../../../nls.js';
import {
	DEFAULT_ORCHESTRATION_ASSIGNMENT,
	FORGE_ORCHESTRATION_ASSIGNMENT_KEY,
	FORGE_ORCHESTRATION_COMMAND_KEY,
	FORGE_ORCHESTRATION_REQUEST_KEY,
	isActiveOrchestrationStatus,
	readAssignment,
	readOrchestrationState,
	type IOrchestrationAssignment,
	type IOrchestrationRequest,
	type IOrchestrationRunState,
} from '../../../../platform/agentHost/common/orchestration/orchestrationTypes.js';
import { ActionType } from '../../../../platform/agentHost/common/state/sessionActions.js';
import { ROOT_STATE_URI, buildDefaultChatUri } from '../../../../platform/agentHost/common/state/sessionState.js';
import type { IAgentHostService } from '../../../../platform/agentHost/common/agentService.js';
import { ConfigurationTarget, type IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import type { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import type { IChatWidget } from '../../chat/browser/chat.js';
import type { IChatProgress } from '../../chat/common/chatService/chatService.js';
import type { ChatModel, ChatRequestModel, IChatModel } from '../../chat/common/model/chatModel.js';
import { ChatRequestParser } from '../../chat/common/requestParser/chatRequestParser.js';
import { toAgentHostBackendSessionUri } from '../../chat/browser/agentSessions/agentHost/agentHostSessionUri.js';
import { assignmentWithDialecticProfiles, readForgeAgentSetup, type IForgeAgentSetup } from './forgeAgentSetup.js';

export const FORGE_ORCHESTRATION_ASSIGNMENT_SETTING_ID = 'forge.orchestrationAssignment';

type MutableChatModel = ChatModel & {
	addRequest: ChatModel['addRequest'];
	acceptResponseProgress: (request: ChatRequestModel, progress: IChatProgress, quiet?: boolean) => void;
};

function isMutableChatModel(model: IChatModel | undefined): model is MutableChatModel {
	const candidate = model as Partial<MutableChatModel> | undefined;
	return typeof candidate?.addRequest === 'function' && typeof candidate.acceptResponseProgress === 'function';
}

let dialecticOrchestrationPending = false;
const _onDidChangeDialecticOrchestrationPending = new Emitter<void>();
export const onDidChangeDialecticOrchestrationPending: Event<void> = _onDidChangeDialecticOrchestrationPending.event;

export function markDialecticOrchestrationPending(): void {
	dialecticOrchestrationPending = true;
	_onDidChangeDialecticOrchestrationPending.fire();
}

export function clearDialecticOrchestrationPending(): void {
	if (!dialecticOrchestrationPending) {
		return;
	}
	dialecticOrchestrationPending = false;
	_onDidChangeDialecticOrchestrationPending.fire();
}

export function isDialecticOrchestrationPending(): boolean {
	return dialecticOrchestrationPending;
}

export function dispatchForgeRootConfig(agentHostService: IAgentHostService, patch: Record<string, unknown>): void {
	agentHostService.dispatch(ROOT_STATE_URI, { type: ActionType.RootConfigChanged, config: patch });
}

export function isForgeAgentHostChatSession(scheme: string | undefined): boolean {
	if (!scheme) {
		return false;
	}
	if (scheme.startsWith('agent-host-')) {
		return true;
	}
	// Some chat widgets surface the backend provider scheme directly.
	return scheme === 'codex' || scheme === 'copilot' || scheme === 'claude';
}

function normalizeOrchestrationUri(uri: string | undefined): string {
	if (!uri) {
		return '';
	}
	try {
		return URI.parse(uri).toString();
	} catch {
		return uri;
	}
}

export function forgeOrchestrationAddressesFromWidget(widget: IChatWidget): { chatUri: string; sessionUri: string } {
	const sessionResource = widget.viewModel?.sessionResource;
	if (!sessionResource) {
		return { chatUri: '', sessionUri: '' };
	}
	const backend = toAgentHostBackendSessionUri(sessionResource) ?? sessionResource;
	return {
		sessionUri: backend.toString(),
		chatUri: buildDefaultChatUri(backend),
	};
}

export function orchestrationRunMatchesWidget(widget: IChatWidget, run: IOrchestrationRunState): boolean {
	const addresses = forgeOrchestrationAddressesFromWidget(widget);
	const chatUri = normalizeOrchestrationUri(addresses.chatUri);
	const sessionUri = normalizeOrchestrationUri(addresses.sessionUri);
	const runChatUri = normalizeOrchestrationUri(run.chatUri);
	const runSessionUri = normalizeOrchestrationUri(run.sessionUri);
	if (chatUri && runChatUri && chatUri === runChatUri) {
		return true;
	}
	if (sessionUri && runSessionUri && sessionUri === runSessionUri) {
		return true;
	}
	return !chatUri && !sessionUri;
}

export function forgeRootConfigValues(agentHostService: IAgentHostService): Record<string, unknown> {
	const state = agentHostService.rootState.value;
	if (!state || state instanceof Error) {
		return {};
	}
	return state.config?.values ?? {};
}

export function readPersistedOrchestrationAssignment(configurationService: IConfigurationService): IOrchestrationAssignment | undefined {
	return readAssignment(configurationService.getValue(FORGE_ORCHESTRATION_ASSIGNMENT_SETTING_ID));
}

export async function persistOrchestrationAssignment(configurationService: IConfigurationService, assignment: IOrchestrationAssignment): Promise<void> {
	await configurationService.updateValue(FORGE_ORCHESTRATION_ASSIGNMENT_SETTING_ID, assignment, ConfigurationTarget.USER);
}

export function restoreOrchestrationAssignment(agentHostService: IAgentHostService, configurationService: IConfigurationService): void {
	const persisted = readPersistedOrchestrationAssignment(configurationService);
	if (!persisted) {
		return;
	}
	const current = readAssignment(forgeRootConfigValues(agentHostService)[FORGE_ORCHESTRATION_ASSIGNMENT_KEY]);
	if (current) {
		return;
	}
	dispatchForgeRootConfig(agentHostService, { [FORGE_ORCHESTRATION_ASSIGNMENT_KEY]: persisted });
}

export function buildDialecticOrchestrationRequest(
	goal: string,
	workspace: string,
	widget: IChatWidget,
	assignment?: IOrchestrationAssignment,
): IOrchestrationRequest {
	return {
		requestId: generateUuid(),
		goal,
		workspace,
		mode: 'dialectic',
		assignment,
		...forgeOrchestrationAddressesFromWidget(widget),
	};
}

export function resolveDialecticAssignment(
	agentHostService: IAgentHostService,
	setup: ReturnType<typeof readForgeAgentSetup>,
	configurationService: IConfigurationService,
): IOrchestrationAssignment {
	const stored = readAssignment(forgeRootConfigValues(agentHostService)[FORGE_ORCHESTRATION_ASSIGNMENT_KEY])
		?? readPersistedOrchestrationAssignment(configurationService);
	const base = stored ?? DEFAULT_ORCHESTRATION_ASSIGNMENT;
	return assignmentWithDialecticProfiles(base, setup);
}

export type DialecticOrchestrationFailureReason = 'no-goal' | 'no-session' | 'no-workspace';

export function canStartDialecticOrchestration(widget: IChatWidget): { ok: true } | { ok: false; reason: DialecticOrchestrationFailureReason } {
	if (!widget.viewModel?.sessionResource || !widget.viewModel.model) {
		return { ok: false, reason: 'no-session' };
	}
	const addresses = forgeOrchestrationAddressesFromWidget(widget);
	if (!addresses.chatUri || !addresses.sessionUri) {
		return { ok: false, reason: 'no-session' };
	}
	return { ok: true };
}

export function appendOrchestrationUserMessage(instantiationService: IInstantiationService, widget: IChatWidget, goal: string): boolean {
	const model = widget.viewModel?.model;
	if (!model || !isMutableChatModel(model)) {
		return false;
	}
	try {
		const parser = instantiationService.createInstance(ChatRequestParser);
		const request = model.addRequest(parser.parseChatRequest(model.sessionResource, goal), { variables: [] }, 0);
		if (request.response && !request.response.isComplete) {
			model.acceptResponseProgress(request, { kind: 'markdownContent', content: new MarkdownString(localize('forge.orchestration.chatStarted', "编排已开始…")) }, true);
		}
		return true;
	} catch {
		return false;
	}
}

export function completeStaleChatRequest(widget: IChatWidget): void {
	const model = widget.viewModel?.model;
	if (!model || !isMutableChatModel(model)) {
		return;
	}
	const request = model.getRequests().at(-1) as ChatRequestModel | undefined;
	if (request?.response && !request.response.isComplete) {
		request.response.complete();
	}
}

export function cancelForgeOrchestration(agentHostService: IAgentHostService, runId?: string): void {
	clearDialecticOrchestrationPending();
	const run = readOrchestrationState(forgeRootConfigValues(agentHostService));
	if (!run || !isActiveOrchestrationStatus(run.status)) {
		return;
	}
	if (runId && run.runId !== runId) {
		return;
	}
	dispatchForgeRootConfig(agentHostService, {
		[FORGE_ORCHESTRATION_COMMAND_KEY]: { type: 'cancel', runId: run.runId, commandId: generateUuid() },
	});
}

export function startDialecticOrchestration(options: {
	readonly widget: IChatWidget;
	readonly goal: string;
	readonly workspacePath: string;
	readonly agentHostService: IAgentHostService;
	readonly configurationService: IConfigurationService;
	readonly setup: IForgeAgentSetup;
	readonly instantiationService: IInstantiationService;
}): { ok: true } | { ok: false; reason: DialecticOrchestrationFailureReason } {
	const trimmed = options.goal.trim();
	if (!trimmed) {
		return { ok: false, reason: 'no-goal' };
	}
	const readiness = canStartDialecticOrchestration(options.widget);
	if (!readiness.ok) {
		return readiness;
	}
	if (!options.workspacePath) {
		return { ok: false, reason: 'no-workspace' };
	}
	const assignment = resolveDialecticAssignment(options.agentHostService, options.setup, options.configurationService);
	const request = buildDialecticOrchestrationRequest(trimmed, options.workspacePath, options.widget, assignment);
	if (!appendOrchestrationUserMessage(options.instantiationService, options.widget, trimmed)) {
		return { ok: false, reason: 'no-session' };
	}
	options.widget.setInput('');
	markDialecticOrchestrationPending();
	dispatchForgeRootConfig(options.agentHostService, { [FORGE_ORCHESTRATION_REQUEST_KEY]: request });
	return { ok: true };
}
