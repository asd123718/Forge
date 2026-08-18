/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../../base/browser/dom.js';
import { Button } from '../../../../../base/browser/ui/button/button.js';
import { SelectBox, type ISelectOptionItem } from '../../../../../base/browser/ui/selectBox/selectBox.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { CODEX_MODEL_CATALOG, allocateCodexProviderId, defaultCodexModelProviderEntry, getCodexModelCatalogEntry, isLocalCatalog, isOllamaCatalog, normalizeCodexModelsConfig, withDefaultCodexRouting, type ICodexModelCatalogEntry, type ICodexModelProviderEntry, type ICodexModelsConfig, type ICodexSavedModel } from '../../../../../platform/agentHost/common/codexModelsConfig.js';
import { forgeLocalize } from '../../../../../platform/agentHost/common/forgeLocale.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { ollamaTagsUrl, parseOllamaTagsJson, uniqueModelNames } from '../../../../../platform/native/common/ollamaList.js';
import { defaultButtonStyles, defaultSelectBoxStyles } from '../../../../../platform/theme/browser/defaultStyles.js';

const INSERT_SHIFT_MS = 170;
const INSERT_POP_MS = 200;

/**
 * Editable "Models" section rendered inside the Codex harness settings.
 *
 * The header New button appends a provider card. The New button beside Model
 * name appends another model row on that same card.
 */
export class AgentModelsSettings extends Disposable {
	private readonly container: HTMLElement;
	private readonly renderDisposables = this._register(new DisposableStore());

	private model: string;
	private modelProvider: string;
	private providers: ICodexModelProviderEntry[];
	private activeProviderId: string | undefined;
	private originalProviders: readonly ICodexModelProviderEntry[];
	private readonly pendingApiKeys = new Map<string, string>();
	private readonly discoveredLocalModels = new Map<string, readonly string[]>();
	private readonly discoveringLocal = new Set<string>();
	private readonly localSelects = new Map<string, { providerIndex: number; rowIndex: number; select: SelectBox }>();
	private readonly catalogSelects = new Map<number, SelectBox>();
	private readonly modelNewButtons = new Map<number, Button[]>();
	private readonly modelRemoveButtons = new Map<number, Button[]>();
	private listEl: HTMLElement | undefined;
	private addProviderButton: Button | undefined;

	private focusTarget: (() => void) | undefined;

	constructor(
		parent: HTMLElement,
		value: unknown,
		private readonly onSave: (value: ICodexModelsConfig) => Promise<void> | void,
		private readonly readApiKey?: (providerId: string) => Promise<string | undefined> | undefined,
		private readonly writeApiKey?: (providerId: string, apiKey: string | undefined) => Promise<void> | undefined,
		private readonly contextViewService?: IContextViewService,
		private readonly discoverLocalModelsFn?: (catalogId: string, baseUrl: string) => Promise<readonly string[]>,
	) {
		super();
		const config = normalizeCodexModelsConfig(value);
		this.model = config.model;
		this.modelProvider = config.modelProvider;
		this.providers = config.providers.length > 0 ? [...config.providers] : [defaultCodexModelProviderEntry()];
		this.activeProviderId = config.activeProviderId ?? this.providers[0]?.id;
		this.originalProviders = config.providers;
		this.container = DOM.append(parent, DOM.$('.agent-models-settings'));
		this.render();
		void this.hydrateStoredApiKeys();
	}

	focus(): void { this.focusTarget?.(); }

	private activeProviderIndex(): number {
		const byId = this.providers.findIndex(provider => provider.id !== '' && provider.id === this.activeProviderId);
		if (byId >= 0) {
			return byId;
		}
		const unsaved = this.providers.findIndex(provider => provider.id === this.activeProviderId || (this.activeProviderId === undefined && provider.id === ''));
		return unsaved >= 0 ? unsaved : 0;
	}

	private discoveryKey(provider: ICodexModelProviderEntry): string {
		return provider.id || `draft:${this.providers.indexOf(provider)}`;
	}

	private visibleModels(provider: ICodexModelProviderEntry): ICodexSavedModel[] {
		if (provider.models.length > 0) {
			return provider.models.map(model => ({ ...model }));
		}
		return [{ name: provider.selectedModel, enabled: true }];
	}

	private usedCatalogIds(exceptIndex?: number): Set<string> {
		return new Set(this.providers
			.filter((_, index) => index !== exceptIndex)
			.map(provider => provider.catalogId));
	}

	private nextUnusedCatalogId(): string | undefined {
		const used = this.usedCatalogIds();
		return CODEX_MODEL_CATALOG.find(entry => !used.has(entry.id))?.id;
	}

	private usedModelNames(index: number, exceptRow?: number): Set<string> {
		return new Set(this.visibleModels(this.providers[index])
			.filter((_, rowIndex) => rowIndex !== exceptRow)
			.map(model => model.name.trim())
			.filter(name => name !== ''));
	}

	private canAddModelRow(index: number): boolean {
		const provider = this.providers[index];
		if (!provider) {
			return false;
		}
		return !this.visibleModels(provider).some(model => model.name.trim() === '');
	}

