/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/forgeAccount.css';
import { $, append, addDisposableListener } from '../../../../base/browser/dom.js';
import { ActionViewItem, IActionViewItemOptions } from '../../../../base/browser/ui/actionbar/actionViewItems.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { IAction } from '../../../../base/common/actions.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { IDefaultAccount, IQuotaSnapshotData } from '../../../../base/common/defaultAccount.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize, localize2 } from '../../../../nls.js';
import { IActionViewItemService } from '../../../../platform/actions/browser/actionViewItemService.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ChatContextKeys } from '../../chat/common/actions/chatContextKeys.js';
import { GitHubPaths, IDefaultAccountService } from '../../../../platform/defaultAccount/common/defaultAccount.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IQuickInputService, IQuickPickItem, QuickPickInput } from '../../../../platform/quickinput/common/quickInput.js';
import { defaultButtonStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ICodexAccountRateLimitInfo } from '../../../../platform/agentHost/common/codexAccount.js';
import { ICodexAccountService, openCodexAuthUrl } from '../../../services/agentHost/browser/codexAccountService.js';
import { IDeepSeekAccountService, IGrokAccountService, type IForgeVendorAccountService } from '../../../services/agentHost/browser/forgeVendorAccountService.js';
import { IAgentHostService } from '../../../../platform/agentHost/common/agentService.js';
import { type ForgeVendorAccountKind, vendorAccountSecretResource, vendorAccountSecretStorageKey } from '../../../../platform/agentHost/common/forgeVendorAccount.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { AICustomizationManagementCommands } from '../../chat/browser/aiCustomization/aiCustomizationManagement.js';
import { aiCustomizationManagementSectionRegistry, IAICustomizationManagementSectionWidget } from '../../chat/browser/aiCustomization/aiCustomizationManagementSectionRegistry.js';
import { AICustomizationManagementSection } from '../../chat/common/aiCustomizationWorkspaceService.js';
import { SessionType } from '../../chat/common/chatSessionsService.js';

const FORGE_ACCOUNT_ACTION_ID = 'forge.accounts.showRemainingUsage';

interface IForgeAccountQuickPickItem extends IQuickPickItem {
	readonly run?: () => void | Promise<unknown>;
}

export function getCodexRemainingPercent(rateLimit: ICodexAccountRateLimitInfo | undefined): number | undefined {
	return rateLimit ? clampPercent(100 - rateLimit.usedPercent) : undefined;
}

export function getGitHubRemainingPercent(snapshot: IQuotaSnapshotData | undefined): number | undefined {
	return snapshot ? clampPercent(snapshot.percent_remaining) : undefined;
}

function clampPercent(value: number): number {
	return Math.min(100, Math.max(0, value));
}

function formatRemainingPercent(value: number): string {
	return localize('forge.account.percentRemaining', "{0}% remaining", Math.round(value));
}

function formatResetTime(timestamp: number | undefined): string | undefined {
	if (!timestamp) {
		return undefined;
	}
	const milliseconds = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
	return localize('forge.account.resetsAt', "Resets {0}", new Date(milliseconds).toLocaleString());
}

function formatQuota(snapshot: IQuotaSnapshotData | undefined): { readonly value: string; readonly detail?: string; readonly percent?: number } {
	if (!snapshot) {
		return { value: localize('forge.account.usageUnavailable', "Remaining usage unavailable") };
	}
	if (snapshot.unlimited) {
		return { value: localize('forge.account.unlimited', "Unlimited"), detail: formatResetTime(snapshot.quota_reset_at), percent: 100 };
	}
	const percent = getGitHubRemainingPercent(snapshot);
	const exact = snapshot.quota_remaining !== undefined
		? localize('forge.account.exactRemaining', "{0} remaining", snapshot.quota_remaining.toLocaleString())
		: undefined;
	const reset = formatResetTime(snapshot.quota_reset_at);
	return {
		value: percent === undefined ? localize('forge.account.usageUnavailable', "Remaining usage unavailable") : formatRemainingPercent(percent),
		detail: [exact, reset].filter(Boolean).join(' · ') || undefined,
		percent,
	};
}

