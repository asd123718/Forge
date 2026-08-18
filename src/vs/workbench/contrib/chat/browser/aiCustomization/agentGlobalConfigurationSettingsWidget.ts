/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/agentGlobalConfigurationSettings.css';
import * as DOM from '../../../../../base/browser/dom.js';
import { Button } from '../../../../../base/browser/ui/button/button.js';
import { SelectBox } from '../../../../../base/browser/ui/selectBox/selectBox.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { autorun, type IObservable } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { readAgentCustomizationSettings, type IAgentCustomizationSettingsDescriptor } from '../../../../../platform/agentHost/common/agentCustomizationSettings.js';
import { getCodexModelCatalogEntry, isOllamaCatalog } from '../../../../../platform/agentHost/common/codexModelsConfig.js';
import { FORGE_DISPLAY_LANGUAGE_STORAGE_KEY, FORGE_LANGUAGE_PACK_EXTENSION_ID, forgeLocalize, getForgeDisplayLanguage, setForgeDisplayLanguageOverride, type ForgeDisplayLanguage } from '../../../../../platform/agentHost/common/forgeLocale.js';
import { ollamaTagsUrl, parseOllamaTagsJson, uniqueModelNames } from '../../../../../platform/native/common/ollamaList.js';
import type { ConfigPropertySchema, RootState } from '../../../../../platform/agentHost/common/state/protocol/state.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { Link } from '../../../../../platform/opener/browser/link.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { asJson, IRequestService, NO_FETCH_TELEMETRY } from '../../../../../platform/request/common/request.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { defaultButtonStyles, defaultSelectBoxStyles } from '../../../../../platform/theme/browser/defaultStyles.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { ILocaleService } from '../../../../services/localization/common/locale.js';
import { AgentModelsSettings } from './agentModelsSettings.js';

export interface IAgentGlobalConfigurationSettingsTarget {
	readonly onDidChange: (listener: () => void) => { dispose(): void };
	getState(): RootState | undefined;
	setValue(key: string, value: unknown): Promise<void>;
	mapResource(uri: URI): URI;
	getModelProviderApiKey?(providerId: string): Promise<string | undefined>;
	setModelProviderApiKey?(providerId: string, apiKey: string | undefined): Promise<void>;
	discoverLocalModels?(catalogId: string, baseUrl: string): Promise<readonly string[]>;
}

export type AgentSettingsWidgetMode = 'all' | 'harness' | 'models';

export class AHPAgentSettingsWidget extends Disposable {
	private readonly renderDisposables = this._register(new DisposableStore());
	private readonly targetListener = this._register(new MutableDisposable());
	private readonly container: HTMLElement;
	private target: IAgentGlobalConfigurationSettingsTarget | undefined;
	private focusTarget: (() => void) | undefined;

	constructor(parent: HTMLElement, private readonly agentProvider: string, target: IObservable<IAgentGlobalConfigurationSettingsTarget | undefined>, private readonly mode: AgentSettingsWidgetMode = 'all',
		@IContextViewService private readonly contextViewService: IContextViewService,
		@INotificationService private readonly notificationService: INotificationService,
		@IEditorService private readonly editorService: IEditorService,
		@IHoverService private readonly hoverService: IHoverService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IStorageService private readonly storageService: IStorageService,
		@ILocaleService private readonly localeService: ILocaleService,
		@IRequestService private readonly requestService: IRequestService,
	) {
		super();
		const stored = this.storageService.get(FORGE_DISPLAY_LANGUAGE_STORAGE_KEY, StorageScope.APPLICATION);
		if (stored === 'en' || stored === 'zh-cn') {
			setForgeDisplayLanguageOverride(stored);
		}
		this.container = DOM.append(parent, DOM.$('.agent-global-configuration-settings'));
		this._register(autorun(reader => this.connect(target.read(reader))));
	}

	layout(): void { this.container.classList.toggle('narrow', this.container.clientWidth < 560); }
	focus(): void { this.focusTarget?.(); }

	private connect(target: IAgentGlobalConfigurationSettingsTarget | undefined): void {
		if (this.target === target && target) { return; }
		this.target = target;
		this.targetListener.value = target?.onDidChange(() => this.render());
		this.render();
	}

