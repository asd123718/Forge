/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IAgentHostService } from '../../../../platform/agentHost/common/agentService.js';
import {
	readOrchestrationState,
	type IOrchestrationRunState,
	type IOrchestrationTranscriptEntry,
} from '../../../../platform/agentHost/common/orchestration/orchestrationTypes.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IChatWidget, IChatWidgetService, isIChatViewViewContext } from '../../chat/browser/chat.js';
import { ChatModel, type ChatRequestModel } from '../../chat/common/model/chatModel.js';
import { ChatRequestParser } from '../../chat/common/requestParser/chatRequestParser.js';
import { forgeRootConfigValues, orchestrationRunMatchesWidget } from '../common/forgeOrchestrationRun.js';

interface IWidgetMirrorState {
	runId?: string;
	entryRequestIds: Map<string, string>;
	thinkingSynced: Map<string, number>;
	progressSynced: Map<string, number>;
	completed: Set<string>;
}

class ForgeOrchestrationChatContribution extends Disposable {
	static readonly ID = 'workbench.contrib.forgeOrchestrationChat';

	private readonly _mirrorByWidget = new WeakMap<IChatWidget, IWidgetMirrorState>();

	constructor(
		@IChatWidgetService private readonly _chatWidgetService: IChatWidgetService,
		@IAgentHostService private readonly _agentHostService: IAgentHostService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		for (const widget of this._chatWidgetService.getAllWidgets()) {
			if (isIChatViewViewContext(widget.viewContext)) {
				this._ensureMirror(widget);
			}
		}
		this._register(this._chatWidgetService.onDidAddWidget(widget => {
			if (isIChatViewViewContext(widget.viewContext)) {
				this._ensureMirror(widget);
			}
		}));
		this._register(this._agentHostService.rootState.onDidChange(() => this._syncAll()));
	}

	private _ensureMirror(widget: IChatWidget): void {
		if (this._mirrorByWidget.has(widget)) {
			return;
		}
		this._mirrorByWidget.set(widget, {
			entryRequestIds: new Map(),
			thinkingSynced: new Map(),
			progressSynced: new Map(),
			completed: new Set(),
		});
	}

	private _syncAll(): void {
		const run = readOrchestrationState(forgeRootConfigValues(this._agentHostService));
		for (const widget of this._chatWidgetService.getAllWidgets()) {
			if (!isIChatViewViewContext(widget.viewContext)) {
				continue;
			}
			this._ensureMirror(widget);
			if (run && this._matchesWidget(widget, run)) {
				this._syncRun(widget, run);
			}
		}
	}

	private _matchesWidget(widget: IChatWidget, run: IOrchestrationRunState): boolean {
		return orchestrationRunMatchesWidget(widget, run);
	}

	private _syncRun(widget: IChatWidget, run: IOrchestrationRunState): void {
		const model = widget.viewModel?.model;
		const mirror = this._mirrorByWidget.get(widget);
		if (!(model instanceof ChatModel) || !mirror) {
			return;
		}
		try {
			if (mirror.runId !== run.runId) {
				mirror.runId = run.runId;
				mirror.entryRequestIds.clear();
				mirror.thinkingSynced.clear();
				mirror.progressSynced.clear();
				mirror.completed.clear();
			}
			for (const entry of run.transcript ?? []) {
				this._syncEntry(model, mirror, entry);
			}
		} catch (error) {
			this._logService.warn(`[ForgeOrchestration] transcript mirror failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private _syncEntry(model: ChatModel, mirror: IWidgetMirrorState, entry: IOrchestrationTranscriptEntry): void {
		const request = this._ensureEntryRequest(model, mirror, entry);
		if (!request) {
			return;
		}
		if (!request.response) {
			model.setResponse(request, {});
		}
		if (!request.response || request.response.isComplete) {
			return;
		}
		const synced = mirror.thinkingSynced.get(entry.id) ?? 0;
		if (entry.thinking.length > synced) {
			model.acceptResponseProgress(request, { kind: 'thinking', value: entry.thinking.slice(synced), id: entry.id }, true);
			mirror.thinkingSynced.set(entry.id, entry.thinking.length);
		}
		const progressSynced = mirror.progressSynced.get(entry.id) ?? 0;
		if ((entry.progress?.length ?? 0) > progressSynced) {
			model.acceptResponseProgress(request, { kind: 'markdownContent', content: new MarkdownString(entry.progress!.slice(progressSynced)) });
			mirror.progressSynced.set(entry.id, entry.progress!.length);
		}
		if (entry.status !== 'running' && !mirror.completed.has(entry.id)) {
			const streamedThinking = entry.thinking.trim();
			const streamedProgress = entry.progress?.trim();
			const completedOutput = entry.output?.trim();
			const output = completedOutput && completedOutput !== streamedThinking && completedOutput !== streamedProgress
				? completedOutput
				: (!streamedThinking && !streamedProgress ? completedOutput : undefined);
			if (output) {
				model.acceptResponseProgress(request, { kind: 'markdownContent', content: new MarkdownString(output) });
			}
			model.setResponse(request, {});
			request.response?.complete();
			mirror.completed.add(entry.id);
		}
	}

	private _ensureEntryRequest(model: ChatModel, mirror: IWidgetMirrorState, entry: IOrchestrationTranscriptEntry): ChatRequestModel | undefined {
		const existingId = mirror.entryRequestIds.get(entry.id);
		if (existingId) {
			return model.getRequests().find(candidate => candidate.id === existingId);
		}
		const parser = this._instantiationService.createInstance(ChatRequestParser);
		const label = transcriptLabel(entry);
		const request = model.addRequest(parser.parseChatRequest(model.sessionResource, label), { variables: [] }, 0, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, entry.id, true, label);
		mirror.entryRequestIds.set(entry.id, request.id);
		return request;
	}
}

function transcriptLabel(entry: IOrchestrationTranscriptEntry): string {
	switch (entry.phase) {
		case 'leader-plan':
			return localize('forge.orchestration.chat.leaderPlan', "{0} · 规划", entry.agentLabel);
		case 'leader-review':
			return localize('forge.orchestration.chat.leaderReview', "{0} · 审核", entry.agentLabel);
		case 'leader-implement':
			return localize('forge.orchestration.chat.leaderImplement', "{0} · 升级处理", entry.agentLabel);
		case 'worker':
			return localize('forge.orchestration.chat.worker', "{0} · {1}", entry.agentLabel, entry.title ?? localize('forge.orchestration.chat.task', "任务"));
		default:
			return entry.agentLabel;
	}
}

registerWorkbenchContribution2(ForgeOrchestrationChatContribution.ID, ForgeOrchestrationChatContribution, WorkbenchPhase.AfterRestored);