function formatCodexQuota(rateLimit: ICodexAccountRateLimitInfo | undefined): { readonly value: string; readonly detail?: string; readonly percent?: number } {
	const percent = getCodexRemainingPercent(rateLimit);
	if (percent === undefined) {
		return { value: localize('forge.account.usageUnavailable', "Remaining usage unavailable") };
	}
	const window = rateLimit?.windowDurationMins
		? localize('forge.account.windowDuration', "{0}-hour window", Math.round(rateLimit.windowDurationMins / 60))
		: undefined;
	return {
		value: formatRemainingPercent(percent),
		detail: [window, formatResetTime(rateLimit?.resetsAt)].filter(Boolean).join(' · ') || undefined,
		percent,
	};
}

async function confirmSignOut(dialogService: IDialogService, provider: string): Promise<boolean> {
	const result = await dialogService.confirm({
		message: localize('forge.account.confirmSignOut', "Sign out of {0}?", provider),
		primaryButton: localize('forge.account.signOut', "Sign Out"),
	});
	return result.confirmed;
}

async function hydrateVendorAccountSecrets(secretStorage: ISecretStorageService, agentHost: IAgentHostService): Promise<void> {
	for (const kind of ['grok', 'deepseek'] as const satisfies readonly ForgeVendorAccountKind[]) {
		try {
			const token = await secretStorage.get(vendorAccountSecretStorageKey(kind));
			if (token) {
				await agentHost.authenticate({ resource: vendorAccountSecretResource(kind), token });
			}
		} catch {
			// Agent host may not be ready yet; Account sign-in will retry.
		}
	}
}

async function storeVendorAccountApiKey(
	secretStorage: ISecretStorageService,
	agentHost: IAgentHostService,
	kind: ForgeVendorAccountKind,
	apiKey: string,
): Promise<void> {
	await secretStorage.set(vendorAccountSecretStorageKey(kind), apiKey);
	await agentHost.authenticate({ resource: vendorAccountSecretResource(kind), token: apiKey });
}

async function clearVendorAccountApiKey(
	secretStorage: ISecretStorageService,
	agentHost: IAgentHostService,
	kind: ForgeVendorAccountKind,
): Promise<void> {
	try {
		await secretStorage.delete(vendorAccountSecretStorageKey(kind));
	} catch {
		// Ignore missing keys.
	}
	try {
		await agentHost.authenticate({ resource: vendorAccountSecretResource(kind), token: '' });
	} catch {
		// Ignore host errors during sign-out.
	}
}

function openAccountSettings(commandService: ICommandService): void {
	void commandService.executeCommand(AICustomizationManagementCommands.OpenEditor, {
		section: AICustomizationManagementSection.Account,
		sessionType: SessionType.AgentHostCodex,
	});
}

async function signOutVendorAccount(
	dialogService: IDialogService,
	secretStorage: ISecretStorageService,
	agentHost: IAgentHostService,
	kind: ForgeVendorAccountKind,
	label: string,
	service: IForgeVendorAccountService,
): Promise<void> {
	if (!await confirmSignOut(dialogService, label)) {
		return;
	}
	await clearVendorAccountApiKey(secretStorage, agentHost, kind);
	service.signOut();
}

