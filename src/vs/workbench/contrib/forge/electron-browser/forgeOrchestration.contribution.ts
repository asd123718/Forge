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
	DEFAULT_ORCHESTRATION_ASSIGNMENT,
	FORGE_ORCHESTRATION_AGENTS,
	FORGE_ORCHESTRATION_ASSIGNMENT_KEY,
	FORGE_ORCHESTRATION_COMMAND_KEY,
	FORGE_ORCHESTRATION_REQUEST_KEY,
	isActiveOrchestrationStatus,
	readAssignment,
	readOrchestrationState,
	type IOrchestrationAssignment,
	type IOrchestrationCommand,
	type IOrchestrationRunState,
	type IOrchestrationTaskState,
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
import { IChatExecuteActionContext } from '../../chat/browser/actions/chatExecuteActions.js';
import { CHAT_CATEGORY } from '../../chat/browser/actions/chatActions.js';
import { ChatContextKeys } from '../../chat/common/actions/chatContextKeys.js';
import { ICodexAccountService } from '../../../services/agentHost/browser/codexAccountService.js';
import { getCodexRemainingPercent } from './forgeAccount.contribution.js';
import { FORGE_WORK_MODE_SETTING_ID, readForgeWorkMode } from '../common/forgeWorkMode.js';
import { FORGE_AGENT_SETUP_OPEN_ACTION_ID, FORGE_AGENT_SETUP_SETTING_ID, getAgentProfile, providerRefFromProfile, readForgeAgentSetup } from '../common/forgeAgentSetup.js';
import {
	buildDialecticOrchestrationRequest,
	dispatchForgeRootConfig,
	forgeRootConfigValues,
	resolveDialecticAssignment,
} from '../common/forgeOrchestrationRun.js';

export const FORGE_ORCHESTRATE_ACTION_ID = 'forge.orchestration.run';
export const FORGE_ORCHESTRATION_ASSIGN_ACTION_ID = 'forge.orchestration.assign';
export const FORGE_ORCHESTRATION_COMMAND_ACTION_ID = 'forge.orchestration.command';

const orchestrationBars = new WeakMap<IChatWidget, ForgeOrchestrationBar>();