	private render(): void {
		this.renderDisposables.clear();
		DOM.clearNode(this.container);
		this.focusTarget = undefined;
		const state = this.target?.getState();
		const descriptor = readAgentCustomizationSettings(state, this.agentProvider);
		if (!state?.config || !descriptor) {
			DOM.append(this.container, DOM.$('.agent-global-configuration-settings-status')).textContent = forgeLocalize('agentSettings.unavailable', "These harness settings are not available from the connected agent host.", "当前无法从已连接的 Agent Host 读取这些设置。");
			return;
		}
		const settings = descriptor.settings.filter(setting => this.mode === 'all' || (this.mode === 'models') === (setting.kind === 'models'));
		const content = DOM.append(this.container, DOM.$(this.mode === 'models'
			? '.agent-global-configuration-settings-content.agent-global-configuration-settings-models-content'
			: '.agent-global-configuration-settings-content'));
		DOM.append(content, DOM.$('h1')).textContent = this.mode === 'models'
			? forgeLocalize('agentSettings.models.title', "Models", "模型")
			: forgeLocalize('codex.configuration.title', "Codex", "Codex");
		DOM.append(content, DOM.$('p.agent-global-configuration-settings-intro')).textContent = this.mode === 'models'
			? forgeLocalize('agentSettings.models.description', "Configure the model providers Codex can use, including cloud APIs and local Ollama servers.", "配置 Codex 可使用的模型提供商，包括云端 API 和本地 Ollama。")
			: forgeLocalize('codex.configuration.description', "Set agent permissions, personality, and other Codex defaults stored in config.toml. Project and managed configuration can override these user values.", "设置 Agent 权限、个性和其他写入 config.toml 的 Codex 默认值。项目级和管理配置可以覆盖这些用户设置。");
		for (const group of new Set(settings.map(setting => setting.group))) {
			const section = DOM.append(content, DOM.$(this.mode === 'models'
				? '.agent-global-configuration-settings-section.agent-global-configuration-settings-models-section'
				: '.agent-global-configuration-settings-section'));
			if (this.mode !== 'models') {
				DOM.append(section, DOM.$('h2')).textContent = translateCodexGroup(group);
				if (settings.some(setting => setting.group === group && setting.kind === 'permissions')) {
					DOM.append(section, DOM.$('p.agent-global-configuration-settings-section-description')).textContent = forgeLocalize(
						'codex.configuration.permissions.sectionDescription',
						"This is the default for new chats. Change the Permissions control in the chat input to apply it to the current conversation. Default asks before deleting files; Full Access does not.",
						"这是新对话的默认权限。当前对话请在输入框的「权限」控件中修改。默认会在删除文件前询问；完全访问则不会。",
					);
				}
			}
			const card = DOM.append(section, DOM.$('.agent-global-configuration-settings-card'));
			for (const setting of settings.filter(setting => setting.group === group)) {
				const schema = state.config.schema.properties[setting.key];
				if (schema) { this.renderSetting(card, descriptor, setting.key, setting.kind, setting.saveLabel, schema, state.config.values[setting.key]); }
			}
		}
		if (this.mode !== 'models') {
			this.renderAppearance(content);
		}
		if (this.mode !== 'harness') {
			this.renderConfigurationFile(content, descriptor);
		}
	}