async function showAccountQuickPick(accessor: ServicesAccessor): Promise<void> {
	const quickInputService = accessor.get(IQuickInputService);
	const defaultAccountService = accessor.get(IDefaultAccountService);
	const codexAccountService = accessor.get(ICodexAccountService);
	const commandService = accessor.get(ICommandService);
	const openerService = accessor.get(IOpenerService);
	const dialogService = accessor.get(IDialogService);
	const grokAccountService = accessor.get(IGrokAccountService);
	const deepSeekAccountService = accessor.get(IDeepSeekAccountService);
	const secretStorageService = accessor.get(ISecretStorageService);
	const agentHostService = accessor.get(IAgentHostService);
	const github = defaultAccountService.currentDefaultAccount;
	const codex = codexAccountService.account;
	const grok = grokAccountService.account;
	const deepseek = deepSeekAccountService.account;
	const githubQuota = github?.entitlementsData?.quota_snapshots;
	const items: QuickPickInput<IForgeAccountQuickPickItem>[] = [
		{ type: 'separator', label: localize('forge.account.github', "GitHub") },
		{
			label: github?.accountName ?? localize('forge.account.notSignedIn', "Not signed in"),
			description: github ? github.authenticationProvider.name : undefined,
			iconClasses: ThemeIcon.asClassNameArray(Codicon.github),
			pickable: false,
		},
	];
	if (github) {
		items.push(
			quotaQuickPickItem(localize('forge.account.premiumRequests', "Premium requests"), githubQuota?.premium_interactions),
			quotaQuickPickItem(localize('forge.account.chatMessages', "Chat messages"), githubQuota?.chat),
			quotaQuickPickItem(localize('forge.account.codeCompletions', "Code completions"), githubQuota?.completions),
		);
	}
	items.push(
		{ type: 'separator', label: localize('forge.account.codex', "Codex") },
		{
			label: codex.email ?? (codex.status === 'signedIn' ? localize('forge.account.signedIn', "Signed in") : localize('forge.account.notSignedIn', "Not signed in")),
			description: codex.planType,
			iconClasses: ThemeIcon.asClassNameArray(Codicon.openai),
			pickable: false,
		},
	);
	if (codex.status === 'signedIn') {
		const quota = formatCodexQuota(codex.rateLimit);
		items.push({ label: quota.value, description: quota.detail, iconClasses: ThemeIcon.asClassNameArray(Codicon.dashboard), pickable: false });
	}
	items.push(
		{ type: 'separator', label: localize('forge.account.grok', "Grok Build") },
		{
			label: grok.email ?? (grok.status === 'signedIn' ? localize('forge.account.signedIn', "Signed in") : localize('forge.account.notSignedIn', "Not signed in")),
			description: grok.planType,
			iconClasses: ThemeIcon.asClassNameArray(Codicon.rocket),
			pickable: false,
		},
		{ type: 'separator', label: localize('forge.account.deepseek', "DeepSeek Harness") },
		{
			label: deepseek.email ?? (deepseek.status === 'signedIn' ? localize('forge.account.signedIn', "Signed in") : localize('forge.account.notSignedIn', "Not signed in")),
			iconClasses: ThemeIcon.asClassNameArray(Codicon.beaker),
			pickable: false,
		},
	);
	items.push(
		{ type: 'separator' },
		{
			label: localize('forge.account.manage', "Manage Account"),
			iconClasses: ThemeIcon.asClassNameArray(Codicon.settingsGear),
			run: () => commandService.executeCommand(AICustomizationManagementCommands.OpenEditor, {
				section: AICustomizationManagementSection.Account,
				sessionType: SessionType.AgentHostCodex,
			}),
		},
		github ? {
			label: localize('forge.account.refreshGitHubUsage', "Refresh GitHub Usage"),
			iconClasses: ThemeIcon.asClassNameArray(Codicon.refresh),
			run: () => defaultAccountService.refresh({ forceRefresh: true }),
		} : {
			label: localize('forge.account.signInGitHub', "Sign in to GitHub"),
			iconClasses: ThemeIcon.asClassNameArray(Codicon.signIn),
			run: () => defaultAccountService.signIn(),
		},
		codex.status === 'signedIn' ? {
			label: localize('forge.account.signOutCodex', "Sign out of Codex"),
			iconClasses: ThemeIcon.asClassNameArray(Codicon.signOut),
			run: async () => {
				if (await confirmSignOut(dialogService, 'Codex')) {
					codexAccountService.signOut();
				}
			},
		} : {
			label: localize('forge.account.signInCodex', "Sign in to Codex"),
			iconClasses: ThemeIcon.asClassNameArray(Codicon.signIn),
			run: () => codexAccountService.signIn(),
		},
		grok.status === 'signedIn' ? {
			label: localize('forge.account.signOutGrok', "Sign out of Grok Build"),
			iconClasses: ThemeIcon.asClassNameArray(Codicon.signOut),
			run: () => signOutVendorAccount(dialogService, secretStorageService, agentHostService, 'grok', 'Grok Build', grokAccountService),
		} : {
			label: localize('forge.account.signInGrok', "登录 Grok Build"),
			iconClasses: ThemeIcon.asClassNameArray(Codicon.signIn),
			run: () => openAccountSettings(commandService),
		},
		deepseek.status === 'signedIn' ? {
			label: localize('forge.account.signOutDeepSeek', "Sign out of DeepSeek Harness"),
			iconClasses: ThemeIcon.asClassNameArray(Codicon.signOut),
			run: () => signOutVendorAccount(dialogService, secretStorageService, agentHostService, 'deepseek', 'DeepSeek Harness', deepSeekAccountService),
		} : {
			label: localize('forge.account.signInDeepSeek', "登录 DeepSeek Harness"),
			iconClasses: ThemeIcon.asClassNameArray(Codicon.signIn),
			run: () => openAccountSettings(commandService),
		},
		github ? {
			label: localize('forge.account.openGitHubUsage', "Open GitHub Usage Settings"),
			iconClasses: ThemeIcon.asClassNameArray(Codicon.linkExternal),
			run: () => openerService.open(defaultAccountService.resolveGitHubUrl(GitHubPaths.copilotSettings), { openExternal: true }),
		} : { label: '', pickable: false },
	);
	const selected = await quickInputService.pick(items.filter(item => item.type === 'separator' || item.label), {
		title: localize('forge.account.remainingUsage', "Accounts and Remaining Usage"),
		placeHolder: localize('forge.account.remainingUsagePlaceholder', "All quota values below are remaining, not used"),
	});
	await selected?.run?.();
}