	private catalogSelectOptions(index: number): { value: string; label: string; detail?: string; disabled?: boolean }[] {
		const used = this.usedCatalogIds(index);
		return CODEX_MODEL_CATALOG.map(entry => ({
			value: entry.id,
			label: entry.label,
			disabled: used.has(entry.id),
			detail: used.has(entry.id)
				? forgeLocalize('codex.models.provider.alreadyAdded', 'Already added', '已添加')
				: entry.group === 'local'
					? forgeLocalize('codex.models.provider.group.local', 'Local', '本地')
					: forgeLocalize('codex.models.provider.group.cloud', 'Cloud', '云端'),
		}));
	}

	private render(): void {
		this.renderDisposables.clear();
		this.localSelects.clear();
		this.catalogSelects.clear();
		this.modelNewButtons.clear();
		this.modelRemoveButtons.clear();
		this.listEl = undefined;
		this.addProviderButton = undefined;
		DOM.clearNode(this.container);
		this.focusTarget = undefined;

		if (this.providers.length === 0) {
			this.providers = [defaultCodexModelProviderEntry()];
		}

		const providersSection = DOM.append(this.container, DOM.$('.agent-models-providers'));
		const providersHeader = DOM.append(providersSection, DOM.$('.agent-models-providers-header'));
		const providersCopy = DOM.append(providersHeader, DOM.$('.agent-models-providers-copy'));
		DOM.append(providersCopy, DOM.$('.agent-models-providers-title')).textContent = forgeLocalize('codex.models.customProviders', 'Providers', '提供商');
		DOM.append(providersCopy, DOM.$('.agent-models-providers-description')).textContent = forgeLocalize('codex.models.customProviders.description', 'New next to Providers adds another provider card. New next to Model name adds another model on this card.', '顶部新建添加提供商卡片。模型名称旁的新建会在同一张卡片里再加一个模型。');
		const addButton = this.renderDisposables.add(new Button(providersHeader, { ...defaultButtonStyles, secondary: true }));
		addButton.label = forgeLocalize('codex.models.addProvider', 'New', '新建');
		this.addProviderButton = addButton;
		this.renderDisposables.add(addButton.onDidClick(() => this.addProviderBlock()));

		this.listEl = DOM.append(providersSection, DOM.$('.agent-models-providers-list'));
		for (let i = 0; i < this.providers.length; i++) {
			this.renderProvider(DOM.append(this.listEl, DOM.$('.agent-models-provider')), i);
			if (isLocalCatalog(this.providers[i].catalogId)) {
				this.ensureLocalDiscovery(this.providers[i]);
			}
		}
		this.syncAddButtons();
	}

	private addProviderBlock(): void {
		const catalogId = this.nextUnusedCatalogId();
		if (!catalogId) {
			this.showError(forgeLocalize('codex.models.provider.allAdded', 'Every provider has already been added.', '所有提供商都已经添加过了。'));
			return;
		}
		const before = this.snapshotLayout();
		const next = defaultCodexModelProviderEntry(catalogId);
		this.providers = [...this.providers, next];
		this.activeProviderId = `draft:${this.providers.length - 1}`;
		if (!this.listEl) {
			this.render();
			return;
		}
		const card = DOM.append(this.listEl, DOM.$('.agent-models-provider'));
		this.renderProvider(card, this.providers.length - 1);
		if (isLocalCatalog(catalogId)) {
			this.ensureLocalDiscovery(this.providers[this.providers.length - 1]);
		}
		this.refreshCatalogSelects();
		this.syncAddButtons();
		this.playInsertAnimation(before, card);
	}

	private addModelRow(index: number): void {
		if (!this.canAddModelRow(index)) {
			this.showError(forgeLocalize('codex.models.model.alreadyAdded', 'This model has already been added, or finish the empty model row first.', '该模型已经添加过了，或请先完成当前空白的模型名称。'));
			return;
		}
		const before = this.snapshotLayout();
		const rows = this.visibleModels(this.providers[index]);
		this.updateProvider(index, { models: [...rows, { name: '', enabled: true }] });
		const card = this.listEl?.children[index] as HTMLElement | undefined;
		const modelRows = card?.querySelector('.agent-models-model-rows') as HTMLElement | undefined;
		if (!modelRows) {
			this.render();
			return;
		}
		const nextRows = this.visibleModels(this.providers[index]);
		const catalog = getCodexModelCatalogEntry(this.providers[index].catalogId);
		this.renderModelRow(modelRows, index, nextRows.length - 1, nextRows, catalog);
		const inserted = modelRows.lastElementChild as HTMLElement | null;
		this.refreshLocalSelects(this.discoveryKey(this.providers[index]));
		this.syncAddButtons();
		if (inserted) {
			this.playInsertAnimation(before, inserted);
		}
	}

	private removeModelRow(index: number, rowIndex: number): void {
		const rows = this.visibleModels(this.providers[index]).filter((_, i) => i !== rowIndex);
		const next = rows.length > 0 ? rows : [{ name: '', enabled: true }];
		this.updateProvider(index, { models: next, selectedModel: next.find(model => model.name.trim() !== '')?.name ?? '' });
		if (this.providers[index].id && this.originalProviders.some(provider => provider.id === this.providers[index].id)) {
			void this.persist(false);
			return;
		}
		this.render();
	}

