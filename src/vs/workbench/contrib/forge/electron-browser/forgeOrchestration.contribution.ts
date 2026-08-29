/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/forgeOrchestration.css';
import { $, addDisposableListener, append, clearNode, getWindow } from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import {
	FORGE_ORCHESTRATION_AGENTS,
	FORGE_ORCHESTRATION_ASSIGNMENT_KEY,
	FORGE_ORCHESTRATION_COMMAND_KEY,
	isActiveOrchestrationStatus,
	readOrchestrationState,
	type IOrchestrationAssignment,
	type IOrchestrationCommand,
	type IOrchestrationRunState,
} from '../../../../platform/agentHost/common/orchestration/orchestrationTypes.js';
import { IAgentHostService } from '../../../../platform/agentHost/common/agentService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IChatWidget, IChatWidgetService, isIChatViewViewContext } from '../../chat/browser/chat.js';
import { IChatExecuteActionContext, CancelChatActionId } from '../../chat/browser/actions/chatExecuteActions.js';
import { CHAT_CATEGORY } from '../../chat/browser/actions/chatActions.js';
import { ChatContextKeys } from '../../chat/common/actions/chatContextKeys.js';
import { FORGE_WORK_MODE_SETTING_ID, readForgeWorkMode } from '../common/forgeWorkMode.js';
import { FORGE_AGENT_SETUP_OPEN_ACTION_ID, FORGE_AGENT_SETUP_SETTING_ID, getAgentProfile, providerRefFromProfile, readForgeAgentSetup } from '../common/forgeAgentSetup.js';
import {
	cancelForgeOrchestration,
	clearDialecticOrchestrationPending,
	completeStaleChatRequest,
	dispatchForgeRootConfig,
	forgeRootConfigValues,
	orchestrationRunMatchesWidget,
	persistOrchestrationAssignment,
	resolveDialecticAssignment,
	restoreOrchestrationAssignment,
} from '../common/forgeOrchestrationRun.js';
import { trySendDialecticOrchestration } from '../common/forgeOrchestrationSend.js';

export const FORGE_ORCHESTRATE_ACTION_ID = 'forge.orchestration.run';
export const FORGE_ORCHESTRATION_ASSIGN_ACTION_ID = 'forge.orchestration.assign';
export const FORGE_ORCHESTRATION_COMMAND_ACTION_ID = 'forge.orchestration.command';

const orchestrationBars = new WeakMap<IChatWidget, ForgeOrchestrationBar>();

function startDialecticOrchestrationFromAccessor(accessor: ServicesAccessor, widget: IChatWidget, goal: string): boolean {
	const configurationService = accessor.get(IConfigurationService);
	return trySendDialecticOrchestration({
		widget,
		goal,
		workspacePath: accessor.get(IWorkspaceContextService).getWorkspace().folders[0]?.uri.fsPath ?? '',
		agentHostService: accessor.get(IAgentHostService),
		configurationService,
		setup: readForgeAgentSetup(configurationService.getValue(FORGE_AGENT_SETUP_SETTING_ID)),
		instantiationService: accessor.get(IInstantiationService),
		notificationService: accessor.get(INotificationService),
	}).ok;
}

async function runOrchestration(accessor: ServicesAccessor, context?: IChatExecuteActionContext): Promise<void> {
	const widget = context?.widget ?? accessor.get(IChatWidgetService).lastFocusedWidget;
	if (!widget) {
		accessor.get(INotificationService).error(localize('forge.orchestration.noChat', "先打开 Codex 聊天，再开始编排。"));
		return;
	}
	startDialecticOrchestrationFromAccessor(accessor, widget, context?.inputValue ?? widget.getInput());
	orchestrationBars.get(widget)?.closePicker();
}