function quotaQuickPickItem(label: string, snapshot: IQuotaSnapshotData | undefined): IForgeAccountQuickPickItem {
	const quota = formatQuota(snapshot);
	return {
		label,
		description: quota.value,
		detail: quota.detail,
		iconClasses: ThemeIcon.asClassNameArray(Codicon.dashboard),
		pickable: false,
	};
}

registerAction2(class ForgeAccountAction extends Action2 {
	constructor() {
		super({
			id: FORGE_ACCOUNT_ACTION_ID,
			title: localize2('forge.account.toolbar', "Accounts and Remaining Usage"),
			f1: false,
			menu: {
				id: MenuId.ChatViewSessionTitleToolbar,
				group: 'navigation',
				order: 0,
				when: ChatContextKeys.chatSessionType.isEqualTo(SessionType.AgentHostCodex),
			},
		});
	}

	override run(accessor: ServicesAccessor): Promise<void> {
		return showAccountQuickPick(accessor);
	}
});

class ForgeAccountActionViewItem extends ActionViewItem {
	constructor(action: IAction, options: IActionViewItemOptions) {
		super(undefined, action, { ...options, icon: false, label: true });
	}

	override render(container: HTMLElement): void {
		super.render(container);
		this.element?.classList.add('forge-account-toolbar-item');
		if (!this.label) {
			return;
		}
		this.label.textContent = '';
		this.label.classList.add('forge-account-avatars');
		const github = append(this.label, $('span.forge-account-avatar.github'));
		github.classList.add(...ThemeIcon.asClassNameArray(Codicon.github));
		const codex = append(this.label, $('span.forge-account-avatar.codex'));
		codex.classList.add(...ThemeIcon.asClassNameArray(Codicon.openai));
		const grok = append(this.label, $('span.forge-account-avatar.grok'));
		grok.classList.add(...ThemeIcon.asClassNameArray(Codicon.rocket));
		const deepseek = append(this.label, $('span.forge-account-avatar.deepseek'));
		deepseek.classList.add(...ThemeIcon.asClassNameArray(Codicon.beaker));
	}
}

class ForgeAccountToolbarContribution extends Disposable {
	static readonly ID = 'workbench.contrib.forgeAccountToolbar';