	private renderSetting(parent: HTMLElement, _descriptor: IAgentCustomizationSettingsDescriptor, key: string, kind: 'multiline' | 'models' | 'permissions' | undefined, saveLabel: string | undefined, schema: ConfigPropertySchema, value: unknown): void {
		if (kind === 'models') {
			this.renderModelsSetting(parent, schema, value, key);
			return;
		}
		if (kind === 'permissions') {
			this.renderPermissionsSetting(parent, schema, value, key);
			return;
		}
		const row = DOM.append(parent, DOM.$('.agent-global-configuration-settings-row'));
		const labels = DOM.append(row, DOM.$('.agent-global-configuration-settings-labels'));
		DOM.append(labels, DOM.$('.agent-global-configuration-settings-label')).textContent = translateCodexSchemaTitle(key, schema.title);
		if (schema.description) { DOM.append(labels, DOM.$('.agent-global-configuration-settings-description')).textContent = translateCodexSchemaDescription(key, schema.description); }
		if (kind === 'multiline') {
			row.classList.add('agent-global-configuration-settings-text-row');
			const input = DOM.append(row, DOM.$('textarea.agent-global-configuration-settings-text')) as HTMLTextAreaElement;
			input.ariaLabel = schema.title;
			input.value = typeof value === 'string' ? value : '';
			this.focusTarget ??= () => input.focus();
			const actions = DOM.append(row, DOM.$('.agent-global-configuration-settings-actions'));
			const button = this.renderDisposables.add(new Button(actions, { ...defaultButtonStyles, secondary: true }));
			button.label = saveLabel ?? forgeLocalize('agentSettings.save', "Save", "保存");
			this.renderDisposables.add(button.onDidClick(() => void this.save(key, input.value.trim())));
			return;
		}
		const options = schema.enum?.map((option, index) => ({ text: translateCodexEnumLabel(key, String(option), schema.enumLabels?.[index] ?? String(option)) })) ?? [];
		const selected = Math.max(0, schema.enum?.findIndex(option => option === value) ?? 0);
		const selectContainer = DOM.append(row, DOM.$('.agent-global-configuration-settings-select'));
		const select = this.renderDisposables.add(new SelectBox(options, selected, this.contextViewService, { ...defaultSelectBoxStyles }, { ariaLabel: schema.title }));
		select.render(selectContainer);
		this.focusTarget ??= () => select.focus();
		this.renderDisposables.add(select.onDidSelect(event => void this.save(key, schema.enum?.[event.index])));
	}

	private renderAppearance(parent: HTMLElement): void {
		const section = DOM.append(parent, DOM.$('.agent-global-configuration-settings-section'));
		DOM.append(section, DOM.$('h2')).textContent = forgeLocalize('codex.configuration.appearance', "Appearance", "外观");
		const card = DOM.append(section, DOM.$('.agent-global-configuration-settings-card'));
		const row = DOM.append(card, DOM.$('.agent-global-configuration-settings-row'));
		const labels = DOM.append(row, DOM.$('.agent-global-configuration-settings-labels'));
		DOM.append(labels, DOM.$('.agent-global-configuration-settings-label')).textContent = forgeLocalize('codex.configuration.language', "Language", "语言");
		DOM.append(labels, DOM.$('.agent-global-configuration-settings-description')).textContent = forgeLocalize('codex.configuration.language.description', "Switch Codex settings between English and Chinese. Restart to apply the language pack to the rest of Forge.", "在中英文之间切换 Codex 设置。重启后语言包会应用到 Forge 的其余界面。");
		const options = [
			{ id: 'en' as const, text: 'English' },
			{ id: 'zh-cn' as const, text: '中文' },
		];
		const selected = Math.max(0, options.findIndex(option => option.id === getForgeDisplayLanguage()));
		const selectContainer = DOM.append(row, DOM.$('.agent-global-configuration-settings-select'));
		const select = this.renderDisposables.add(new SelectBox(options.map(option => ({ text: option.text })), selected, this.contextViewService, { ...defaultSelectBoxStyles }, { ariaLabel: forgeLocalize('codex.configuration.language', "Language", "语言") }));
		select.render(selectContainer);
		this.renderDisposables.add(select.onDidSelect(event => void this.applyDisplayLanguage(options[event.index].id)));
	}

	private async applyDisplayLanguage(locale: ForgeDisplayLanguage): Promise<void> {
		setForgeDisplayLanguageOverride(locale);
		this.storageService.store(FORGE_DISPLAY_LANGUAGE_STORAGE_KEY, locale, StorageScope.APPLICATION, StorageTarget.MACHINE);
		this.render();
		try {
			if (locale === 'en') {
				await this.localeService.clearLocalePreference();
			} else {
				await this.localeService.setLocale({
					id: 'zh-cn',
					label: '中文(简体)',
					extensionId: FORGE_LANGUAGE_PACK_EXTENSION_ID,
				});
			}
		} catch (error) {
			this.notificationService.error(error);
		}
	}