function toggleAssignmentPicker(accessor: ServicesAccessor, context?: IChatExecuteActionContext): void {
	const widget = context?.widget ?? accessor.get(IChatWidgetService).lastFocusedWidget;
	if (!widget) {
		accessor.get(INotificationService).error(localize('forge.orchestration.noChat', "先打开 Codex 聊天，再开始编排。"));
		return;
	}
	orchestrationBars.get(widget)?.togglePicker();
}

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: FORGE_ORCHESTRATE_ACTION_ID,
			title: localize2('forge.orchestration.run', "编排"),
			f1: true,
			category: CHAT_CATEGORY,
			precondition: ContextKeyExpr.and(
				ChatContextKeys.enabled,
				ContextKeyExpr.equals(`config.${FORGE_WORK_MODE_SETTING_ID}`, 'dialectic'),
			),
		});
	}
	run(accessor: ServicesAccessor, ...args: unknown[]): Promise<void> {
		return runOrchestration(accessor, args[0] as IChatExecuteActionContext | undefined);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: FORGE_ORCHESTRATION_ASSIGN_ACTION_ID,
			title: localize2('forge.orchestration.assign', "指定 Leader / Worker"),
			f1: true,
			category: CHAT_CATEGORY,
			icon: Codicon.organization,
			menu: {
				id: MenuId.ChatExecute,
				group: 'navigation',
				order: 6,
				when: ContextKeyExpr.and(
					ChatContextKeys.enabled,
					ContextKeyExpr.equals(`config.${FORGE_WORK_MODE_SETTING_ID}`, 'dialectic'),
				),
			},
		});
	}
	run(accessor: ServicesAccessor, ...args: unknown[]): void {
		toggleAssignmentPicker(accessor, args[0] as IChatExecuteActionContext | undefined);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: FORGE_ORCHESTRATION_COMMAND_ACTION_ID,
			title: localize2('forge.orchestration.command', "编排任务命令"),
			f1: false,
			category: CHAT_CATEGORY,
		});
	}
	run(accessor: ServicesAccessor, command?: IOrchestrationCommand): void {
		if (!command?.type) {
			return;
		}
		dispatchForgeRootConfig(accessor.get(IAgentHostService), {
			[FORGE_ORCHESTRATION_COMMAND_KEY]: { ...command, commandId: generateUuid() },
		});
	}
});

class ForgeOrchestrationContribution extends Disposable {
	static readonly ID = 'workbench.contrib.forgeOrchestration';

	constructor(
		@IChatWidgetService private readonly _chatWidgetService: IChatWidgetService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IAgentHostService private readonly _agentHostService: IAgentHostService,
		@IConfigurationService configurationService: IConfigurationService,
		@ICommandService commandService: ICommandService,
	) {
		super();
		const restore = () => restoreOrchestrationAssignment(this._agentHostService, configurationService);
		restore();
		this._register(this._agentHostService.rootState.onDidChange(() => {
			restore();
			const run = readOrchestrationState(forgeRootConfigValues(this._agentHostService));
			if (run) {
				clearDialecticOrchestrationPending();
			}
		}));
		this._register(commandService.onWillExecuteCommand(event => {
			if (event.commandId !== CancelChatActionId) {
				return;
			}
			const run = readOrchestrationState(forgeRootConfigValues(this._agentHostService));
			cancelForgeOrchestration(this._agentHostService, run?.runId);
			const widget = this._chatWidgetService.lastFocusedWidget;
			if (widget) {
				completeStaleChatRequest(widget);
			}
		}));
		for (const widget of this._chatWidgetService.getAllWidgets()) {
			if (isIChatViewViewContext(widget.viewContext)) {
				this._register(instantiationService.createInstance(ForgeOrchestrationBar, widget));
			}
		}
		this._register(this._chatWidgetService.onDidAddWidget(widget => {
			if (isIChatViewViewContext(widget.viewContext)) {
				this._register(instantiationService.createInstance(ForgeOrchestrationBar, widget));
			}
		}));
	}
}

class ForgeOrchestrationBar extends Disposable {
	private readonly _host: HTMLElement;
	private readonly _picker: HTMLElement;
	private readonly _status: HTMLElement;
	private readonly _assign: HTMLElement;
	private readonly _sessionStore = this._register(new MutableDisposable<DisposableStore>());
	private readonly _statusStore = this._register(new MutableDisposable<DisposableStore>());
	private readonly _pickerStore = this._register(new DisposableStore());
	private _pickerOpen = false;