	constructor(
		@IActionViewItemService actionViewItemService: IActionViewItemService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IDefaultAccountService defaultAccountService: IDefaultAccountService,
		@ICodexAccountService codexAccountService: ICodexAccountService,
		@IGrokAccountService grokAccountService: IGrokAccountService,
		@IDeepSeekAccountService deepSeekAccountService: IDeepSeekAccountService,
		@ISecretStorageService secretStorageService: ISecretStorageService,
		@IAgentHostService agentHostService: IAgentHostService,
	) {
		super();
		void hydrateVendorAccountSecrets(secretStorageService, agentHostService);
		this._register(actionViewItemService.register(
			MenuId.ChatViewSessionTitleToolbar,
			FORGE_ACCOUNT_ACTION_ID,
			(action, options) => instantiationService.createInstance(ForgeAccountActionViewItem, action, options),
			Event.any(
				defaultAccountService.onDidChangeDefaultAccount,
				defaultAccountService.onDidChangeCopilotTokenInfo,
				codexAccountService.onDidChangeAccount,
				grokAccountService.onDidChangeAccount,
				deepSeekAccountService.onDidChangeAccount,
			),
		));
	}
}

class ForgeAccountWidget extends Disposable implements IAICustomizationManagementSectionWidget {
	private readonly _renderDisposables = this._register(new DisposableStore());
	private _showGrokApiForm = false;
	private _showDeepSeekApiForm = false;
	private _grokApiKeyDraft = '';
	private _deepSeekApiKeyDraft = '';

	constructor(
		private readonly _container: HTMLElement,
		@IDefaultAccountService private readonly _defaultAccountService: IDefaultAccountService,
		@ICodexAccountService private readonly _codexAccountService: ICodexAccountService,
		@IGrokAccountService private readonly _grokAccountService: IGrokAccountService,
		@IDeepSeekAccountService private readonly _deepSeekAccountService: IDeepSeekAccountService,
		@IOpenerService private readonly _openerService: IOpenerService,
		@INativeHostService private readonly _nativeHostService: INativeHostService,
		@IDialogService private readonly _dialogService: IDialogService,
		@ISecretStorageService private readonly _secretStorageService: ISecretStorageService,
		@IAgentHostService private readonly _agentHostService: IAgentHostService,
		@INotificationService private readonly _notificationService: INotificationService,
	) {
		super();
		this._register(this._defaultAccountService.onDidChangeDefaultAccount(() => this._render()));
		this._register(this._defaultAccountService.onDidChangeCopilotTokenInfo(() => this._render()));
		this._register(this._codexAccountService.onDidChangeAccount(() => this._render()));
		this._register(this._grokAccountService.onDidChangeAccount(() => this._render()));
		this._register(this._deepSeekAccountService.onDidChangeAccount(() => this._render()));
		void hydrateVendorAccountSecrets(this._secretStorageService, this._agentHostService);
		this._render();
	}

	private _render(): void {
		this._renderDisposables.clear();
		this._container.replaceChildren();
		const page = append(this._container, $('.forge-account-page'));
		const header = append(page, $('header.forge-account-header'));
		append(header, $('h1')).textContent = localize('forge.account.title', "Account");
		append(header, $('p')).textContent = localize('forge.account.description', "管理 GitHub、Codex、Grok Build 和 DeepSeek Harness 登录，并查看剩余用量。");
		const account = this._defaultAccountService.currentDefaultAccount;
		this._renderGitHubCard(page, account);
		this._renderCodexCard(page);
		this._renderGrokCard(page);
		this._renderDeepSeekCard(page);
		const note = append(page, $('p.forge-account-note'));
		note.classList.add(...ThemeIcon.asClassNameArray(Codicon.info));
		note.append(document.createTextNode(localize('forge.account.remainingNote', " 用量数字均为剩余额度，不是已用量。GitHub 和 Codex 会自动刷新；Grok 与 DeepSeek 登录后会同步官方模型。")));
	}

