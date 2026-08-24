/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/forgeOrchestration.css';
import { $, addDisposableListener, append, EventHelper, isAncestor, type EventLike } from '../../../../base/browser/dom.js';
import { BaseActionViewItem } from '../../../../base/browser/ui/actionbar/actionViewItems.js';
import { IAction } from '../../../../base/common/actions.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { AnchorAlignment, AnchorPosition } from '../../../../base/common/layout.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize } from '../../../../nls.js';
import { IActionViewItemService } from '../../../../platform/actions/browser/actionViewItemService.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Extensions as ConfigurationExtensions, ConfigurationScope, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { IContextViewService, type IOpenContextView } from '../../../../platform/contextview/browser/contextView.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { OpenModelPickerAction } from '../../chat/browser/actions/chatExecuteActions.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { FORGE_WORK_MODE_SETTING_ID, readForgeWorkMode, type ForgeWorkMode } from '../common/forgeWorkMode.js';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'forge',
	title: localize('forge.configuration', "Forge"),
	type: 'object',
	properties: {
		[FORGE_WORK_MODE_SETTING_ID]: {
			type: 'string',
			enum: ['logos', 'dialectic'],
			enumItemLabels: ['Logos', 'Dialectic'],
			enumDescriptions: [
				localize('forge.workMode.logos.desc', "单一 Agent 工作，和以前一样。"),
				localize('forge.workMode.dialectic.desc', "指定 Leader 和 Worker，并行编排。"),
			],
			default: 'logos',
			description: localize('forge.workMode', "Agent 工作模式。Logos 选择一个模型直接工作；Dialectic 由 Leader 规划并由 Worker 并行执行。"),
			scope: ConfigurationScope.APPLICATION,
		},
	},
});

class ForgeWorkModeContribution extends Disposable {
	static readonly ID = 'workbench.contrib.forgeWorkMode';

	constructor(
		@IActionViewItemService actionViewItemService: IActionViewItemService,
	) {
		super();
		this._register(actionViewItemService.register(
			MenuId.ChatInput,
			OpenModelPickerAction.ID,
			(action, _options, instantiationService) => instantiationService.createInstance(ForgeWorkModeActionViewItem, action),
		));
	}
}

class ForgeWorkModeActionViewItem extends BaseActionViewItem {
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
			if (e.affectsConfiguration(FORGE_WORK_MODE_SETTING_ID)) {
				this._renderLabel();
			}
		}));
		this._register({ dispose: () => this._close() });
	}

	override render(container: HTMLElement): void {
		super.render(container);
		container.classList.add('forge-work-mode-item', 'chat-input-picker-item');
		const root = append(container, $('div.action-label.forge-work-mode'));
		root.setAttribute('role', 'button');
		root.setAttribute('aria-haspopup', 'listbox');
		this._label = append(root, $('span.forge-work-mode-label'));
		const chevron = append(root, $('span'));
		chevron.className = ThemeIcon.asClassName(Codicon.chevronUp);
		this._renderLabel();
	}

	override onClick(event: EventLike, _preserveFocus = false): void {
		EventHelper.stop(event, true);
		this._toggle();
	}

	private _mode(): ForgeWorkMode {
		return readForgeWorkMode(this._configurationService.getValue(FORGE_WORK_MODE_SETTING_ID));
	}

	private _open(): boolean {
		return !!this._openView;
	}

	private _renderLabel(): void {
		if (!this._label) {
			return;
		}
		const mode = this._mode();
		this._label.textContent = mode === 'dialectic' ? 'Dialectic' : 'Logos';
		const trigger = this.element?.querySelector('.forge-work-mode');
		trigger?.setAttribute('aria-expanded', this._open() ? 'true' : 'false');
		trigger?.setAttribute('aria-label', localize('forge.workMode.aria', "工作模式，{0}", this._label.textContent));
	}

	private _toggle(): void {
		const now = Date.now();
		if (now - this._lastToggle < 250) {
			return;
		}
		this._lastToggle = now;
		if (this._open()) {
			this._close();
			return;
		}
		this._show();
	}

	private _close(): void {
		this._openView?.close();
		this._openView = undefined;
		this._renderLabel();
	}

	private _show(): void {
		const anchor = this.element;
		if (!anchor) {
			return;
		}
		this._openView = this._contextViewService.showContextView({
			getAnchor: () => anchor,
			anchorAlignment: AnchorAlignment.LEFT,
			anchorPosition: AnchorPosition.ABOVE,
			render: container => this._renderPicker(container),
			onDOMEvent: e => this._onPickerEvent(e),
			onHide: () => {
				this._openView = undefined;
				this._renderLabel();
			},
		});
		this._renderLabel();
	}

	private _onPickerEvent(e: Event): void {
		if (e.type === 'keydown' && (e as KeyboardEvent).key === 'Escape') {
			this._close();
			return;
		}
		if (e.type !== 'click' && e.type !== 'mousedown') {
			return;
		}
		const target = e.target;
		if (!(target instanceof HTMLElement)) {
			return;
		}
		if (this.element && isAncestor(target, this.element)) {
			return;
		}
		if (isAncestor(target, this._contextViewService.getContextViewElement())) {
			return;
		}
		this._close();
	}

	private _renderPicker(container: HTMLElement): DisposableStore {
		const store = new DisposableStore();
		const picker = append(container, $('div.forge-work-mode-picker'));
		picker.setAttribute('role', 'listbox');
		append(picker, $('div.forge-orch-picker-title', undefined, localize('forge.workMode.pick', "工作模式")));
		const list = append(picker, $('div.forge-orch-choices'));
		this._choice(store, list, 'Logos', localize('forge.workMode.logos.hint', "右侧选择一个 Agent，直接工作"), 'logos');
		this._choice(store, list, 'Dialectic', localize('forge.workMode.dialectic.hint', "选择 Leader 和 Worker，并行编排"), 'dialectic');
		return store;
	}

	private _choice(store: DisposableStore, parent: HTMLElement, label: string, detail: string, mode: ForgeWorkMode): void {
		const selected = this._mode() === mode;
		const button = append(parent, $('button.forge-orch-choice', { type: 'button' }));
		button.setAttribute('role', 'option');
		button.setAttribute('aria-selected', selected ? 'true' : 'false');
		button.classList.toggle('selected', selected);
		append(button, $('span.forge-orch-choice-mark'));
		append(button, $('span.forge-orch-choice-label', undefined, label));
		append(button, $('span.forge-orch-choice-model', undefined, detail));
		store.add(addDisposableListener(button, 'click', () => {
			void this._configurationService.updateValue(FORGE_WORK_MODE_SETTING_ID, mode, ConfigurationTarget.USER);
			this._close();
		}));
	}
}

registerWorkbenchContribution2(ForgeWorkModeContribution.ID, ForgeWorkModeContribution, WorkbenchPhase.BlockRestore);