	constructor(
		private readonly _widget: IChatWidget,
		@IAgentHostService private readonly _agentHostService: IAgentHostService,
		@ICommandService private readonly _commandService: ICommandService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		super();
		orchestrationBars.set(_widget, this);
		this._register({ dispose: () => orchestrationBars.delete(_widget) });
		this._host = $('.forge-orch-host');
		this._status = append(this._host, $('.forge-orch'));
		this._status.setAttribute('role', 'status');
		this._status.setAttribute('aria-live', 'polite');
		this._picker = append(this._host, $('.forge-orch-picker'));
		this._assign = append(this._host, $('button.forge-orch-assign', { type: 'button' }));
		this._picker.setAttribute('role', 'dialog');
		this._picker.setAttribute('aria-label', localize('forge.orchestration.pickerLabel', "指定 Leader 和 Worker"));
		this._attach();
		this._register(this._widget.onDidChangeViewModel(() => this._attach()));
		this._register(this._agentHostService.rootState.onDidChange(() => this._render()));
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(FORGE_WORK_MODE_SETTING_ID) || e.affectsConfiguration(FORGE_AGENT_SETUP_SETTING_ID)) {
				if (readForgeWorkMode(this._configurationService.getValue(FORGE_WORK_MODE_SETTING_ID)) !== 'dialectic') {
					this._pickerOpen = false;
				}
				this._render();
			}
		}));
		this._register(addDisposableListener(this._assign, 'click', () => this.togglePicker()));
		const win = getWindow(this._host);
		this._register(addDisposableListener(win, 'mousedown', e => this._onPointerDown(e)));
		this._register(addDisposableListener(win, 'keydown', e => {
			if (e.key === 'Escape' && this._pickerOpen) {
				this.closePicker();
				this._assign.focus();
			}
		}));
		this._render();
	}

	togglePicker(): void {
		this._pickerOpen = !this._pickerOpen;
		this._render();
		if (this._pickerOpen) {
			queueMicrotask(() => this._picker.querySelector<HTMLButtonElement>('button')?.focus());
		}
	}

	closePicker(): void {
		if (!this._pickerOpen) {
			return;
		}
		this._pickerOpen = false;
		this._render();
	}

	private _onPointerDown(event: MouseEvent): void {
		if (!this._pickerOpen) {
			return;
		}
		const target = event.target;
		if (!(target instanceof HTMLElement)) {
			return;
		}
		if (this._host.contains(target) || isAssignToolbarButton(target)) {
			return;
		}
		this.closePicker();
	}

	private _attach(): void {
		const store = new DisposableStore();
		this._sessionStore.value = store;
		const container = this._widget.input.persistentContentContainerElement;
		if (!container.contains(this._host)) {
			container.prepend(this._host);
			store.add({ dispose: () => this._host.remove() });
		}
	}

	private _assignment(): IOrchestrationAssignment {
		return resolveDialecticAssignment(
			this._agentHostService,
			readForgeAgentSetup(this._configurationService.getValue(FORGE_AGENT_SETUP_SETTING_ID)),
			this._configurationService,
		);
	}

	private _render(): void {
		const assignment = this._assignment();
		const run = readOrchestrationState(forgeRootConfigValues(this._agentHostService));
		const dialectic = readForgeWorkMode(this._configurationService.getValue(FORGE_WORK_MODE_SETTING_ID)) === 'dialectic';
		const matchesWidget = !run || orchestrationRunMatchesWidget(this._widget, run);
		this._assign.style.display = dialectic ? '' : 'none';
		if (!dialectic) {
			this._pickerOpen = false;
		}
		const visibleRun = matchesWidget && run && (dialectic || isActiveOrchestrationStatus(run.status)) ? run : undefined;
		this._renderAssign(assignment);
		this._renderPicker(assignment);
		this._renderStatus(visibleRun);
		this._host.style.display = dialectic || visibleRun ? '' : 'none';
	}

	private _renderAssign(assignment: IOrchestrationAssignment): void {
		clearNode(this._assign);
		this._assign.classList.toggle('open', this._pickerOpen);
		this._assign.setAttribute('aria-expanded', this._pickerOpen ? 'true' : 'false');
		this._assign.setAttribute('aria-haspopup', 'dialog');
		append(this._assign, $('span.forge-orch-assign-k', undefined, localize('forge.orchestration.leaderShort', "Leader")));
		append(this._assign, $('span.forge-orch-assign-v', undefined, agentLabel(assignment.leader)));
		append(this._assign, $('span.forge-orch-assign-k', undefined, localize('forge.orchestration.workerShort', "Worker")));
		append(this._assign, $('span.forge-orch-assign-v', undefined, assignment.workers.map(worker => worker.label).join(' · ') || localize('forge.orchestration.noWorker', "未选择")));
		const chevron = append(this._assign, $('span'));
		chevron.className = ThemeIcon.asClassName(this._pickerOpen ? Codicon.chevronDown : Codicon.chevronUp);
	}

	private _renderPicker(assignment: IOrchestrationAssignment): void {
		this._pickerStore.clear();
		clearNode(this._picker);
		this._picker.style.display = this._pickerOpen ? '' : 'none';
		if (!this._pickerOpen) {
			return;
		}
		const setup = readForgeAgentSetup(this._configurationService.getValue(FORGE_AGENT_SETUP_SETTING_ID));
		const head = append(this._picker, $('div.forge-agent-picker-head'));
		append(head, $('div.forge-orch-picker-title', undefined, localize('forge.orchestration.pick', "指定 Leader 和 Worker")));
		const gear = append(head, $('button.forge-agent-picker-setup', { type: 'button' }));
		gear.setAttribute('aria-label', localize('forge.agentSetup.open', "配置 Agent 模型"));
		gear.classList.add(...ThemeIcon.asClassNameArray(Codicon.gear));
		this._pickerStore.add(addDisposableListener(gear, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			this.closePicker();
			void this._commandService.executeCommand(FORGE_AGENT_SETUP_OPEN_ACTION_ID, { tab: 'dialectic' });
		}));
		append(this._picker, $('div.forge-orch-picker-title', undefined, localize('forge.orchestration.pickLeader', "选择 Leader")));
		const leaders = append(this._picker, $('div.forge-orch-choices', { role: 'radiogroup' }));
		for (const agent of FORGE_ORCHESTRATION_AGENTS) {
			const model = getAgentProfile(setup, 'dialectic', agent.providerId).model ?? agent.defaultModel;
			this._choice(leaders, agent.label, model, assignment.leader.providerId === agent.providerId, 'radio', () => {
				this._saveAssignment({
					leader: providerRefFromProfile(agent.providerId, 'leader', setup),
					workers: assignment.workers,
				});
			});
		}
		append(this._picker, $('div.forge-orch-picker-title', undefined, localize('forge.orchestration.pickWorkers', "选择 Worker（可多选）")));
		const workers = append(this._picker, $('div.forge-orch-choices'));
		for (const agent of FORGE_ORCHESTRATION_AGENTS) {
			const selected = assignment.workers.some(worker => worker.providerId === agent.providerId);
			const model = getAgentProfile(setup, 'dialectic', agent.providerId).model ?? agent.defaultModel;
			this._choice(workers, agent.label, model, selected, 'checkbox', () => {
				const nextWorkers = selected
					? assignment.workers.filter(worker => worker.providerId !== agent.providerId)
					: [...assignment.workers, providerRefFromProfile(agent.providerId, 'worker', setup)];
				if (nextWorkers.length === 0) {
					return;
				}
				this._saveAssignment({
					leader: assignment.leader,
					workers: FORGE_ORCHESTRATION_AGENTS
						.filter(entry => nextWorkers.some(worker => worker.providerId === entry.providerId))
						.map(entry => providerRefFromProfile(entry.providerId, 'worker', setup)),
				});
			});
		}
	}

	private _choice(parent: HTMLElement, label: string, model: string, selected: boolean, kind: 'radio' | 'checkbox', run: () => void): void {
		const button = append(parent, $('button.forge-orch-choice', { type: 'button' }));
		button.setAttribute('role', kind === 'radio' ? 'radio' : 'checkbox');
		button.setAttribute('aria-checked', selected ? 'true' : 'false');
		button.classList.toggle('selected', selected);
		append(button, $('span.forge-orch-choice-mark'));
		append(button, $('span.forge-orch-choice-label', undefined, label));
		append(button, $('span.forge-orch-choice-model', undefined, model));
		this._pickerStore.add(addDisposableListener(button, 'click', run));
	}

	private _saveAssignment(assignment: IOrchestrationAssignment): void {
		dispatchForgeRootConfig(this._agentHostService, { [FORGE_ORCHESTRATION_ASSIGNMENT_KEY]: assignment });
		void persistOrchestrationAssignment(this._configurationService, assignment);
	}

	private _renderStatus(run: IOrchestrationRunState | undefined): void {
		const store = new DisposableStore();
		this._statusStore.value = store;
		clearNode(this._status);
		if (!run || run.status === 'idle') {
			this._status.style.display = 'none';
			return;
		}
		this._status.style.display = '';
		const row = append(this._status, $('.forge-orch-row'));
		append(row, $('span.forge-orch-status', undefined, statusLabel(run.status))).classList.add(run.status);
		append(row, $('span.forge-orch-title', undefined, run.planSummary || run.goal));
		const actions = append(row, $('.forge-orch-actions'));
		if (isActiveOrchestrationStatus(run.status)) {
			if (run.status === 'paused') {
				this._button(actions, localize('forge.orchestration.resume', "继续"), () => this._command({ type: 'resume', runId: run.runId }), store);
			} else {
				this._button(actions, localize('forge.orchestration.pause', "暂停"), () => this._command({ type: 'pause', runId: run.runId }), store);
			}
			this._button(actions, localize('forge.orchestration.cancel', "取消"), () => this._command({ type: 'cancel', runId: run.runId }), store);
		}
		this._button(actions, localize('forge.orchestration.scm', "更改"), () => this._commandService.executeCommand('workbench.view.scm'), store);

		if (run.tasks.length > 0) {
			const tasks = append(this._status, $('.forge-orch-tasks'));
			for (const task of run.tasks) {
				const taskElement = append(tasks, $('.forge-orch-task'));
				const taskRow = append(taskElement, $('.forge-orch-row'));
				append(taskRow, $('span.forge-orch-status', undefined, statusLabel(task.status))).classList.add(task.status);
				append(taskRow, $('span.forge-orch-title', undefined, task.title));
				if (task.status === 'failed') {
					const taskActions = append(taskRow, $('.forge-orch-actions'));
					this._button(taskActions, localize('forge.orchestration.retryTask', "重试"), () => this._command({ type: 'retry', runId: run.runId, taskId: task.id }), store);
					this._button(taskActions, localize('forge.orchestration.escalateTask', "Leader 接管"), () => this._command({ type: 'escalate', runId: run.runId, taskId: task.id }), store);
				}

				const worker = task.workerModel ? `${task.workerLabel} · ${task.workerModel}` : task.workerLabel;
				append(taskElement, $('div.forge-orch-worker', undefined, localize('forge.orchestration.taskWorker', "{0} · 第 {1} 次尝试", worker, task.attempt + 1)));
				const files = task.result?.changedFiles.length ? task.result.changedFiles : task.files;
				if (files.length > 0) {
					const visibleFiles = files.slice(0, 3).join(' · ');
					const suffix = files.length > 3 ? localize('forge.orchestration.moreFiles', " · 另 {0} 个", files.length - 3) : '';
					const fileElement = append(taskElement, $('div.forge-orch-files', undefined, `${visibleFiles}${suffix}`));
					fileElement.title = files.join('\n');
				}
				const error = task.error ?? task.result?.error;
				if (error) {
					append(taskElement, $('div.forge-orch-error', undefined, error));
				}
			}
		}

		if (run.review) {
			append(this._status, $('.forge-orch-review', undefined, run.review));
		}
	}

	private _button(parent: HTMLElement, label: string, run: () => void, store: DisposableStore): void {
		const button = append(parent, $('button.forge-orch-btn', { type: 'button' }, label));
		store.add(addDisposableListener(button, 'click', run));
	}

	private _command(command: IOrchestrationCommand): void {
		void this._commandService.executeCommand(FORGE_ORCHESTRATION_COMMAND_ACTION_ID, command);
	}
}