	private _renderGitHubCard(parent: HTMLElement, account: IDefaultAccount | null): void {
		const card = this._createCard(parent, Codicon.github, localize('forge.account.github', "GitHub"), account?.accountName ?? localize('forge.account.notSignedIn', "Not signed in"));
		if (account) {
			append(card.body, $('div.forge-account-plan')).textContent = account.entitlementsData?.copilot_plan ?? account.authenticationProvider.name;
			const quotas = account.entitlementsData?.quota_snapshots;
			this._renderQuota(card.body, localize('forge.account.premiumRequests', "Premium requests"), formatQuota(quotas?.premium_interactions));
			this._renderQuota(card.body, localize('forge.account.chatMessages', "Chat messages"), formatQuota(quotas?.chat));
			this._renderQuota(card.body, localize('forge.account.codeCompletions', "Code completions"), formatQuota(quotas?.completions));
			this._addButton(card.actions, localize('forge.account.refreshUsage', "Refresh Usage"), () => this._defaultAccountService.refresh({ forceRefresh: true }));
			this._addButton(card.actions, localize('forge.account.openUsageSettings', "Usage Settings"), () => this._openerService.open(this._defaultAccountService.resolveGitHubUrl(GitHubPaths.copilotSettings), { openExternal: true }), true);
			this._addButton(card.actions, localize('forge.account.signOut', "Sign Out"), async () => {
				if (await confirmSignOut(this._dialogService, 'GitHub')) {
					await this._defaultAccountService.signOut();
				}
			}, true);
		} else {
			append(card.body, $('p.forge-account-empty')).textContent = localize('forge.account.githubSignInDescription', "Sign in to load GitHub remaining allowances if you use them.");
			this._addButton(card.actions, localize('forge.account.signInGitHub', "Sign in to GitHub"), () => this._defaultAccountService.signIn());
		}
	}

	private _renderCodexCard(parent: HTMLElement): void {
		const account = this._codexAccountService.account;
		const signedIn = account.status === 'signedIn';
		const card = this._createCard(parent, Codicon.openai, localize('forge.account.codex', "Codex"), account.email ?? (signedIn ? localize('forge.account.signedIn', "Signed in") : localize('forge.account.notSignedIn', "Not signed in")));
		if (signedIn) {
			if (account.planType) {
				append(card.body, $('div.forge-account-plan')).textContent = account.planType;
			}
			this._renderQuota(card.body, localize('forge.account.codexAllowance', "Codex allowance"), formatCodexQuota(account.rateLimit));
			this._addButton(card.actions, localize('forge.account.signOut', "Sign Out"), async () => {
				if (await confirmSignOut(this._dialogService, 'Codex')) {
					this._codexAccountService.signOut();
				}
			});
		} else {
			const description = account.status === 'downloading'
				? localize('forge.account.codexPreparing', "Preparing the Codex runtime…")
				: account.status === 'error' && account.error
					? account.error
					: localize('forge.account.codexSignInDescription', "Sign in with your ChatGPT account to use Codex and load its current allowance.");
			append(card.body, $('p.forge-account-empty')).textContent = description;
			const button = this._addButton(card.actions, localize('forge.account.signInCodex', "Sign in to Codex"), () => this._codexAccountService.signIn());
			button.enabled = account.status !== 'downloading' && account.status !== 'unavailable';
		}
	}

