/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { DEFAULT_ORCHESTRATION_ASSIGNMENT, FORGE_ORCHESTRATION_ASSIGNMENT_KEY } from '../../../../../platform/agentHost/common/orchestration/orchestrationTypes.js';
import type { IAgentHostService } from '../../../../../platform/agentHost/common/agentService.js';
import type { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import type { IChatWidget } from '../../../chat/browser/chat.js';
import { buildDefaultChatUri } from '../../../../../platform/agentHost/common/state/sessionState.js';
import { toAgentHostBackendSessionUri } from '../../../chat/browser/agentSessions/agentHost/agentHostSessionUri.js';
import { canStartDialecticOrchestration, isForgeAgentHostChatSession, orchestrationRunMatchesWidget, readPersistedOrchestrationAssignment, resolveDialecticAssignment } from '../../common/forgeOrchestrationRun.js';

suite('Forge orchestration run', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('resolveDialecticAssignment falls back to persisted settings', () => {
		const assignment = {
			leader: { providerId: 'grok-build', label: 'Grok Build', role: 'leader' as const },
			workers: [{ providerId: 'deepseek-harness', label: 'DeepSeek Harness', role: 'worker' as const }],
		};
		const configurationService = {
			getValue: () => assignment,
		} as unknown as IConfigurationService;
		const agentHostService = {
			rootState: { value: { config: { values: {} } } },
		} as unknown as IAgentHostService;
		const resolved = resolveDialecticAssignment(agentHostService, { logos: {}, dialectic: {} }, configurationService);
		assert.strictEqual(resolved.leader.providerId, 'grok-build');
		assert.strictEqual(resolved.workers.length, 1);
	});

	test('resolveDialecticAssignment prefers live root config over persisted settings', () => {
		const persisted = {
			leader: { providerId: 'grok-build', label: 'Grok Build', role: 'leader' as const },
			workers: [{ providerId: 'deepseek-harness', label: 'DeepSeek Harness', role: 'worker' as const }],
		};
		const live = DEFAULT_ORCHESTRATION_ASSIGNMENT;
		const configurationService = {
			getValue: () => persisted,
		} as unknown as IConfigurationService;
		const agentHostService = {
			rootState: {
				value: {
					config: {
						values: {
							[FORGE_ORCHESTRATION_ASSIGNMENT_KEY]: live,
						},
					},
				},
			},
		} as unknown as IAgentHostService;
		const resolved = resolveDialecticAssignment(agentHostService, { logos: {}, dialectic: {} }, configurationService);
		assert.strictEqual(resolved.leader.providerId, live.leader.providerId);
	});

	test('canStartDialecticOrchestration requires a chat session', () => {
		const widget = {
			viewModel: undefined,
		} as unknown as IChatWidget;
		assert.deepStrictEqual(canStartDialecticOrchestration(widget), { ok: false, reason: 'no-session' });

		const readyWidget = {
			viewModel: {
				sessionResource: URI.parse('agent-host-codex:/session-1'),
				model: {},
			},
		} as unknown as IChatWidget;
		assert.deepStrictEqual(canStartDialecticOrchestration(readyWidget), { ok: true });
	});

	test('readPersistedOrchestrationAssignment parses stored assignment', () => {
		const assignment = {
			leader: { providerId: 'codex', label: 'Codex', role: 'leader' },
			workers: [{ providerId: 'grok-build', label: 'Grok Build', role: 'worker' }],
		};
		const configurationService = {
			getValue: () => assignment,
		} as unknown as IConfigurationService;
		assert.deepStrictEqual(readPersistedOrchestrationAssignment(configurationService)?.leader.providerId, 'codex');
	});

	test('isForgeAgentHostChatSession accepts agent-host and codex schemes', () => {
		assert.strictEqual(isForgeAgentHostChatSession('agent-host-codex'), true);
		assert.strictEqual(isForgeAgentHostChatSession('codex'), true);
		assert.strictEqual(isForgeAgentHostChatSession('file'), false);
	});

	test('orchestrationRunMatchesWidget normalizes equivalent URIs', () => {
		const sessionResource = URI.parse('agent-host-codex:/session-1');
		const backend = toAgentHostBackendSessionUri(sessionResource)!;
		const widget = {
			viewModel: {
				sessionResource,
				model: { sessionResource },
			},
		} as unknown as IChatWidget;
		const run = {
			chatUri: buildDefaultChatUri(backend),
			sessionUri: backend.toString(),
		} as import('../../../../../platform/agentHost/common/orchestration/orchestrationTypes.js').IOrchestrationRunState;
		assert.strictEqual(orchestrationRunMatchesWidget(widget, run), true);
	});
});
