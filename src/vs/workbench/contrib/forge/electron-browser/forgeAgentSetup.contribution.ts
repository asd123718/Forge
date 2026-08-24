/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/forgeOrchestration.css';
import { $, addDisposableListener, append, clearNode, EventHelper, isAncestor, type EventLike } from '../../../../base/browser/dom.js';
import { BaseActionViewItem } from '../../../../base/browser/ui/actionbar/actionViewItems.js';
import { IAction } from '../../../../base/common/actions.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { AnchorAlignment, AnchorPosition } from '../../../../base/common/layout.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize, localize2 } from '../../../../nls.js';
import { IActionViewItemService } from '../../../../platform/actions/browser/actionViewItemService.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { CODEX_MODELS_ROOT_CONFIG_KEY } from '../../../../platform/agentHost/common/codexModelsConfig.js';
import { IAgentHostService } from '../../../../platform/agentHost/common/agentService.js';
import {
	FORGE_ORCHESTRATION_ASSIGNMENT_KEY,
	FORGE_ORCHESTRATION_REQUEST_KEY,
	orchestrationAgentInfo,
	readAssignment,
	type IOrchestrationRequest,
} from '../../../../platform/agentHost/common/orchestration/orchestrationTypes.js';
import { getReasoningEffortLabel } from '../../../../platform/agentHost/common/reasoningEffort.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Extensions as ConfigurationExtensions, ConfigurationScope, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { IContextViewService, type IOpenContextView } from '../../../../platform/contextview/browser/contextView.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IChatWidget, IChatWidgetService, isIChatViewViewContext } from '../../chat/browser/chat.js';
import { CHAT_CATEGORY } from '../../chat/browser/actions/chatActions.js';
import { ChatContextKeys } from '../../chat/common/actions/chatContextKeys.js';
import { ILanguageModelsService } from '../../chat/common/languageModels.js';
import { FORGE_WORK_MODE_SETTING_ID, readForgeWorkMode } from '../common/forgeWorkMode.js';
import {
	buildDialecticOrchestrationRequest,
	dispatchForgeRootConfig,
	forgeOrchestrationAddressesFromWidget,
	forgeRootConfigValues,
	resolveDialecticAssignment,
} from '../common/forgeOrchestrationRun.js';
import {
	FORGE_AGENT_SETUP_OPEN_ACTION_ID,
	FORGE_AGENT_SETUP_SETTING_ID,
	FORGE_CONTEXT_SIZE_OPTIONS,
	FORGE_LOGOS_AGENT_SETTING_ID,
	FORGE_LOGOS_PICK_AGENT_ACTION_ID,
	FORGE_ORCHESTRATION_AGENTS,
	FORGE_THINKING_LEVELS,
	assignmentWithDialecticProfiles,
	decodeSetupModel,
	findLanguageModelIdentifier,
	getAgentProfile,
	listForgeSetupModels,
	logosAssignment,
	readForgeAgentSetup,
	readLogosAgent,
	selectedSetupModelValue,
	withAgentProfile,
	withCurrentModelOption,
	type ForgeAgentColumn,
	type IForgeAgentProfile,
	type IForgeSetupModelOption,
} from '../common/forgeAgentSetup.js';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'forge',
	title: localize('forge.configuration', "Forge"),
	type: 'object',
	properties: {
		[FORGE_LOGOS_AGENT_SETTING_ID]: {
			type: 'string',
			enum: FORGE_ORCHESTRATION_AGENTS.map(agent => agent.providerId),
			enumItemLabels: FORGE_ORCHESTRATION_AGENTS.map(agent => agent.label),
			default: 'codex',
			description: localize('forge.logosAgent', "Logos 模式下使用的 Agent。"),
			scope: ConfigurationScope.APPLICATION,
		},
		[FORGE_AGENT_SETUP_SETTING_ID]: {
			type: 'object',
			additionalProperties: true,
			default: {},
			description: localize('forge.agentSetup', "每个 Agent 在 Logos / Dialectic 下使用的模型、思考深度和上下文长度。"),
			scope: ConfigurationScope.APPLICATION,
		},
	},
});