	private renderProvider(card: HTMLElement, index: number): void {
		const provider = this.providers[index];
		const catalog = getCodexModelCatalogEntry(provider.catalogId);
		card.dataset['layoutId'] = `provider:${this.discoveryKey(provider)}`;
		const header = DOM.append(card, DOM.$('.agent-models-provider-header'));
		const identity = DOM.append(header, DOM.$('.agent-models-provider-identity'));
		DOM.append(identity, DOM.$('.agent-models-provider-title')).textContent = provider.name || catalog.label;
		const actions = DOM.append(header, DOM.$('.agent-models-provider-actions'));
		this.renderSwitch(actions, provider.enabled, forgeLocalize('codex.models.provider.enabled', 'Show this provider in the agent picker', '在 Agent 模型列表中显示此提供商'), enabled => {
			this.updateProvider(index, { enabled });
			void this.persistIfSaved(index);
		});
		const removeButton = this.renderDisposables.add(new Button(actions, { ...defaultButtonStyles, secondary: true }));
		removeButton.label = forgeLocalize('codex.models.provider.remove', 'Remove', '删除');
		this.renderDisposables.add(removeButton.onDidClick(() => {
			const removed = this.providers[index];
			this.providers = this.providers.filter((_, i) => i !== index);
			if (this.providers.length === 0) {
				this.providers = [defaultCodexModelProviderEntry()];
			}
			this.activeProviderId = this.providers[Math.min(index, this.providers.length - 1)]?.id || `draft:0`;
			if (removed.id && this.originalProviders.some(provider => provider.id === removed.id)) {
				void this.persist(false);
			} else {
				this.render();
			}
		}));

		const fields = DOM.append(card, DOM.$('.agent-models-provider-fields'));
		const catalogOptions = this.catalogSelectOptions(index);
		const catalogSelect = this.renderProviderSelect(fields, forgeLocalize('codex.models.provider.kind', 'Provider', '模型提供商'), catalogOptions, provider.catalogId);
		this.catalogSelects.set(index, catalogSelect);
		this.renderDisposables.add(catalogSelect.onDidSelect(event => {
			const selected = catalogOptions[event.index];
			if (!selected || selected.disabled) {
				return;
			}
			const nextCatalog = getCodexModelCatalogEntry(selected.value);
			if (this.usedCatalogIds(index).has(nextCatalog.id)) {
				this.showError(forgeLocalize('codex.models.provider.alreadyAdded.error', 'Provider "{0}" has already been added.', '提供商“{0}”已经添加过了。', nextCatalog.label));
				return;
			}
			this.applyCatalog(index, nextCatalog);
			this.render();
		}));

		const modelRows = DOM.append(fields, DOM.$('.agent-models-model-rows.agent-models-provider-field-wide'));
		const rows = this.visibleModels(provider);
		for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
			this.renderModelRow(modelRows, index, rowIndex, rows, catalog);
		}

		const baseUrlInput = this.renderProviderField(
			fields,
			forgeLocalize('codex.models.provider.baseUrl', 'Provider URL', '提供商网址'),
			catalog.autoConfigure
				? catalog.defaultBaseUrl
				: forgeLocalize('codex.models.provider.baseUrl.placeholder', 'https://api.example.com/v1', 'https://api.example.com/v1'),
			provider.baseUrl,
			'text',
			'agent-models-provider-field-wide',
			`field:${this.discoveryKey(provider)}:url`,
		);
		if (catalog.autoConfigure && !provider.baseUrl) {
			baseUrlInput.value = catalog.defaultBaseUrl;
			this.updateProvider(index, { baseUrl: catalog.defaultBaseUrl });
		}
		this.renderDisposables.add(DOM.addDisposableListener(baseUrlInput, 'input', () => {
			this.updateProvider(index, { baseUrl: baseUrlInput.value.trim() });
			if (isLocalCatalog(this.providers[index].catalogId)) {
				this.discoveredLocalModels.delete(this.discoveryKey(this.providers[index]));
			}
		}));