	private _renderGrokCard(parent: HTMLElement): void {
		const account = this._grokAccountService.account;
		const signedIn = account.status === 'signedIn';
		const card = this._createCard(parent, Codicon.rocket, localize('forge.account.grok', "Grok Build"), account.email ?? (signedIn ? localize('forge.account.signedIn', "Signed in") : localize('forge.account.notSignedIn', "Not signed in")));
		if (signedIn) {
			if (account.planType) {
				append(card.body, $('div.forge-account-plan')).textContent = account.planType;
			}
			append(card.body, $('p.forge-account-empty')).textContent = localize('forge.account.vendorSignedInNote', "已登录。官方模型卡会自动同步；额度用尽时可在该卡中填写网址和 API 密钥作为备用。");
			this._addButton(card.actions, localize('forge.account.signOut', "Sign Out"), () => signOutVendorAccount(this._dialogService, this._secretStorageService, this._agentHostService, 'grok', 'Grok Build', this._grokAccountService));
			return;
		}
		if (account.status === 'signingIn') {
			append(card.body, $('p.forge-account-empty')).textContent = account.authUrl
				? localize('forge.account.grokAuthorizeInBrowser', "请在浏览器中确认授权。如果没有自动打开，请点击「打开登录页」。")
				: localize('forge.account.grokConnecting', "正在连接 xAI 登录服务…");
			if (account.userCode) {
				append(card.body, $('div.forge-account-code')).textContent = localize('forge.account.grokUserCode', "确认码：{0}", account.userCode);
			}
			if (account.authUrl) {
				const urlInput = append(card.body, $('input.forge-account-auth-url')) as HTMLInputElement;
				urlInput.type = 'text';
				urlInput.readOnly = true;
				urlInput.value = account.authUrl;
				urlInput.ariaLabel = localize('forge.account.openLoginPage', "打开登录页");
				this._renderDisposables.add(addDisposableListener(urlInput, 'focus', () => urlInput.select()));
				this._addButton(card.actions, localize('forge.account.openLoginPage', "打开登录页"), () => this._openExternalUrl(account.authUrl!));
			}
			this._addButton(card.actions, localize('forge.account.cancelSignIn', "取消"), () => this._grokAccountService.signOut(), true);
			return;
		}
		append(card.body, $('p.forge-account-empty')).textContent = account.status === 'error' && account.error
			? account.error
			: localize('forge.account.grokSignInDescription', "使用 xAI 账号或 API 密钥登录。登录后会自动添加官方模型卡，退出后该卡会消失。");
		this._addButton(card.actions, localize('forge.account.grokLoginAccount', "使用 xAI 账号登录"), () => {
			this._showGrokApiForm = false;
			this._grokAccountService.signIn();
		});
		this._addButton(card.actions, localize('forge.account.grokLoginApi', "使用 API 密钥登录"), () => {
			this._showGrokApiForm = true;
			this._render();
		}, true);
		if (this._showGrokApiForm) {
			this._renderApiKeyForm(card.body, this._grokApiKeyDraft, value => { this._grokApiKeyDraft = value; }, () => this._submitVendorApiKey('grok', this._grokApiKeyDraft, this._grokAccountService));
		}
	}

	private _renderDeepSeekCard(parent: HTMLElement): void {
		const account = this._deepSeekAccountService.account;
		const signedIn = account.status === 'signedIn';
		const card = this._createCard(parent, Codicon.beaker, localize('forge.account.deepseek', "DeepSeek Harness"), account.email ?? (signedIn ? localize('forge.account.signedIn', "Signed in") : localize('forge.account.notSignedIn', "Not signed in")));
		if (signedIn) {
			append(card.body, $('p.forge-account-empty')).textContent = localize('forge.account.vendorSignedInNote', "已登录。官方模型卡会自动同步；额度用尽时可在该卡中填写网址和 API 密钥作为备用。");
			this._addButton(card.actions, localize('forge.account.signOut', "Sign Out"), () => signOutVendorAccount(this._dialogService, this._secretStorageService, this._agentHostService, 'deepseek', 'DeepSeek Harness', this._deepSeekAccountService));
			return;
		}
		append(card.body, $('p.forge-account-empty')).textContent = account.status === 'error' && account.error
			? account.error
			: localize('forge.account.deepSeekSignInDescription', "使用 DeepSeek API 密钥登录。登录后会自动添加官方模型卡，退出后该卡会消失。");
		if (!this._showDeepSeekApiForm) {
			this._addButton(card.actions, localize('forge.account.signInDeepSeek', "登录 DeepSeek Harness"), () => {
				this._showDeepSeekApiForm = true;
				this._render();
			});
			return;
		}
		this._renderApiKeyForm(card.body, this._deepSeekApiKeyDraft, value => { this._deepSeekApiKeyDraft = value; }, () => this._submitVendorApiKey('deepseek', this._deepSeekApiKeyDraft, this._deepSeekAccountService));
	}