let agentSetupOverlay: ForgeAgentSetupOverlay | undefined;

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: FORGE_LOGOS_PICK_AGENT_ACTION_ID,
			title: localize2('forge.logos.pickAgent', "选择 Agent"),
			f1: false,
			category: CHAT_CATEGORY,
			menu: {
				id: MenuId.ChatExecute,
				group: 'navigation',
				order: 2,
				when: ContextKeyExpr.and(
					ChatContextKeys.enabled,
					ContextKeyExpr.equals(`config.${FORGE_WORK_MODE_SETTING_ID}`, 'logos'),
				),
			},
		});
	}
	run(): void { }
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: FORGE_AGENT_SETUP_OPEN_ACTION_ID,
			title: localize2('forge.agentSetup.open', "配置 Agent 模型"),
			f1: true,
			category: CHAT_CATEGORY,
		});
	}
	run(_accessor: unknown, arg?: { tab?: ForgeAgentColumn; anchor?: HTMLElement }): void {
		agentSetupOverlay?.open(arg);
	}
});

class ForgeAgentSetupContribution extends Disposable {
	static readonly ID = 'workbench.contrib.forgeAgentSetup';

	constructor(
		@IActionViewItemService actionViewItemService: IActionViewItemService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IChatWidgetService chatWidgetService: IChatWidgetService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILanguageModelsService private readonly _languageModelsService: ILanguageModelsService,
		@IAgentHostService private readonly _agentHostService: IAgentHostService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@INotificationService private readonly _notificationService: INotificationService,
	) {
		super();
		agentSetupOverlay = instantiationService.createInstance(ForgeAgentSetupOverlay);
		this._register({ dispose: () => { if (agentSetupOverlay) { agentSetupOverlay.dispose(); agentSetupOverlay = undefined; } } });
		this._register(actionViewItemService.register(
			MenuId.ChatExecute,
			FORGE_LOGOS_PICK_AGENT_ACTION_ID,
			(action, _options, inst) => inst.createInstance(ForgeLogosAgentPickerActionViewItem, action),
		));
		for (const widget of chatWidgetService.getAllWidgets()) {
			this._bindWidget(widget);
		}
		this._register(chatWidgetService.onDidAddWidget(widget => this._bindWidget(widget)));
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(FORGE_AGENT_SETUP_SETTING_ID) || e.affectsConfiguration(FORGE_LOGOS_AGENT_SETTING_ID) || e.affectsConfiguration(FORGE_WORK_MODE_SETTING_ID)) {
				this._syncDialecticAssignment();
				this._applyLogosSession(chatWidgetService);
			}
		}));
		this._register(this._languageModelsService.onDidChangeLanguageModels(() => this._applyLogosSession(chatWidgetService)));
		this._applyLogosSession(chatWidgetService);
	}

	private _bindWidget(widget: IChatWidget): void {
		if (!isIChatViewViewContext(widget.viewContext)) {
			return;
		}
		const original = widget.acceptInput.bind(widget);
		const wrapped: IChatWidget['acceptInput'] = async (query, options) => {
			const intercept = this._interceptedWorkMode();
			if (intercept === 'logos') {
				await this._runLogosAgent(widget, (query ?? widget.getInput()).trim());
				return undefined;
			}
			if (intercept === 'dialectic') {
				await this._runDialecticOrchestration(widget, (query ?? widget.getInput()).trim());
				return undefined;
			}
			return original(query, options);
		};
		(widget as unknown as { acceptInput: IChatWidget['acceptInput'] }).acceptInput = wrapped;
		this._register({ dispose: () => { (widget as unknown as { acceptInput: IChatWidget['acceptInput'] }).acceptInput = original; } });
	}

	private _interceptedWorkMode(): 'logos' | 'dialectic' | undefined {
		const mode = readForgeWorkMode(this._configurationService.getValue(FORGE_WORK_MODE_SETTING_ID));
		if (mode === 'dialectic') {
			return 'dialectic';
		}
		if (mode === 'logos' && readLogosAgent(this._configurationService.getValue(FORGE_LOGOS_AGENT_SETTING_ID)) !== 'codex') {
			return 'logos';
		}
		return undefined;
	}

	private async _runLogosAgent(widget: IChatWidget, goal: string): Promise<void> {
		if (!goal) {
			this._notificationService.info(localize('forge.logos.needGoal', "先输入需求，再发送。"));
			return;
		}
		const workspace = this._workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
		if (!workspace) {
			this._notificationService.error(localize('forge.orchestration.noFolder', "先打开一个工作区文件夹。"));
			return;
		}
		const setup = readForgeAgentSetup(this._configurationService.getValue(FORGE_AGENT_SETUP_SETTING_ID));
		const assignment = logosAssignment(readLogosAgent(this._configurationService.getValue(FORGE_LOGOS_AGENT_SETTING_ID)), setup);
		const addresses = forgeOrchestrationAddressesFromWidget(widget);
		const request: IOrchestrationRequest = {
			requestId: generateUuid(),
			goal,
			workspace,
			mode: 'logos',
			assignment,
			...addresses,
		};
		widget.setInput('');
		dispatchForgeRootConfig(this._agentHostService, { [FORGE_ORCHESTRATION_REQUEST_KEY]: request });
	}

	private async _runDialecticOrchestration(widget: IChatWidget, goal: string): Promise<void> {
		if (!goal) {
			this._notificationService.info(localize('forge.orchestration.needGoal', "先输入需求，再点编排。"));
			return;
		}
		const workspace = this._workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
		if (!workspace) {
			this._notificationService.error(localize('forge.orchestration.noFolder', "先打开一个工作区文件夹。"));
			return;
		}
		const setup = readForgeAgentSetup(this._configurationService.getValue(FORGE_AGENT_SETUP_SETTING_ID));
		const assignment = resolveDialecticAssignment(this._agentHostService, setup);
		const request = buildDialecticOrchestrationRequest(goal, workspace, widget, assignment);
		widget.setInput('');
		dispatchForgeRootConfig(this._agentHostService, { [FORGE_ORCHESTRATION_REQUEST_KEY]: request });
	}

	private _syncDialecticAssignment(): void {
		const current = readAssignment(forgeRootConfigValues(this._agentHostService)['forge.orchestration.assignment']);
		if (!current) {
			return;
		}
		const setup = readForgeAgentSetup(this._configurationService.getValue(FORGE_AGENT_SETUP_SETTING_ID));
		dispatchForgeRootConfig(this._agentHostService, {
			[FORGE_ORCHESTRATION_ASSIGNMENT_KEY]: assignmentWithDialecticProfiles(current, setup),
		});
	}

	private _applyLogosSession(chatWidgetService: IChatWidgetService): void {
		if (readForgeWorkMode(this._configurationService.getValue(FORGE_WORK_MODE_SETTING_ID)) !== 'logos') {
			return;
		}
		if (readLogosAgent(this._configurationService.getValue(FORGE_LOGOS_AGENT_SETTING_ID)) !== 'codex') {
			return;
		}
		const setup = readForgeAgentSetup(this._configurationService.getValue(FORGE_AGENT_SETUP_SETTING_ID));
		const profile = getAgentProfile(setup, 'logos', 'codex');
		const identifier = findLanguageModelIdentifier(this._languageModelsService.getLanguageModelIds(), profile.modelProviderId, profile.model);
		if (!identifier) {
			return;
		}
		for (const widget of chatWidgetService.getAllWidgets()) {
			if (!isIChatViewViewContext(widget.viewContext)) {
				continue;
			}
			void widget.input.requestModelByIdentifier(identifier);
			const values: Record<string, unknown> = {};
			if (profile.thinkingLevel) {
				values.thinkingLevel = profile.thinkingLevel;
			}
			if (profile.contextSize && profile.contextSize !== 'default') {
				const tokens = Number(profile.contextSize);
				values.contextSize = Number.isFinite(tokens) ? tokens : profile.contextSize;
			}
			if (Object.keys(values).length) {
				void widget.input.setModelConfiguration(identifier, values);
			}
		}
	}
}