async function runOrchestration(accessor: ServicesAccessor, context?: IChatExecuteActionContext): Promise<void> {
	const widget = context?.widget ?? accessor.get(IChatWidgetService).lastFocusedWidget;
	const notificationService = accessor.get(INotificationService);
	const workspaceContextService = accessor.get(IWorkspaceContextService);
	const agentHostService = accessor.get(IAgentHostService);
	if (!widget) {
		notificationService.error(localize('forge.orchestration.noChat', "先打开 Codex 聊天，再开始编排。"));
		return;
	}
	const goal = (context?.inputValue ?? widget.getInput()).trim();
	if (!goal) {
		notificationService.info(localize('forge.orchestration.needGoal', "先输入需求，再点编排。"));
		return;
	}
	const workspace = workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
	if (!workspace) {
		notificationService.error(localize('forge.orchestration.noFolder', "先打开一个工作区文件夹。"));
		return;
	}
	const setup = readForgeAgentSetup(accessor.get(IConfigurationService).getValue(FORGE_AGENT_SETUP_SETTING_ID));
	const assignment = resolveDialecticAssignment(agentHostService, setup);
	const request = buildDialecticOrchestrationRequest(goal, workspace, widget, assignment);
	widget.setInput('');
	orchestrationBars.get(widget)?.closePicker();
	dispatchForgeRootConfig(agentHostService, { [FORGE_ORCHESTRATION_REQUEST_KEY]: request });
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
			icon: Codicon.runAll,
			precondition: ChatContextKeys.enabled,
			menu: {
				id: MenuId.ChatExecute,
				group: 'navigation',
				order: 3.5,
				when: ContextKeyExpr.and(
					ChatContextKeys.enabled,
					ChatContextKeys.requestInProgress.negate(),
					ContextKeyExpr.equals(`config.${FORGE_WORK_MODE_SETTING_ID}`, 'dialectic'),
				),
			},
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
		@IChatWidgetService chatWidgetService: IChatWidgetService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		for (const widget of chatWidgetService.getAllWidgets()) {
			if (isIChatViewViewContext(widget.viewContext)) {
				this._register(instantiationService.createInstance(ForgeOrchestrationBar, widget));
			}
		}
		this._register(chatWidgetService.onDidAddWidget(widget => {
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
	private _expanded = false;
	private _pickerOpen = false;

	constructor(
		private readonly _widget: IChatWidget,
		@IAgentHostService private readonly _agentHostService: IAgentHostService,
		@ICommandService private readonly _commandService: ICommandService,
		@ICodexAccountService private readonly _codexAccountService: ICodexAccountService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		super();
		orchestrationBars.set(_widget, this);
		this._register({ dispose: () => orchestrationBars.delete(_widget) });
		this._host = $('.forge-orch-host');
		this._status = append(this._host, $('.forge-orch'));
		this._picker = append(this._host, $('.forge-orch-picker'));
		this._assign = append(this._host, $('button.forge-orch-assign', { type: 'button' }));
		this._picker.setAttribute('role', 'dialog');
		this._picker.setAttribute('aria-label', localize('forge.orchestration.pickerLabel', "指定 Leader 和 Worker"));
		this._attach();
		this._register(this._widget.onDidChangeViewModel(() => this._attach()));
		this._register(this._agentHostService.rootState.onDidChange(() => this._render()));
		this._register(this._codexAccountService.onDidChangeAccount(() => this._render()));
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
			}
		}));
		this._render();
	}

	togglePicker(): void {
		this._pickerOpen = !this._pickerOpen;
		this._render();
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
		return readAssignment(forgeRootConfigValues(this._agentHostService)[FORGE_ORCHESTRATION_ASSIGNMENT_KEY]) ?? DEFAULT_ORCHESTRATION_ASSIGNMENT;
	}

	private _render(): void {
		const assignment = this._assignment();
		const run = readOrchestrationState(rootValues(this._agentHostService));
		const dialectic = readForgeWorkMode(this._configurationService.getValue(FORGE_WORK_MODE_SETTING_ID)) === 'dialectic';
		this._assign.style.display = dialectic ? '' : 'none';
		if (!dialectic) {
			this._pickerOpen = false;
		}
		this._renderAssign(assignment);
		this._renderPicker(assignment);
		this._renderStatus(run);
		this._host.style.display = dialectic || run ? '' : 'none';
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
	}

	private _renderStatus(run: IOrchestrationRunState | undefined): void {
		const store = new DisposableStore();
		this._statusStore.value = store;
		clearNode(this._status);
		if (!run) {
			this._status.style.display = 'none';
			return;
		}
		this._status.style.display = '';
		const assignment = run.assignment;
		const row = append(this._status, $('.forge-orch-row'));
		append(row, $('span.forge-orch-status', undefined, statusLabel(run.status))).classList.add(run.status);
		append(row, $('span.forge-orch-title', undefined, run.planSummary || run.goal));
		append(row, $('span.forge-orch-meta', undefined, formatUsage(run, this._codexAccountService)));
		const actions = append(row, $('.forge-orch-actions'));
		this._button(actions, this._expanded ? localize('forge.orchestration.collapse', "收起") : localize('forge.orchestration.expand', "详情"), () => {
			this._expanded = !this._expanded;
			this._render();
		}, store);
		if (isActiveOrchestrationStatus(run.status)) {
			if (run.status === 'paused') {
				this._button(actions, localize('forge.orchestration.resume', "继续"), () => this._command({ type: 'resume', runId: run.runId }), store);
			} else {
				this._button(actions, localize('forge.orchestration.pause', "暂停"), () => this._command({ type: 'pause', runId: run.runId }), store);
			}
			this._button(actions, localize('forge.orchestration.cancel', "取消"), () => this._command({ type: 'cancel', runId: run.runId }), store);
		}
		this._button(actions, localize('forge.orchestration.scm', "更改"), () => this._commandService.executeCommand('workbench.view.scm'), store);

		if (!this._expanded && !isActiveOrchestrationStatus(run.status) && !run.error) {
			append(this._status, $('div.forge-orch-meta', undefined, `${assignment.leader.label}${assignment.leader.model ? ` · ${assignment.leader.model}` : ''}  →  ${assignment.workers.map(worker => worker.label).join(' / ')}`));
			if (run.review) {
				append(this._status, $('div.forge-orch-review', undefined, run.review));
			}
			return;
		}

		append(this._status, $('div.forge-orch-meta', undefined, localize('forge.orchestration.leaderLine', "Leader：{0}{1}", assignment.leader.label, assignment.leader.model ? ` · ${assignment.leader.model}` : '')));
		append(this._status, $('div.forge-orch-meta', undefined, localize('forge.orchestration.workerLine', "Workers：{0}", assignment.workers.map(worker => `${worker.label}${worker.model ? ` (${worker.model})` : ''}`).join(' · '))));
		const tasks = append(this._status, $('.forge-orch-tasks'));
		for (const task of run.tasks) {
			this._renderTask(tasks, run, task, store);
		}
		if (run.review) {
			append(this._status, $('div.forge-orch-review', undefined, run.review));
		}
		if (run.error) {
			append(this._status, $('div.forge-orch-error', undefined, run.error));
		}
	}

	private _renderTask(parent: HTMLElement, run: IOrchestrationRunState, task: IOrchestrationTaskState, store: DisposableStore): void {
		const row = append(parent, $('.forge-orch-task'));
		const head = append(row, $('.forge-orch-row'));
		append(head, $('span.forge-orch-status', undefined, statusLabel(task.status))).classList.add(task.status);
		append(head, $('span.forge-orch-title', undefined, task.title));
		append(head, $('span.forge-orch-worker', undefined, `${task.workerLabel}${task.workerModel ? ` · ${task.workerModel}` : ''}`));
		const actions = append(head, $('.forge-orch-actions'));
		if (task.status === 'failed' || task.status === 'retry') {
			this._button(actions, localize('forge.orchestration.retry', "重试"), () => this._command({ type: 'retry', runId: run.runId, taskId: task.id }), store);
			this._button(actions, localize('forge.orchestration.escalate', "升级 Leader"), () => this._command({ type: 'escalate', runId: run.runId, taskId: task.id }), store);
		}
		const files = task.result?.changedFiles?.length ? task.result.changedFiles : (task.status === 'running' ? task.files : []);
		if (files.length) {
			append(row, $('div.forge-orch-files', undefined, localize('forge.orchestration.files', "文件：{0}", files.join(', '))));
		}
		if (task.error) {
			append(row, $('div.forge-orch-error', undefined, task.error));
		} else if (task.result?.summary && (this._expanded || task.status === 'failed')) {
			append(row, $('div.forge-orch-meta', undefined, task.result.summary));
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

function formatUsage(run: IOrchestrationRunState, account: ICodexAccountService): string {
	const seconds = Math.max(0, Math.round((run.usage.durationMs || (Date.now() - run.startedAt)) / 1000));
	const tokens = (run.usage.inputTokens ?? 0) + (run.usage.outputTokens ?? 0);
	const parts = [`${seconds}s`];
	if (tokens > 0) {
		parts.push(`${tokens} tok`);
	}
	if (run.usage.costUsd) {
		parts.push(`$${run.usage.costUsd.toFixed(3)}`);
	}
	const remaining = getCodexRemainingPercent(account.account.rateLimit);
	if (remaining !== undefined) {
		parts.push(localize('forge.orchestration.codexRemaining', "Codex {0}%", Math.round(remaining)));
	}
	return parts.join(' · ');
}

registerWorkbenchContribution2(ForgeOrchestrationContribution.ID, ForgeOrchestrationContribution, WorkbenchPhase.AfterRestored);