	private async save(key: string, value: unknown): Promise<void> {
		try { await this.target?.setValue(key, value); } catch (error) { this.notificationService.error(error); }
	}

	private renderPermissionsSetting(parent: HTMLElement, schema: ConfigPropertySchema, value: unknown, key: string): void {
		parent.classList.add('agent-global-configuration-settings-permissions-card');
		const current = typeof value === 'string' ? value : 'default';
		const list = DOM.append(parent, DOM.$('.agent-global-configuration-settings-permissions'));
		const options = schema.enum ?? ['default', 'auto-review', 'full-access'];
		for (let index = 0; index < options.length; index++) {
			const option = String(options[index]);
			const button = DOM.append(list, DOM.$('button.agent-global-configuration-settings-permission')) as HTMLButtonElement;
			button.type = 'button';
			button.classList.toggle('selected', option === current);
			button.classList.toggle('danger', option === 'full-access');
			button.setAttribute('aria-pressed', option === current ? 'true' : 'false');
			button.setAttribute('aria-label', translateCodexEnumLabel(key, option, schema.enumLabels?.[index] ?? option));
			DOM.append(button, DOM.$('.agent-global-configuration-settings-permission-title')).textContent = translateCodexEnumLabel(key, option, schema.enumLabels?.[index] ?? option);
			const description = translateCodexEnumDescription(key, option, schema.enumDescriptions?.[index] ?? '');
			if (description) {
				DOM.append(button, DOM.$('.agent-global-configuration-settings-permission-description')).textContent = description;
			}
			this.focusTarget ??= () => button.focus();
			this.renderDisposables.add(DOM.addDisposableListener(button, 'click', () => {
				if (option !== current) {
					void this.save(key, option);
				}
			}));
		}
	}

	private renderModelsSetting(parent: HTMLElement, schema: ConfigPropertySchema, value: unknown, key: string): void {
		parent.classList.add('agent-global-configuration-settings-models-card');
		const container = DOM.append(parent, DOM.$('.agent-global-configuration-settings-models'));
		if (this.mode !== 'models') {
			const header = DOM.append(container, DOM.$('.agent-global-configuration-settings-row'));
			const labels = DOM.append(header, DOM.$('.agent-global-configuration-settings-labels'));
			DOM.append(labels, DOM.$('.agent-global-configuration-settings-label')).textContent = translateCodexSchemaTitle(key, schema.title);
			if (schema.description) {
				DOM.append(labels, DOM.$('.agent-global-configuration-settings-description')).textContent = translateCodexSchemaDescription(key, schema.description);
			}
		}
		const editor = this.renderDisposables.add(new AgentModelsSettings(
			container,
			value,
			next => this.save(key, next),
			providerId => this.target?.getModelProviderApiKey?.(providerId),
			(providerId, apiKey) => this.target?.setModelProviderApiKey?.(providerId, apiKey),
			this.contextViewService,
			(catalogId, baseUrl) => this.listLocalProviderModels(catalogId, baseUrl),
		));
		this.focusTarget ??= () => editor.focus();
	}

	private renderConfigurationFile(parent: HTMLElement, descriptor: IAgentCustomizationSettingsDescriptor): void {
		const file = descriptor.configurationFile;
		if (!file) { return; }
		const section = DOM.append(parent, DOM.$('.agent-global-configuration-settings-section'));
		DOM.append(section, DOM.$('h2')).textContent = forgeLocalize('codex.configuration.file.title', "Advanced configuration", "高级配置");
		DOM.append(section, DOM.$('p.agent-global-configuration-settings-section-description')).textContent = forgeLocalize('codex.configuration.file.description', "Open the Codex configuration file to customize additional agent behavior.", "打开 Codex 配置文件以自定义更多代理行为。");
		if (file.documentationUrl && file.documentationLabel) { this.renderDisposables.add(new Link(section, { label: forgeLocalize('codex.configuration.file.docs', "Codex configuration documentation", "Codex 配置文档"), href: file.documentationUrl }, {}, this.hoverService, this.openerService)); }
		const button = this.renderDisposables.add(new Button(section, { ...defaultButtonStyles, secondary: true }));
		button.label = forgeLocalize('codex.configuration.file.open', "Open config.toml", "打开 config.toml");
		this.renderDisposables.add(button.onDidClick(() => this.editorService.openEditor({ resource: this.target?.mapResource(URI.parse(file.resource)) ?? URI.parse(file.resource), options: { pinned: true } })));
	}