class ForgeAgentSetupOverlay extends Disposable {
	private _openView: IOpenContextView | undefined;

	constructor(
		@IContextViewService private readonly _contextViewService: IContextViewService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IAgentHostService private readonly _agentHostService: IAgentHostService,
		@IChatWidgetService private readonly _chatWidgetService: IChatWidgetService,
	) {
		super();
	}

	open(arg?: { tab?: ForgeAgentColumn; anchor?: HTMLElement }): void {
		this.close();
		const anchor = arg?.anchor ?? this._chatWidgetService.lastFocusedWidget?.inputPart.element ?? this._chatWidgetService.lastFocusedWidget?.domNode;
		if (!anchor) {
			return;
		}
		this._openView = this._contextViewService.showContextView({
			getAnchor: () => anchor,
			anchorAlignment: AnchorAlignment.LEFT,
			anchorPosition: AnchorPosition.ABOVE,
			render: container => this._render(container, arg?.tab ?? 'logos'),
			onDOMEvent: e => this._onEvent(e),
			onHide: () => {
				this._openView = undefined;
			},
		});
	}

	close(): void {
		this._openView?.close();
		this._openView = undefined;
	}

	private _onEvent(e: Event): void {
		if (e.type === 'keydown' && (e as KeyboardEvent).key === 'Escape') {
			this.close();
			return;
		}
		if (e.type !== 'click') {
			return;
		}
		const target = e.target;
		if (!(target instanceof HTMLElement)) {
			return;
		}
		if (target.closest('select, option, optgroup')) {
			return;
		}
		if (isAncestor(target, this._contextViewService.getContextViewElement())) {
			return;
		}
		this.close();
	}