		if (!catalog.autoConfigure) {
			const apiKeyInput = this.renderProviderField(
				fields,
				forgeLocalize('codex.models.provider.apiKey', 'API key', 'API 密钥'),
				forgeLocalize('codex.models.provider.apiKey.placeholder', 'Enter the API key', '请输入 API 密钥'),
				'',
				'password',
				'agent-models-provider-field-wide',
				`field:${this.discoveryKey(provider)}:api`,
			);
			this.renderDisposables.add(DOM.addDisposableListener(apiKeyInput, 'input', () => {
				const id = this.ensureProviderId(index);
				this.pendingApiKeys.set(id, apiKeyInput.value);
				this.updateProvider(index, { authMode: 'stored' });
			}));
		}
	}

	private renderModelRow(parent: HTMLElement, index: number, rowIndex: number, rows: readonly ICodexSavedModel[], catalog: ICodexModelCatalogEntry): void {
		const model = rows[rowIndex];
		const field = DOM.append(parent, DOM.$('.agent-models-provider-field.agent-models-model-row'));
		field.dataset['layoutId'] = `model:${this.discoveryKey(this.providers[index])}:${rowIndex}`;
		DOM.append(field, DOM.$('.agent-models-provider-field-label')).textContent = forgeLocalize('codex.models.provider.modelName', 'Model name', '模型名称');
		const controls = DOM.append(field, DOM.$('.agent-models-model-controls'));

		if (isLocalCatalog(catalog.id)) {
			this.renderLocalModelSelect(controls, index, rowIndex, model);
		} else {
			const input = DOM.append(controls, DOM.$('input.agent-global-configuration-settings-input.agent-models-model-input')) as HTMLInputElement;
			input.value = model.name;
			input.placeholder = forgeLocalize('codex.models.provider.modelName.placeholder', 'e.g. gpt-5.6', '例如 gpt-5.6');
			input.ariaLabel = forgeLocalize('codex.models.provider.modelName', 'Model name', '模型名称');
			this.renderDisposables.add(DOM.addDisposableListener(input, 'input', () => {
				this.updateModelRow(index, rowIndex, { name: input.value });
				const accepted = this.visibleModels(this.providers[index])[rowIndex]?.name ?? '';
				if (input.value.trim() !== '' && input.value.trim() !== accepted && this.usedModelNames(index, rowIndex).has(input.value.trim())) {
					input.value = accepted;
				}
			}));
			this.focusTarget ??= () => input.focus();
		}

		this.renderSwitch(controls, model.enabled, forgeLocalize('codex.models.model.enabled', 'Show this model in the agent picker', '在 Agent 模型列表中显示此模型'), enabled => {
			this.updateModelRow(index, rowIndex, { enabled });
			void this.persistIfSaved(index);
		});

		const newButton = this.renderDisposables.add(new Button(controls, { ...defaultButtonStyles, secondary: true }));
		newButton.label = forgeLocalize('codex.models.model.new', 'New', '新建');
		const buttons = this.modelNewButtons.get(index) ?? [];
		buttons.push(newButton);
		this.modelNewButtons.set(index, buttons);
		this.renderDisposables.add(newButton.onDidClick(() => this.addModelRow(index)));
		const saveButton = this.renderDisposables.add(new Button(controls, { ...defaultButtonStyles }));
		saveButton.label = forgeLocalize('codex.models.model.save', 'Save', '保存');
		this.renderDisposables.add(saveButton.onDidClick(() => void this.saveModels(index)));
		const removeButton = this.renderDisposables.add(new Button(controls, { ...defaultButtonStyles, secondary: true }));
		removeButton.label = forgeLocalize('codex.models.model.remove', 'Remove', '删除');
		const removeButtons = this.modelRemoveButtons.get(index) ?? [];
		removeButtons.push(removeButton);
		this.modelRemoveButtons.set(index, removeButtons);
		removeButton.enabled = rows.length > 1;
		this.renderDisposables.add(removeButton.onDidClick(() => this.removeModelRow(index, rowIndex)));
	}

	private renderLocalModelSelect(controls: HTMLElement, index: number, rowIndex: number, model: ICodexSavedModel): void {
		if (!this.contextViewService) {
			throw new Error('A context view service is required to render model provider selects.');
		}
		const provider = this.providers[index];
		const key = this.discoveryKey(provider);
		const discovered = this.discoveredLocalModels.get(key) ?? [];
		const loading = this.discoveringLocal.has(key);
		const options = this.localModelOptions(provider, model, index, rowIndex, discovered, loading, this.discoveredLocalModels.has(key));
		const selected = Math.max(0, options.findIndex(option => option.value === model.name && option.value !== ''));
		const selectContainer = DOM.append(controls, DOM.$('.agent-models-provider-select.agent-models-model-input'));
		const select = this.renderDisposables.add(new SelectBox(
			this.toSelectItems(options),
			selected,
			this.contextViewService,
			{ ...defaultSelectBoxStyles },
			{ ariaLabel: forgeLocalize('codex.models.provider.modelName', 'Model name', '模型名称'), useCustomDrawn: true, minBottomMargin: 8 },
		));
		select.render(selectContainer);
		this.localSelects.set(`${key}:${rowIndex}`, { providerIndex: index, rowIndex, select });
		this.renderDisposables.add(select.onDidSelect(event => {
			const current = this.providers[index];
			const latest = this.localModelOptions(
				current,
				this.visibleModels(current)[rowIndex] ?? { name: '', enabled: true },
				index,
				rowIndex,
				this.discoveredLocalModels.get(this.discoveryKey(current)) ?? [],
				this.discoveringLocal.has(this.discoveryKey(current)),
				this.discoveredLocalModels.has(this.discoveryKey(current)),
			);
			const value = latest[event.index]?.value ?? '';
			if (!value) {
				return;
			}
			if (this.usedModelNames(index, rowIndex).has(value)) {
				this.showError(forgeLocalize('codex.models.model.duplicate', 'Model "{0}" has already been added.', '模型“{0}”已经添加过了。', value));
				return;
			}
			this.updateModelRow(index, rowIndex, { name: value });
			this.refreshLocalSelects(this.discoveryKey(this.providers[index]));
			this.syncAddButtons();
		}));
		const startDiscovery = () => this.ensureLocalDiscovery(this.providers[index], true);
		this.renderDisposables.add(DOM.addDisposableListener(selectContainer, 'pointerdown', startDiscovery, true));
		this.renderDisposables.add(DOM.addDisposableListener(selectContainer, 'keydown', startDiscovery, true));
		this.focusTarget ??= () => select.focus();
	}

	private renderSwitch(parent: HTMLElement, checked: boolean, title: string, onChange: (checked: boolean) => void): void {
		const button = DOM.append(parent, DOM.$('button.agent-models-switch')) as HTMLButtonElement;
		button.type = 'button';
		button.title = title;
		button.setAttribute('role', 'switch');
		button.setAttribute('aria-checked', String(checked));
		button.setAttribute('aria-label', title);
		this.renderDisposables.add(DOM.addDisposableListener(button, 'click', event => {
			event.preventDefault();
			event.stopPropagation();
			const next = button.getAttribute('aria-checked') !== 'true';
			onChange(next);
			button.setAttribute('aria-checked', String(next));
		}));
	}

	private renderProviderField(parent: HTMLElement, label: string, placeholder: string, value: string, type = 'text', className?: string, layoutId?: string): HTMLInputElement {
		const field = DOM.append(parent, DOM.$('.agent-models-provider-field'));
		if (className) {
			field.classList.add(className);
		}
		if (layoutId) {
			field.dataset['layoutId'] = layoutId;
		}
		DOM.append(field, DOM.$('.agent-models-provider-field-label')).textContent = label;
		const input = DOM.append(field, DOM.$('input.agent-global-configuration-settings-input')) as HTMLInputElement;
		input.value = value;
		input.type = type;
		input.placeholder = placeholder;
		input.ariaLabel = label;
		return input;
	}

	private renderProviderSelect(parent: HTMLElement, label: string, options: readonly { value: string; label: string; detail?: string; disabled?: boolean }[], value: string): SelectBox {
		const field = DOM.append(parent, DOM.$('.agent-models-provider-field'));
		DOM.append(field, DOM.$('.agent-models-provider-field-label')).textContent = label;
		const selectContainer = DOM.append(field, DOM.$('.agent-models-provider-select'));
		const selected = Math.max(0, options.findIndex(option => option.value === value));
		if (!this.contextViewService) {
			throw new Error('A context view service is required to render model provider selects.');
		}
		const select = this.renderDisposables.add(new SelectBox(
			options.map(option => ({ text: option.label, detail: option.detail, isDisabled: option.disabled })),
			selected,
			this.contextViewService,
			{ ...defaultSelectBoxStyles },
			{ ariaLabel: label, useCustomDrawn: true, minBottomMargin: 8 },
		));
		select.render(selectContainer);
		return select;
	}

	private applyCatalog(index: number, catalog: ICodexModelCatalogEntry): void {
		const provider = this.providers[index];
		const previous = getCodexModelCatalogEntry(provider.catalogId);
		const keepUrl = provider.baseUrl !== '' && provider.baseUrl !== previous.defaultBaseUrl;
		this.updateProvider(index, {
			catalogId: catalog.id,
			name: catalog.label,
			kind: catalog.kind,
			baseUrl: catalog.autoConfigure ? (keepUrl ? provider.baseUrl : catalog.defaultBaseUrl) : (keepUrl ? provider.baseUrl : ''),
			authMode: catalog.autoConfigure ? 'none' : 'stored',
			envKey: '',
		});
	}

	private updateProvider(index: number, patch: Partial<ICodexModelProviderEntry>): void {
		this.providers = this.providers.map((p, i) => i === index ? { ...p, ...patch } : p);
	}

	private updateModelRow(index: number, rowIndex: number, patch: Partial<ICodexSavedModel>): void {
		const rows = this.visibleModels(this.providers[index]);
		if (!rows[rowIndex]) {
			return;
		}
		if (patch.name !== undefined) {
			const name = patch.name.trim();
			if (name && this.usedModelNames(index, rowIndex).has(name)) {
				this.showError(forgeLocalize('codex.models.model.duplicate', 'Model "{0}" has already been added.', '模型“{0}”已经添加过了。', name));
				return;
			}
		}
		rows[rowIndex] = { ...rows[rowIndex], ...patch };
		const selectedModel = (patch.name ?? rows[rowIndex].name).trim() || this.providers[index].selectedModel;
		this.updateProvider(index, { models: rows, selectedModel });
		this.container.querySelector('.agent-models-error')?.remove();
	}

	private ensureProviderId(index: number): string {
		const provider = this.providers[index];
		if (provider.id) {
			return provider.id;
		}
		const id = allocateCodexProviderId(provider.catalogId, this.providers.map(candidate => candidate.id).filter(candidate => candidate !== ''));
		this.updateProvider(index, { id });
		if (!this.activeProviderId || this.activeProviderId.startsWith('draft:')) {
			this.activeProviderId = id;
		}
		return id;
	}

	private async saveModels(index: number): Promise<void> {
		this.ensureProviderId(index);
		const seen = new Set<string>();
		const rows = this.visibleModels(this.providers[index])
			.map(model => ({ ...model, name: model.name.trim() }))
			.filter(model => {
				if (model.name === '' || seen.has(model.name)) {
					return false;
				}
				seen.add(model.name);
				return true;
			});
		const selectedModel = rows.find(model => model.name === this.providers[index].selectedModel)?.name
			?? rows[0]?.name
			?? '';
		this.updateProvider(index, { models: rows, selectedModel });
		const error = await this.persist(false);
		if (error) {
			return;
		}
		this.syncAddButtons();
	}

	private async persistIfSaved(index: number): Promise<void> {
		const provider = this.providers[index];
		if (provider?.id && this.originalProviders.some(candidate => candidate.id === provider.id)) {
			await this.persist(false);
		}
	}

	private async hydrateStoredApiKeys(): Promise<void> {
		for (const provider of this.providers.filter(candidate => candidate.authMode === 'stored' && candidate.id)) {
			const apiKey = await this.readApiKey?.(provider.id);
			if (apiKey) {
				await this.writeApiKey?.(provider.id, apiKey);
			}
		}
	}

	private toSelectItems(options: readonly { value: string; label: string; disabled?: boolean }[]): ISelectOptionItem[] {
		return options.map(option => ({ text: option.label, isDisabled: option.disabled || option.value === '' }));
	}

	private localModelOptions(provider: ICodexModelProviderEntry, row: ICodexSavedModel, providerIndex: number, rowIndex: number, discovered: readonly string[], loading: boolean, attempted: boolean): { value: string; label: string; disabled?: boolean }[] {
		const used = this.usedModelNames(providerIndex, rowIndex);
		const names = uniqueModelNames([row.name, ...discovered]).filter(name => name === row.name.trim() || !used.has(name));
		if (names.length > 0) {
			const items = names.map(name => ({ value: name, label: name, disabled: used.has(name) && name !== row.name.trim() }));
			if (!row.name.trim()) {
				return [{
					value: '',
					label: forgeLocalize('codex.models.local.choose', 'Select a model', '选择模型'),
				}, ...items];
			}
			return items;
		}
		if (loading) {
			return [{
				value: '',
				label: isOllamaCatalog(provider.catalogId)
					? forgeLocalize('codex.models.ollama.loading', 'Detecting models with ollama list...', '正在用 ollama list 检测模型...')
					: forgeLocalize('codex.models.local.loading', 'Detecting local models...', '正在自动检测本地模型...'),
			}];
		}
		if (!attempted) {
			return [{
				value: '',
				label: forgeLocalize('codex.models.local.openToDetect', 'Open to auto-detect models', '打开下拉列以自动检测'),
			}];
		}
		return [{
			value: '',
			label: isOllamaCatalog(provider.catalogId)
				? forgeLocalize('codex.models.ollama.empty', 'No Ollama models detected', '未检测到 Ollama 模型')
				: forgeLocalize('codex.models.local.empty', 'No local models detected', '未检测到本地模型'),
		}];
	}

	private refreshLocalSelects(key: string): void {
		for (const [selectKey, entry] of this.localSelects) {
			if (!selectKey.startsWith(`${key}:`)) {
				continue;
			}
			const provider = this.providers[entry.providerIndex];
			if (!provider) {
				continue;
			}
			const row = this.visibleModels(provider)[entry.rowIndex] ?? { name: '', enabled: true };
			const options = this.localModelOptions(
				provider,
				row,
				entry.providerIndex,
				entry.rowIndex,
				this.discoveredLocalModels.get(key) ?? [],
				this.discoveringLocal.has(key),
				this.discoveredLocalModels.has(key),
			);
			const selected = Math.max(0, options.findIndex(option => option.value === row.name && option.value !== ''));
			entry.select.setOptions(this.toSelectItems(options), selected);
		}
	}

	private refreshCatalogSelects(): void {
		for (const [index, select] of this.catalogSelects) {
			const options = this.catalogSelectOptions(index);
			const selected = Math.max(0, options.findIndex(option => option.value === this.providers[index]?.catalogId));
			select.setOptions(options.map(option => ({ text: option.label, detail: option.detail, isDisabled: option.disabled })), selected);
		}
	}

	private syncAddButtons(): void {
		if (this.addProviderButton) {
			this.addProviderButton.enabled = !!this.nextUnusedCatalogId();
		}
		for (const [index, buttons] of this.modelNewButtons) {
			const enabled = this.canAddModelRow(index);
			for (const button of buttons) {
				button.enabled = enabled;
			}
		}
		for (const [index, buttons] of this.modelRemoveButtons) {
			const enabled = this.visibleModels(this.providers[index] ?? defaultCodexModelProviderEntry()).length > 1;
			for (const button of buttons) {
				button.enabled = enabled;
			}
		}
	}

	private snapshotLayout(): Map<string, DOMRect> {
		const map = new Map<string, DOMRect>();
		for (const el of this.container.querySelectorAll('[data-layout-id]')) {
			const id = (el as HTMLElement).dataset['layoutId'];
			if (id) {
				map.set(id, el.getBoundingClientRect());
			}
		}
		return map;
	}

	private prefersReducedMotion(): boolean {
		return this.container.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
	}

	private playInsertAnimation(before: Map<string, DOMRect>, inserted: HTMLElement): void {
		const finish = () => {
			inserted.classList.remove('agent-models-enter', 'agent-models-enter-pending');
			inserted.style.pointerEvents = '';
			inserted.style.opacity = '';
			inserted.style.transform = '';
			for (const el of moving) {
				el.classList.remove('agent-models-layout-moving');
				el.style.transition = '';
				el.style.transform = '';
				el.style.pointerEvents = '';
			}
		};
		const moving: HTMLElement[] = [];
		if (this.prefersReducedMotion()) {
			finish();
			inserted.scrollIntoView({ block: 'nearest' });
			return;
		}
		for (const node of this.container.querySelectorAll('[data-layout-id]')) {
			const el = node as HTMLElement;
			if (el === inserted) {
				continue;
			}
			const first = el.dataset['layoutId'] ? before.get(el.dataset['layoutId']) : undefined;
			if (!first) {
				continue;
			}
			const last = el.getBoundingClientRect();
			const dy = first.top - last.top;
			if (Math.abs(dy) < 0.5) {
				continue;
			}
			el.style.transition = 'none';
			el.style.transform = `translateY(${dy}px)`;
			el.classList.add('agent-models-layout-moving');
			moving.push(el);
		}
		inserted.classList.add('agent-models-enter-pending');
		inserted.getBoundingClientRect();
		const win = this.container.ownerDocument.defaultView;
		win?.requestAnimationFrame(() => {
			for (const el of moving) {
				el.style.transition = `transform ${INSERT_SHIFT_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
				el.style.transform = '';
			}
		});
		const pop = () => {
			inserted.classList.remove('agent-models-enter-pending');
			inserted.classList.add('agent-models-enter');
			inserted.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		};
		if (moving.length > 0) {
			win?.setTimeout(pop, INSERT_SHIFT_MS);
		} else {
			win?.requestAnimationFrame(pop);
		}
		inserted.addEventListener('animationend', event => {
			if (event.target === inserted) {
				finish();
			}
		}, { once: true });
		win?.setTimeout(finish, INSERT_SHIFT_MS + INSERT_POP_MS + 80);
	}

	private ensureLocalDiscovery(provider: ICodexModelProviderEntry | undefined, force = false): void {
		if (!provider || !isLocalCatalog(provider.catalogId)) {
			return;
		}
		const key = this.discoveryKey(provider);
		if (!force && (this.discoveringLocal.has(key) || this.discoveredLocalModels.has(key))) {
			return;
		}
		if (this.discoveringLocal.has(key)) {
			return;
		}
		this.discoveringLocal.add(key);
		if (!this.discoveredLocalModels.has(key)) {
			this.refreshLocalSelects(key);
		}
		const catalog = getCodexModelCatalogEntry(provider.catalogId);
		void this.discoverLocalModels(catalog, provider.baseUrl || catalog.defaultBaseUrl).then(models => {
			this.discoveringLocal.delete(key);
			this.discoveredLocalModels.set(key, models);
			this.refreshLocalSelects(key);
			this.syncAddButtons();
		});
	}

	private async discoverLocalModels(catalog: ICodexModelCatalogEntry, baseUrl: string): Promise<readonly string[]> {
		if (this.discoverLocalModelsFn) {
			return uniqueModelNames(await this.discoverLocalModelsFn(catalog.id, baseUrl));
		}
		try {
			if (isOllamaCatalog(catalog.id)) {
				return await this.discoverOllamaModels(baseUrl);
			}
			const url = new URL(baseUrl || catalog.defaultBaseUrl || 'http://localhost:1234/v1');
			url.search = '';
			url.hash = '';
			if (catalog.kind === 'lmstudio') {
				url.pathname = `${url.pathname.replace(/\/(?:v1|api)\/?$/, '').replace(/\/$/, '')}/api/v0/models`;
			} else if (!/\/models\/?$/.test(url.pathname)) {
				url.pathname = `${url.pathname.replace(/\/$/, '')}/models`;
			}
			const response = await fetch(url.toString());
			if (!response.ok) {
				return [];
			}
			const body = await response.json() as { data?: Array<{ id?: string; name?: string }>; models?: Array<{ id?: string; name?: string }> };
			const raw = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : Array.isArray(body) ? body as Array<{ id?: string; name?: string }> : [];
			return uniqueModelNames(raw.map(model => model.id || model.name || ''));
		} catch {
			return [];
		}
	}

	private async discoverOllamaModels(baseUrl: string): Promise<readonly string[]> {
		const urls = uniqueModelNames([
			ollamaTagsUrl(baseUrl || 'http://127.0.0.1:11434/v1'),
			'http://127.0.0.1:11434/api/tags',
			'http://localhost:11434/api/tags',
		]);
		for (const url of urls) {
			try {
				const response = await fetch(url);
				if (!response.ok) {
					continue;
				}
				const names = parseOllamaTagsJson(await response.json());
				if (names.length > 0) {
					return names;
				}
			} catch {
				continue;
			}
		}
		return [];
	}

	private async persist(requireApiKeys: boolean): Promise<string | undefined> {
		const drafts = this.providers.map(provider => provider.models.filter(model => model.name.trim() === ''));
		const usedIds = new Set(this.providers.map(provider => provider.id).filter(id => id !== ''));
		const providers = this.providers.map(provider => {
			const catalog = getCodexModelCatalogEntry(provider.catalogId);
			let id = provider.id;
			if (!id) {
				id = allocateCodexProviderId(provider.catalogId, [...usedIds]);
				usedIds.add(id);
			}
			const seen = new Set<string>();
			const models = provider.models.filter(model => {
				const name = model.name.trim();
				if (name === '' || seen.has(name)) {
					return false;
				}
				seen.add(name);
				return true;
			});
			return {
				...provider,
				id,
				name: catalog.label,
				baseUrl: provider.baseUrl || (catalog.autoConfigure ? catalog.defaultBaseUrl : ''),
				authMode: catalog.autoConfigure ? 'none' as const : 'stored' as const,
				kind: catalog.kind,
				models,
			};
		});
		this.providers = providers.map((provider, index) => drafts[index]?.length
			? { ...provider, models: [...provider.models, ...drafts[index]] }
			: provider);
		const active = this.providers[this.activeProviderIndex()] ?? providers[0];
		this.activeProviderId = active?.id;
		const config = withDefaultCodexRouting({
			model: this.model.trim(),
			modelProvider: this.modelProvider.trim(),
			providers,
			activeProviderId: providers.some(provider => provider.id === this.activeProviderId) ? this.activeProviderId : providers[0]?.id,
		});
		this.model = config.model;
		this.modelProvider = config.modelProvider;
		const error = this.validate(config);
		if (error) {
			this.showError(error);
			return error;
		}
		if (requireApiKeys) {
			for (const provider of config.providers.filter(candidate => candidate.authMode === 'stored')) {
				const pending = this.pendingApiKeys.get(provider.id)?.trim();
				const existing = await this.readApiKey?.(provider.id);
				if (!pending && !existing) {
					const message = forgeLocalize('codex.models.provider.apiKey.required', 'Enter an API key for {0}.', '请填写 {0} 的 API 密钥。', provider.name || provider.id);
					this.showError(message);
					return message;
				}
			}
		}
		const previousProviders = this.originalProviders;
		await this.onSave(config);
		this.originalProviders = config.providers;
		const nextIds = new Set(config.providers.map(provider => provider.id));
		for (const previous of previousProviders) {
			const next = config.providers.find(provider => provider.id === previous.id);
			if (!nextIds.has(previous.id) || (previous.authMode === 'stored' && next?.authMode !== 'stored')) {
				await this.writeApiKey?.(previous.id, undefined);
			}
		}
		for (const provider of config.providers.filter(candidate => candidate.authMode === 'stored')) {
			const pending = this.pendingApiKeys.get(provider.id)?.trim();
			const existing = await this.readApiKey?.(provider.id);
			await this.writeApiKey?.(provider.id, pending || existing);
		}
		this.pendingApiKeys.clear();
		this.container.querySelector('.agent-models-error')?.remove();
		return undefined;
	}

	private validate(config: ICodexModelsConfig): string | undefined {
		const ids = new Set<string>();
		const catalogs = new Set<string>();
		for (const provider of config.providers) {
			if (!/^[A-Za-z0-9_-]+$/.test(provider.id)) {
				return forgeLocalize('codex.models.provider.id.invalid', 'Provider IDs may only contain letters, numbers, underscores, and hyphens.', '提供商内部标识只能包含字母、数字、下划线和连字符。');
			}
			if (ids.has(provider.id)) {
				return forgeLocalize('codex.models.provider.id.duplicate', 'Provider "{0}" is duplicated.', '提供商“{0}”重复了。', provider.id);
			}
			ids.add(provider.id);
			if (catalogs.has(provider.catalogId)) {
				return forgeLocalize('codex.models.provider.alreadyAdded.error', 'Provider "{0}" has already been added.', '提供商“{0}”已经添加过了。', provider.name || provider.catalogId);
			}
			catalogs.add(provider.catalogId);
			const modelNames = new Set<string>();
			for (const model of provider.models) {
				const name = model.name.trim();
				if (name === '') {
					continue;
				}
				if (modelNames.has(name)) {
					return forgeLocalize('codex.models.model.duplicate', 'Model "{0}" has already been added.', '模型“{0}”已经添加过了。', name);
				}
				modelNames.add(name);
			}
			if (!provider.baseUrl) {
				if (provider.models.length === 0) {
					continue;
				}
				return forgeLocalize('codex.models.provider.baseUrl.required', 'Provider URL is required for {0}.', '请填写 {0} 的提供商网址。', provider.name || provider.id);
			}
			try {
				const url = new URL(provider.baseUrl);
				if (url.protocol !== 'http:' && url.protocol !== 'https:') {
					throw new Error('unsupported protocol');
				}
			} catch {
				return forgeLocalize('codex.models.provider.baseUrl.invalid', 'Enter a valid HTTP or HTTPS URL for {0}.', '请为 {0} 输入有效的 HTTP 或 HTTPS 网址。', provider.name || provider.id);
			}
		}
		return undefined;
	}

	private showError(message: string): void {
		this.container.querySelector('.agent-models-error')?.remove();
		DOM.append(this.container, DOM.$('.agent-models-error')).textContent = message;
	}
}