function isAssignToolbarButton(target: HTMLElement): boolean {
	const item = target.closest('.action-item');
	const labelled = target.closest('[aria-label], [title]');
	const text = [
		labelled?.getAttribute('aria-label'),
		labelled?.getAttribute('title'),
		item?.querySelector('[aria-label]')?.getAttribute('aria-label'),
		item?.querySelector('[title]')?.getAttribute('title'),
	].filter(Boolean).join(' ');
	return text.includes('指定 Leader') || text.includes('Leader / Worker');
}

function agentLabel(agent: { label: string; model?: string }): string {
	return agent.model ? `${agent.label} · ${agent.model}` : agent.label;
}

function statusLabel(status: string): string {
	switch (status) {
		case 'planning': return localize('forge.orchestration.status.planning', "规划中");
		case 'running': return localize('forge.orchestration.status.running', "执行中");
		case 'reviewing': return localize('forge.orchestration.status.reviewing', "审核中");
		case 'queued': return localize('forge.orchestration.status.queued', "排队");
		case 'completed': return localize('forge.orchestration.status.completed', "完成");
		case 'failed': return localize('forge.orchestration.status.failed', "失败");
		case 'retry': return localize('forge.orchestration.status.retry', "重试");
		case 'escalated': return localize('forge.orchestration.status.escalated', "已升级");
		case 'cancelled': return localize('forge.orchestration.status.cancelled', "已取消");
		case 'paused': return localize('forge.orchestration.status.paused', "已暂停");
		default: return status;
	}
}

registerWorkbenchContribution2(ForgeOrchestrationContribution.ID, ForgeOrchestrationContribution, WorkbenchPhase.AfterRestored);