	private _render(container: HTMLElement, focusColumn: ForgeAgentColumn): DisposableStore {
		const store = new DisposableStore();
		const root = append(container, $('div.forge-agent-setup'));
		const header = append(root, $('div.forge-agent-setup-head'));
		append(header, $('div.forge-agent-setup-title', undefined, localize('forge.agentSetup.title', "Agent 配置")));
		const close = append(header, $('button.forge-agent-setup-close', { type: 'button' }));
		close.setAttribute('aria-label', localize('forge.agentSetup.close', "关闭"));
		close.classList.add(...ThemeIcon.asClassNameArray(Codicon.close));
		store.add(addDisposableListener(close, 'click', () => this.close()));
		append(root, $('div.forge-agent-setup-hint', undefined, localize('forge.agentSetup.hint', "模型与供应商来自设置中的 Models。这里只给每个 Agent 选要用哪一个，以及思考深度和上下文长度。")));
		const grid = append(root, $('div.forge-agent-setup-grid'));
		this._column(store, grid, 'logos', localize('forge.agentSetup.logos', "Logos"), focusColumn === 'logos');
		this._column(store, grid, 'dialectic', localize('forge.agentSetup.dialectic', "Dialectic"), focusColumn === 'dialectic');
		return store;
	}

	private _column(store: DisposableStore, parent: HTMLElement, column: ForgeAgentColumn, title: string, focused: boolean): void {
		const pane = append(parent, $('div.forge-agent-setup-col'));
		pane.classList.toggle('focused', focused);
		append(pane, $('div.forge-agent-setup-col-title', undefined, title));
		const setup = this._setup();
		const models = listForgeSetupModels(rootValues(this._agentHostService)[CODEX_MODELS_ROOT_CONFIG_KEY]);
		if (models.length === 0) {
			append(pane, $('div.forge-agent-setup-empty', undefined, localize('forge.agentSetup.noModels', "还没有启用的模型。请先在 Models 设置里启用供应商和模型。")));
		}
		for (const agent of FORGE_ORCHESTRATION_AGENTS) {
			this._agentCard(store, pane, column, agent.providerId, agent.label, setup, models);
		}
	}

