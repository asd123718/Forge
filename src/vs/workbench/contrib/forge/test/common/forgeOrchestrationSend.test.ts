/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ActionType } from '../../../../../platform/agentHost/common/state/sessionActions.js';
import { ROOT_STATE_URI } from '../../../../../platform/agentHost/common/state/sessionState.js';
import type { IAgentHostService } from '../../../../../platform/agentHost/common/agentService.js';
import type { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import type { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import type { INotificationService } from '../../../../../platform/notification/common/notification.js';
import type { IChatWidget } from '../../../chat/browser/chat.js';
import { ChatRequestParser } from '../../../chat/common/requestParser/chatRequestParser.js';
import {
	clearDialecticOrchestrationPending,
	isDialecticOrchestrationPending,
	markDialecticOrchestrationPending,
} from '../../common/forgeOrchestrationRun.js';
import { trySendDialecticOrchestration } from '../../common/forgeOrchestrationSend.js';

suite('Forge orchestration send', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	setup(() => {
		clearDialecticOrchestrationPending();
	});

	test('trySendDialecticOrchestration dispatches and marks pending on success', () => {
		const dispatches: unknown[] = [];
		const notifications: string[] = [];
		const sessionResource = URI.parse('agent-host-codex:/session-1');
		const requests: unknown[] = [];
		const widget = {
			viewModel: {
				sessionResource,
				model: {
					sessionResource,
					addRequest: (message: unknown) => {
						requests.push(message);
						return {
							response: {
								isComplete: false,
								complete: () => undefined,
							},
						};
					},
					acceptResponseProgress: () => undefined,
				},
			},
			setInput: (value: string) => {
				inputValue = value;
			},
			getInput: () => inputValue,
		} as unknown as IChatWidget;
		let inputValue = 'build a feature';
		const agentHostService = {
			dispatch: (_channel: string, action: unknown) => {
				dispatches.push(action);
			},
			rootState: { value: { config: { values: {} } } },
		} as unknown as IAgentHostService;
		const configurationService = {
			getValue: () => ({}),
		} as unknown as IConfigurationService;
		const instantiationService = {
			createInstance: () => new ChatRequestParser(),
		} as unknown as IInstantiationService;
		const notificationService = {
			info: (message: string) => notifications.push(message),
			error: (message: string) => notifications.push(message),
		} as unknown as INotificationService;

		const result = trySendDialecticOrchestration({
			widget,
			goal: 'build a feature',
			workspacePath: 'C:\\workspace',
			agentHostService,
			configurationService,
			setup: { logos: {}, dialectic: {} },
			instantiationService,
			notificationService,
		});

		assert.strictEqual(result.ok, true);
		assert.strictEqual(requests.length, 1);
		assert.strictEqual(inputValue, '');
		assert.strictEqual(isDialecticOrchestrationPending(), true);
		assert.strictEqual(dispatches.length, 1);
		const action = dispatches[0] as { type: string; config: Record<string, unknown> };
		assert.strictEqual(action.type, ActionType.RootConfigChanged);
		assert.ok(action.config['forge.orchestration.request']);
		assert.strictEqual(notifications.length, 1);
		assert.match(notifications[0], /编排已开始/);
		assert.strictEqual(ROOT_STATE_URI, 'ahp-root://');
	});

	test('trySendDialecticOrchestration reports empty goal', () => {
		const notifications: string[] = [];
		const widget = {
			viewModel: {
				sessionResource: URI.parse('agent-host-codex:/session-1'),
				model: {
					sessionResource: URI.parse('agent-host-codex:/session-1'),
					addRequest: () => {
						throw new Error('should not add request');
					},
				},
			},
			setInput: () => undefined,
			getInput: () => '',
		} as unknown as IChatWidget;

		const result = trySendDialecticOrchestration({
			widget,
			goal: '   ',
			workspacePath: 'C:\\workspace',
			agentHostService: { dispatch: () => undefined, rootState: { value: { config: { values: {} } } } } as unknown as IAgentHostService,
			configurationService: { getValue: () => ({}) } as unknown as IConfigurationService,
			setup: { logos: {}, dialectic: {} },
			instantiationService: { createInstance: () => new ChatRequestParser() } as unknown as IInstantiationService,
			notificationService: {
				info: (message: string) => notifications.push(message),
				error: (message: string) => notifications.push(message),
			} as unknown as INotificationService,
		});

		assert.strictEqual(result.ok, false);
		assert.strictEqual(result.reason, 'no-goal');
		assert.strictEqual(notifications.length, 1);
		assert.strictEqual(isDialecticOrchestrationPending(), false);
	});

	test('pending flag can be cleared', () => {
		markDialecticOrchestrationPending();
		assert.strictEqual(isDialecticOrchestrationPending(), true);
		clearDialecticOrchestrationPending();
		assert.strictEqual(isDialecticOrchestrationPending(), false);
	});
});