	private _renderApiKeyForm(parent: HTMLElement, value: string, onChange: (value: string) => void, onSubmit: () => Promise<void>): void {
		const form = append(parent, $('div.forge-account-api-form'));
		const input = append(form, $('input.forge-account-api-input')) as HTMLInputElement;
		input.type = 'password';
		input.value = value;
		input.placeholder = localize('forge.account.apiKeyPlaceholder', "API key");
		input.ariaLabel = localize('forge.account.apiKeyPlaceholder', "API key");
		this._renderDisposables.add(addDisposableListener(input, 'input', () => onChange(input.value)));
		this._renderDisposables.add(addDisposableListener(input, 'keydown', event => {
			if (event.key === 'Enter') {
				void onSubmit();
			}
		}));
		this._addButton(form, localize('forge.account.confirmApiKey', "确认登录"), () => onSubmit());
		queueMicrotask(() => input.focus());
	}

	private async _submitVendorApiKey(kind: ForgeVendorAccountKind, apiKey: string, service: IForgeVendorAccountService): Promise<void> {
		const trimmed = apiKey.trim();
		if (!trimmed) {
			this._notificationService.error(localize('forge.account.apiKeyRequired', "请先填写 API 密钥。"));
			return;
		}
		try {
			await storeVendorAccountApiKey(this._secretStorageService, this._agentHostService, kind, trimmed);
			if (kind === 'grok') {
				this._showGrokApiForm = false;
				this._grokApiKeyDraft = '';
			} else {
				this._showDeepSeekApiForm = false;
				this._deepSeekApiKeyDraft = '';
			}
			service.signIn();
		} catch (error) {
			this._notificationService.error(error instanceof Error ? error.message : String(error));
		}
	}

	private _createCard(parent: HTMLElement, icon: ThemeIcon, title: string, identity: string): { readonly body: HTMLElement; readonly actions: HTMLElement } {
		const card = append(parent, $('section.forge-account-card'));
		const cardHeader = append(card, $('div.forge-account-card-header'));
		const avatar = append(cardHeader, $('div.forge-account-card-avatar'));
		avatar.classList.add(...ThemeIcon.asClassNameArray(icon));
		const heading = append(cardHeader, $('div.forge-account-card-heading'));
		append(heading, $('h2')).textContent = title;
		append(heading, $('span')).textContent = identity;
		const body = append(card, $('div.forge-account-card-body'));
		const actions = append(card, $('div.forge-account-card-actions'));
		return { body, actions };
	}

	private _renderQuota(parent: HTMLElement, label: string, quota: { readonly value: string; readonly detail?: string; readonly percent?: number }): void {
		const row = append(parent, $('div.forge-account-quota'));
		const heading = append(row, $('div.forge-account-quota-heading'));
		append(heading, $('span')).textContent = label;
		append(heading, $('strong')).textContent = quota.value;
		if (quota.percent !== undefined) {
			const track = append(row, $('div.forge-account-quota-track'));
			const remaining = append(track, $('div.forge-account-quota-remaining'));
			remaining.style.width = `${clampPercent(quota.percent)}%`;
		}
		if (quota.detail) {
			append(row, $('div.forge-account-quota-detail')).textContent = quota.detail;
		}
	}

	private async _openExternalUrl(url: string): Promise<void> {
		try {
			if (await this._nativeHostService.openExternal(url)) {
				return;
			}
		} catch {
			// Fall through to the opener service.
		}
		await openCodexAuthUrl(this._openerService, url);
	}

	private _addButton(parent: HTMLElement, label: string, run: () => void | Promise<unknown>, secondary = false): Button {
		const button = this._renderDisposables.add(new Button(parent, { ...defaultButtonStyles, secondary }));
		button.label = label;
		this._renderDisposables.add(button.onDidClick(() => void run()));
		return button;
	}
}

aiCustomizationManagementSectionRegistry.register({
	id: AICustomizationManagementSection.Account,
	label: localize('forge.account.navigationLabel', "Account"),
	icon: Codicon.account,
	description: localize('forge.account.navigationDescription', "管理 GitHub、Codex、Grok Build 和 DeepSeek Harness 的登录与剩余用量。"),
	supportsHarness: harnessId => harnessId === SessionType.AgentHostCodex,
	create: (instantiationService, container) => instantiationService.createInstance(ForgeAccountWidget, container),
});

registerWorkbenchContribution2(ForgeAccountToolbarContribution.ID, ForgeAccountToolbarContribution, WorkbenchPhase.BlockRestore);