	private async listLocalProviderModels(catalogId: string, baseUrl: string): Promise<readonly string[]> {
		const collected = new Set<string>();
		const add = (names?: readonly string[]) => {
			for (const name of names ?? []) {
				const trimmed = name.trim();
				if (trimmed) {
					collected.add(trimmed);
				}
			}
		};
		const native = this.listNativeModels(catalogId, baseUrl);
		const http = Promise.all([
			this.discoverLocalModels(catalogId, baseUrl),
			isOllamaCatalog(catalogId) ? this.discoverLocalModels(catalogId, 'http://127.0.0.1:11434/v1') : Promise.resolve([]),
			isOllamaCatalog(catalogId) ? this.discoverLocalModels(catalogId, 'http://localhost:11434/v1') : Promise.resolve([]),
		]);
		const [fromNative, fromHttp] = await Promise.all([native, http]);
		add(fromNative);
		for (const names of fromHttp) {
			add(names);
		}
		return [...collected];
	}

	private async listNativeModels(catalogId: string, baseUrl: string): Promise<readonly string[]> {
		try {
			return await Promise.race([
				this.target?.discoverLocalModels?.(catalogId, baseUrl) ?? Promise.resolve([]),
				new Promise<readonly string[]>(resolve => setTimeout(() => resolve([]), 4_000)),
			]);
		} catch {
			return [];
		}
	}

	private async discoverLocalModels(catalogId: string, baseUrl: string): Promise<readonly string[]> {
		const catalog = getCodexModelCatalogEntry(catalogId);
		const fallback = catalog.defaultBaseUrl || (isOllamaCatalog(catalogId) ? 'http://127.0.0.1:11434/v1' : 'http://localhost:1234/v1');
		try {
			const url = isOllamaCatalog(catalogId)
				? ollamaTagsUrl(baseUrl || fallback)
				: this.localModelsUrl(catalogId, baseUrl || fallback);
			const context = await this.requestService.request({ type: 'GET', url, timeout: 8_000, callSite: NO_FETCH_TELEMETRY }, CancellationToken.None);
			if (context.res.statusCode && context.res.statusCode >= 400) {
				return [];
			}
			const body = await asJson<{ data?: Array<ILocalModelRecord>; models?: Array<ILocalModelRecord> } | ILocalModelRecord[]>(context);
			if (isOllamaCatalog(catalogId)) {
				return parseOllamaTagsJson(body);
			}
			if (!body) {
				return [];
			}
			const raw: ILocalModelRecord[] = Array.isArray(body)
				? body
				: Array.isArray(body.data)
					? body.data
					: Array.isArray(body.models)
						? body.models
						: [];
			return uniqueModelNames(raw.map(model => model.model || model.id || model.name || ''));
		} catch {
			return [];
		}
	}

	private localModelsUrl(catalogId: string, baseUrl: string): string {
		const catalog = getCodexModelCatalogEntry(catalogId);
		const url = new URL(baseUrl);
		url.search = '';
		url.hash = '';
		if (catalog.kind === 'lmstudio') {
			url.pathname = `${url.pathname.replace(/\/(?:v1|api)\/?$/, '').replace(/\/$/, '')}/api/v0/models`;
		} else if (!/\/models\/?$/.test(url.pathname)) {
			url.pathname = `${url.pathname.replace(/\/$/, '')}/models`;
		}
		return url.toString();
	}
}

interface ILocalModelRecord {
	readonly id?: string;
	readonly name?: string;
	readonly model?: string;
}

function translateCodexGroup(group: string): string {
	switch (group) {
		case 'Agent permissions':
			return forgeLocalize('codex.configuration.permissions.group', "Agent permissions", "Agent 权限");
		case 'Personalization':
			return forgeLocalize('codex.configuration.personalization', "Personalization", "个性化");
		case 'Review policy':
			return forgeLocalize('codex.configuration.review', "Review policy", "审查策略");
		case 'Models':
			return forgeLocalize('codex.configuration.models.group', "Models", "模型");
		default:
			return group;
	}
}