	private _agentCard(store: DisposableStore, parent: HTMLElement, column: ForgeAgentColumn, providerId: string, label: string, setup: ReturnType<typeof readForgeAgentSetup>, models: readonly IForgeSetupModelOption[]): void {
		const profile = getAgentProfile(setup, column, providerId);
		const options = withCurrentModelOption(models, profile);
		const card = append(parent, $('div.forge-agent-setup-card'));
		append(card, $('div.forge-agent-setup-agent', undefined, label));
		this._select(store, card, localize('forge.agentSetup.model', "模型"), selectedSetupModelValue(profile, options), options.map(option => ({ value: option.value, label: `${option.providerName} / ${option.model}` })), value => {
			const decoded = decodeSetupModel(value);
			void this._patch(column, providerId, decoded
				? { modelProviderId: decoded.providerId, model: decoded.model }
				: { model: value });
		});
		this._select(store, card, localize('forge.agentSetup.thinking', "思考深度"), profile.thinkingLevel ?? 'medium', FORGE_THINKING_LEVELS.map(level => ({ value: level, label: getReasoningEffortLabel(level) })), value => {
			void this._patch(column, providerId, { thinkingLevel: value });
		});
		this._select(store, card, localize('forge.agentSetup.context', "上下文长度"), profile.contextSize ?? 'default', FORGE_CONTEXT_SIZE_OPTIONS.map(option => ({
			value: option.value,
			label: option.value === 'default' ? localize('forge.agentSetup.contextDefault', "默认") : option.label,
		})), value => {
			void this._patch(column, providerId, { contextSize: value });
		});
	}

	private _select(store: DisposableStore, parent: HTMLElement, label: string, value: string, options: readonly { value: string; label: string }[], onChange: (value: string) => void): void {
		const row = append(parent, $('label.forge-agent-setup-field'));
		append(row, $('span.forge-agent-setup-field-label', undefined, label));
		const select = append(row, $('select.forge-agent-setup-select'));
		for (const option of options) {
			const node = append(select, $('option'));
			node.value = option.value;
			node.textContent = option.label;
		}
		if (value && !options.some(option => option.value === value)) {
			const extra = append(select, $('option'));
			extra.value = value;
			extra.textContent = value;
		}
		select.value = value;
		store.add(addDisposableListener(select, 'change', () => onChange(select.value)));
	}

	private async _patch(column: ForgeAgentColumn, providerId: string, patch: Partial<IForgeAgentProfile>): Promise<void> {
		const next = withAgentProfile(this._setup(), column, providerId, patch);
		await this._configurationService.updateValue(FORGE_AGENT_SETUP_SETTING_ID, next, ConfigurationTarget.USER);
	}

	private _setup() {
		return readForgeAgentSetup(this._configurationService.getValue(FORGE_AGENT_SETUP_SETTING_ID));
	}
}

class ForgeLogosAgentPickerActionViewItem extends BaseActionViewItem {
	private _label: HTMLElement | undefined;
	private _openView: IOpenContextView | undefined;
	private _lastToggle = 0;

