/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IAgentHostService } from '../../../../platform/agentHost/common/agentService.js';
import type { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import type { INotificationService } from '../../../../platform/notification/common/notification.js';
import { localize } from '../../../../nls.js';
import type { IChatWidget } from '../../chat/browser/chat.js';
import type { IForgeAgentSetup } from './forgeAgentSetup.js';
import type { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import {
	startDialecticOrchestration,
	type DialecticOrchestrationFailureReason,
} from './forgeOrchestrationRun.js';

export type ForgeOrchestrationSendResult =
	| { ok: true }
	| { ok: false; reason: DialecticOrchestrationFailureReason };

export function notifyDialecticOrchestrationFailure(
	notificationService: INotificationService,
	reason: DialecticOrchestrationFailureReason,
): void {
	switch (reason) {
		case 'no-goal':
			notificationService.info(localize('forge.orchestration.needGoal', "先输入需求，再发送。"));
			break;
		case 'no-session':
			notificationService.error(localize('forge.orchestration.noSession', "先等待 Codex 聊天会话就绪，再发送。"));
			break;
		case 'no-workspace':
			notificationService.error(localize('forge.orchestration.noFolder', "先打开一个工作区文件夹。"));
			break;
	}
}

export function trySendDialecticOrchestration(options: {
	readonly widget: IChatWidget;
	readonly goal: string;
	readonly workspacePath: string;
	readonly agentHostService: IAgentHostService;
	readonly configurationService: IConfigurationService;
	readonly setup: IForgeAgentSetup;
	readonly instantiationService: IInstantiationService;
	readonly notificationService: INotificationService;
}): ForgeOrchestrationSendResult {
	const result = startDialecticOrchestration({
		widget: options.widget,
		goal: options.goal,
		workspacePath: options.workspacePath,
		agentHostService: options.agentHostService,
		configurationService: options.configurationService,
		setup: options.setup,
		instantiationService: options.instantiationService,
	});
	if (!result.ok) {
		notifyDialecticOrchestrationFailure(options.notificationService, result.reason);
		return result;
	}
	options.notificationService.info(localize('forge.orchestration.started', "编排已开始，可在聊天与状态栏查看进度。"));
	return result;
}