function translateCodexSchemaTitle(key: string, fallback: string): string {
	switch (key) {
		case 'codex.permissionsPreset':
			return forgeLocalize('codex.configuration.permissions', "Permissions", "权限");
		case 'codex.personality':
			return forgeLocalize('codex.configuration.personality', "Personality", "个性");
		case 'codex.autoReviewPolicy':
			return forgeLocalize('codex.configuration.autoReviewPolicy', "Auto-review policy", "自动审查策略");
		case 'codex.models':
			return forgeLocalize('codex.configuration.models', "Models", "模型");
		default:
			return fallback;
	}
}

function translateCodexSchemaDescription(key: string, fallback: string): string {
	switch (key) {
		case 'codex.permissionsPreset':
			return forgeLocalize('codex.configuration.permissions.description', "Choose how much Codex can do on its own. Default asks before deleting files, using the internet, or leaving the workspace. Full Access skips those prompts.", "选择 Codex 可以自行完成多少操作。默认会在删除文件、访问网络或离开工作区前询问。完全访问会跳过这些确认。");
		case 'codex.personality':
			return forgeLocalize('codex.configuration.personality.description', "Controls the default communication style for Codex. Default leaves personality unset in config.toml.", "控制 Codex 的默认沟通风格。选择 Default 时不会在 config.toml 中写入 personality。");
		case 'codex.autoReviewPolicy':
			return forgeLocalize('codex.configuration.autoReviewPolicy.description', "Updates auto_review.policy in config.toml. Leave empty to remove the auto_review section.", "更新 config.toml 中的 auto_review.policy。留空则删除 auto_review 段。");
		case 'codex.models':
			return forgeLocalize('codex.configuration.models.description', "Choose the default model and provider, and add custom model providers such as Ollama or any OpenAI-compatible endpoint.", "选择默认模型和提供商，并添加 Ollama 或其他 OpenAI 兼容接口。");
		default:
			return fallback;
	}
}

function translateCodexEnumLabel(key: string, option: string, fallback: string): string {
	if (key === 'codex.permissionsPreset') {
		switch (option) {
			case 'default':
				return forgeLocalize('codex.configuration.permissions.default', "Default", "默认");
			case 'auto-review':
				return forgeLocalize('codex.configuration.permissions.autoReview', "Auto-Review", "自动审查");
			case 'full-access':
				return forgeLocalize('codex.configuration.permissions.fullAccess', "Full Access", "完全访问");
			default:
				return fallback;
		}
	}
	if (key !== 'codex.personality') {
		return fallback;
	}
	switch (option) {
		case 'default':
			return forgeLocalize('codex.configuration.personality.default', "Default", "默认");
		case 'friendly':
			return forgeLocalize('codex.configuration.personality.friendly', "Friendly", "友好");
		case 'pragmatic':
			return forgeLocalize('codex.configuration.personality.pragmatic', "Pragmatic", "务实");
		default:
			return fallback;
	}
}

function translateCodexEnumDescription(key: string, option: string, fallback: string): string {
	if (key !== 'codex.permissionsPreset') {
		return fallback;
	}
	switch (option) {
		case 'default':
			return forgeLocalize('codex.configuration.permissions.defaultDescription', "Read and edit files in this workspace and run routine local commands. Codex asks before deleting files, using the internet, or touching paths outside the workspace.", "可以读取和编辑当前工作区文件，并运行常规本地命令。删除文件、访问网络或修改工作区外路径前会先询问。");
		case 'auto-review':
			return forgeLocalize('codex.configuration.permissions.autoReviewDescription', "Same workspace access as Default, but approval requests go to the auto-reviewer instead of a prompt.", "和工作区权限与默认相同，但审批请求交给自动审查，而不是弹出确认。");
		case 'full-access':
			return forgeLocalize('codex.configuration.permissions.fullAccessDescription', "Codex can edit or delete files anywhere and use the internet without asking. Use only when you want full machine access.", "可以在任意位置编辑或删除文件，并无需确认地访问网络。仅在需要完全本机访问时使用。");
		default:
			return fallback;
	}
}