	constructor(
		action: IAction,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IContextViewService private readonly _contextViewService: IContextViewService,
	) {
		super(undefined, action);
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(FORGE_LOGOS_AGENT_SETTING_ID) || e.affectsConfiguration(FORGE_AGENT_SETUP_SETTING_ID)) {
				this._renderLabel();
			}
		}));
		this._register({ dispose: () => this._close() });
	}

	override render(container: HTMLElement): void {
		super.render(container);
		container.classList.add('forge-logos-agent-item', 'chat-input-picker-item');
		const root = append(container, $('div.action-label.forge-logos-agent'));
		root.setAttribute('role', 'button');
		root.setAttribute('aria-haspopup', 'listbox');
		this._label = append(root, $('span.forge-logos-agent-label'));
		const chevron = append(root, $('span'));
		chevron.className = ThemeIcon.asClassName(Codicon.chevronUp);
		this._renderLabel();
	}

	override onClick(event: EventLike): void {
		EventHelper.stop(event, true);
		this._toggle();
	}

	private _toggle(): void {
		const now = Date.now();
		if (now - this._lastToggle < 250) {
			return;
		}
		this._lastToggle = now;
		if (this._openView) {
			this._close();
			return;
		}
		this._show();
	}

	private _close(): void {
		this._openView?.close();
		this._openView = undefined;
	}

	private _show(): void {
		const anchor = this.element;
		if (!anchor) {
			return;
		}
		this._openView = this._contextViewService.showContextView({
			getAnchor: () => anchor,
			anchorAlignment: AnchorAlignment.RIGHT,
			anchorPosition: AnchorPosition.ABOVE,
			render: container => this._renderPicker(container),
			onDOMEvent: e => {
				if (e.type === 'keydown' && (e as KeyboardEvent).key === 'Escape') {
					this._close();
				}
			},
			onHide: () => { this._openView = undefined; },
		});
	}

	private _renderLabel(): void {
		if (!this._label) {
			return;
		}
		const agentId = readLogosAgent(this._configurationService.getValue(FORGE_LOGOS_AGENT_SETTING_ID));
		const agent = orchestrationAgentInfo(agentId);
		const profile = getAgentProfile(readForgeAgentSetup(this._configurationService.getValue(FORGE_AGENT_SETUP_SETTING_ID)), 'logos', agentId);
		this._label.textContent = agent?.label ?? agentId;
		this.element?.querySelector('.forge-logos-agent')?.setAttribute('aria-label', localize('forge.logos.agentAria', "Agent，{0}，{1}", agent?.label ?? agentId, profile.model ?? ''));
	}

	private _renderPicker(container: HTMLElement): DisposableStore {
		const store = new DisposableStore();
		const picker = append(container, $('div.forge-agent-picker'));
		const head = append(picker, $('div.forge-agent-picker-head'));
		append(head, $('div.forge-orch-picker-title', undefined, localize('forge.logos.pickAgentTitle', "选择 Agent")));
		const gear = append(head, $('button.forge-agent-picker-setup', { type: 'button' }));
		gear.setAttribute('aria-label', localize('forge.agentSetup.open', "配置 Agent 模型"));
		gear.classList.add(...ThemeIcon.asClassNameArray(Codicon.gear));
		store.add(addDisposableListener(gear, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			this._close();
			agentSetupOverlay?.open({ tab: 'logos', anchor: this.element });
		}));
		const list = append(picker, $('div.forge-orch-choices'));
		const selected = readLogosAgent(this._configurationService.getValue(FORGE_LOGOS_AGENT_SETTING_ID));
		const setup = readForgeAgentSetup(this._configurationService.getValue(FORGE_AGENT_SETUP_SETTING_ID));
		for (const agent of FORGE_ORCHESTRATION_AGENTS) {
			const profile = getAgentProfile(setup, 'logos', agent.providerId);
			const button = append(list, $('button.forge-orch-choice', { type: 'button' }));
			button.setAttribute('role', 'option');
			button.setAttribute('aria-selected', selected === agent.providerId ? 'true' : 'false');
			button.classList.toggle('selected', selected === agent.providerId);
			append(button, $('span.forge-orch-choice-mark'));
			append(button, $('span.forge-orch-choice-label', undefined, agent.label));
			append(button, $('span.forge-orch-choice-model', undefined, profile.model ?? agent.defaultModel));
			store.add(addDisposableListener(button, 'click', () => {
				void this._configurationService.updateValue(FORGE_LOGOS_AGENT_SETTING_ID, agent.providerId, ConfigurationTarget.USER);
				this._close();
			}));
		}
		return store;
	}
}

registerWorkbenchContribution2(ForgeAgentSetupContribution.ID, ForgeAgentSetupContribution, WorkbenchPhase.AfterRestored);
