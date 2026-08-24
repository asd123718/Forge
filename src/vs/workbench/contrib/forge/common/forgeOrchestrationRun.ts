/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from '../../../../base/common/uuid.js';
import {
	DEFAULT_ORCHESTRATION_ASSIGNMENT,
	FORGE_ORCHESTRATION_REQUEST_KEY,
	readAssignment,
	type IOrchestrationAssignment,
	type IOrchestrationRequest,
} from '../../../../platform/agentHost/common/orchestration/orchestrationTypes.js';
import { ActionType } from '../../../../platform/agentHost/common/state/sessionActions.js';
import { ROOT_STATE_URI, buildDefaultChatUri } from '../../../../platform/agentHost/common/state/sessionState.js';
import type { IAgentHostService } from '../../../../platform/agentHost/common/agentService.js';
import type { IChatWidget } from '../../chat/browser/chat.js';
import { toAgentHostBackendSessionUri } from '../../chat/browser/agentSessions/agentHost/agentHostSessionUri.js';
import { assignmentWithDialecticProfiles, readForgeAgentSetup } from './forgeAgentSetup.js';

export function dispatchForgeRootConfig(agentHostService: IAgentHostService, patch: Record<string, unknown>): void {
	agentHostService.dispatch(ROOT_STATE_URI, { type: ActionType.RootConfigChanged, config: patch });
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

export function forgeRootConfigValues(agentHostService: IAgentHostService): Record<string, unknown> {
	const state = agentHostService.rootState.value;
	if (!state || state instanceof Error) {
		return {};
	}
	return state.config?.values ?? {};
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
): IOrchestrationAssignment {
	const stored = readAssignment(forgeRootConfigValues(agentHostService)['forge.orchestration.assignment']);
	const base = stored ?? DEFAULT_ORCHESTRATION_ASSIGNMENT;
	return assignmentWithDialecticProfiles(base, setup);
}
