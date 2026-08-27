/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from '../../../../base/common/path.js';
import { isWindows } from '../../../../base/common/platform.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../log/common/log.js';
import { INativeEnvironmentService } from '../../../environment/common/environment.js';
import { CODEX_MODELS_ROOT_CONFIG_KEY, normalizeCodexModelsConfig } from '../../common/codexModelsConfig.js';
import {
	DEEPSEEK_ACCOUNT_SECRET_RESOURCE,
	GROK_ACCOUNT_SECRET_RESOURCE,
	type ForgeVendorAccountKind,
	type IForgeVendorAccountInfo,
	vendorAccountMetaKey,
	vendorAccountSignInRequestKey,
	vendorAccountSignOutRequestKey,
} from '../../common/forgeVendorAccount.js';
import {
	officialCardsEqual,
	officialModelCardSpec,
	removeOfficialModelProvider,
	upsertOfficialModelProvider,
} from '../../common/officialModelCards.js';
import { IAgentHostProxyResolver } from '../agentHostProxyResolver.js';
import { grokAuthPath, grokLoginUrl, grokNetworkErrorMessage, pollGrokDeviceToken, requestGrokDeviceCode, resolveGrokFetch, writeGrokOidcAuth } from './grokDeviceLogin.js';
import { IAgentConfigurationService } from '../agentConfigurationService.js';
import { getVendorAccountSecret, setVendorAccountSecret } from './vendorAccountSecrets.js';
import { resolveGrokCommand } from './workerAdapters.js';

export class ForgeVendorAccountHost extends Disposable {
	private _lastGrokSignIn?: string;
	private _lastGrokSignOut?: string;
	private _lastDeepSeekSignIn?: string;
	private _lastDeepSeekSignOut?: string;
	private _grokLoginAbort?: AbortController;
	private _grokLoginEpoch = 0;

	constructor(
		@IAgentConfigurationService private readonly _configuration: IAgentConfigurationService,
		@ILogService private readonly _logService: ILogService,
		@INativeEnvironmentService private readonly _environment: INativeEnvironmentService,
		@IAgentHostProxyResolver private readonly _proxyResolver: IAgentHostProxyResolver,
	) {
		super();
		this._register(this._configuration.onDidRootConfigChange(() => this._onRootConfig()));
		void this._restoreExistingSessions();
	}

	static consumeAuthenticate(resource: string, token: string): boolean {
		if (resource === GROK_ACCOUNT_SECRET_RESOURCE) {
			setVendorAccountSecret('grok', token || undefined);
			return true;
		}
		if (resource === DEEPSEEK_ACCOUNT_SECRET_RESOURCE) {
			setVendorAccountSecret('deepseek', token || undefined);
			return true;
		}
		return false;
	}

	private _onRootConfig(): void {
		const values = this._configuration.getRootConfigValues?.() ?? {};
		this._handleRequest('grok', values[vendorAccountSignInRequestKey('grok')], values[vendorAccountSignOutRequestKey('grok')]);
		this._handleRequest('deepseek', values[vendorAccountSignInRequestKey('deepseek')], values[vendorAccountSignOutRequestKey('deepseek')]);
	}

	private _handleRequest(kind: ForgeVendorAccountKind, signIn: unknown, signOut: unknown): void {
		if (typeof signIn === 'string' && signIn !== this._signInCursor(kind)) {
			this._setSignInCursor(kind, signIn);
			this._configuration.updateRootConfig({ [vendorAccountSignInRequestKey(kind)]: undefined });
			void this._signIn(kind, signIn);
		}
		if (typeof signOut === 'string' && signOut !== this._signOutCursor(kind)) {
			this._setSignOutCursor(kind, signOut);
			this._configuration.updateRootConfig({ [vendorAccountSignOutRequestKey(kind)]: undefined });
			void this._signOut(kind);
		}
	}

	private _signInCursor(kind: ForgeVendorAccountKind): string | undefined {
		return kind === 'grok' ? this._lastGrokSignIn : this._lastDeepSeekSignIn;
	}

	private _signOutCursor(kind: ForgeVendorAccountKind): string | undefined {
		return kind === 'grok' ? this._lastGrokSignOut : this._lastDeepSeekSignOut;
	}

	private _setSignInCursor(kind: ForgeVendorAccountKind, value: string): void {
		if (kind === 'grok') {
			this._lastGrokSignIn = value;
		} else {
			this._lastDeepSeekSignIn = value;
		}
	}

	private _setSignOutCursor(kind: ForgeVendorAccountKind, value: string): void {
		if (kind === 'grok') {
			this._lastGrokSignOut = value;
		} else {
			this._lastDeepSeekSignOut = value;
		}
	}

	private async _restoreExistingSessions(): Promise<void> {
		const grok = readGrokAuth(this._userHome());
		if (grok || getVendorAccountSecret('grok')) {
			await this._completeLogin('grok', grok?.email ?? 'Grok', grok?.planType);
		}
		const deepseekKey = getVendorAccountSecret('deepseek') || readDeepSeekCredentials(this._userHome());
		if (deepseekKey) {
			if (!getVendorAccountSecret('deepseek')) {
				setVendorAccountSecret('deepseek', deepseekKey);
			}
			await this._completeLogin('deepseek', 'DeepSeek');
		}
	}

	private async _signIn(kind: ForgeVendorAccountKind, request: string): Promise<void> {
		const epoch = kind === 'grok' ? ++this._grokLoginEpoch : this._grokLoginEpoch;
		this._publish(kind, { status: 'signingIn' });
		try {
			if (kind === 'deepseek') {
				const apiKey = getVendorAccountSecret('deepseek');
				if (!apiKey) {
					this._publish(kind, { status: 'error', error: '请先填写 DeepSeek API 密钥。' });
					return;
				}
				writeDeepSeekCredentials(this._userHome(), apiKey);
				await this._completeLogin('deepseek', 'DeepSeek');
				return;
			}
			const apiKey = getVendorAccountSecret('grok');
			if (apiKey) {
				await this._completeLogin('grok', 'Grok');
				return;
			}
			const existing = readGrokAuth(this._userHome());
			if (existing) {
				await this._completeLogin('grok', existing.email, existing.planType);
				return;
			}
			await this._runGrokBrowserLogin(request, epoch);
		} catch (error) {
			if (kind === 'grok' && epoch !== this._grokLoginEpoch) {
				return;
			}
			const message = grokNetworkErrorMessage(error);
			this._logService.warn(`[ForgeAccount] ${kind} sign-in failed: ${message}`);
			this._publish(kind, { status: 'error', error: message });
		}
	}

	private async _signOut(kind: ForgeVendorAccountKind): Promise<void> {
		if (kind === 'grok') {
			this._grokLoginEpoch++;
			this._grokLoginAbort?.abort();
			this._grokLoginAbort = undefined;
			setVendorAccountSecret('grok', undefined);
			void spawnDetached(resolveGrokLoginCommand(this._environment.appRoot)?.command, ['logout']);
		} else {
			setVendorAccountSecret('deepseek', undefined);
			writeDeepSeekCredentials(this._userHome(), undefined);
		}
		this._setOfficialCard(kind, false, []);
		this._publish(kind, { status: 'signedOut' });
	}

	private async _runGrokBrowserLogin(request: string, epoch: number): Promise<void> {
		this._grokLoginAbort?.abort();
		this._grokLoginAbort = new AbortController();
		const abort = this._grokLoginAbort.signal;
		const fetchImpl = await resolveGrokFetch((input, init) => this._proxyResolver.fetch(input, init ?? {}));
		const device = await requestGrokDeviceCode(fetchImpl, abort);
		if (epoch !== this._grokLoginEpoch) {
			return;
		}
		this._publish('grok', {
			status: 'signingIn',
			authUrl: grokLoginUrl(device),
			authUrlNonce: request,
			userCode: device.userCode,
		});
		const tokens = await pollGrokDeviceToken(fetchImpl, device, abort);
		if (epoch !== this._grokLoginEpoch) {
			return;
		}
		const saved = writeGrokOidcAuth(this._userHome(), tokens);
		await this._completeLogin('grok', saved.email ?? 'Grok');
	}

	private async _completeLogin(kind: ForgeVendorAccountKind, email?: string, planType?: string): Promise<void> {
		const models = await fetchOfficialVendorModels(kind, this._apiKeyFor(kind));
		this._setOfficialCard(kind, true, models);
		this._publish(kind, {
			status: 'signedIn',
			email,
			planType,
		});
	}

	private _apiKeyFor(kind: ForgeVendorAccountKind): string | undefined {
		if (kind === 'grok') {
			return getVendorAccountSecret('grok') || readGrokAuth(this._userHome())?.key;
		}
		return getVendorAccountSecret('deepseek') || readDeepSeekCredentials(this._userHome());
	}

	private _setOfficialCard(kind: ForgeVendorAccountKind, signedIn: boolean, models: readonly string[]): void {
		const current = normalizeCodexModelsConfig(this._configuration.getRootConfigValues?.()?.[CODEX_MODELS_ROOT_CONFIG_KEY]);
		const next = signedIn
			? upsertOfficialModelProvider(current, kind, models)
			: removeOfficialModelProvider(current, kind);
		if (officialCardsEqual(current, next)) {
			return;
		}
		this._configuration.updateRootConfig({ [CODEX_MODELS_ROOT_CONFIG_KEY]: next });
	}

	private _publish(kind: ForgeVendorAccountKind, account: IForgeVendorAccountInfo): void {
		this._configuration.publishRootTransientValues?.({ [vendorAccountMetaKey(kind)]: account });
	}

	private _userHome(): string {
		return this._environment.userHome?.fsPath || homedir();
	}
}

export async function fetchOfficialVendorModels(kind: ForgeVendorAccountKind, apiKey: string | undefined): Promise<readonly string[]> {
	const spec = officialModelCardSpec(kind);
	if (!apiKey) {
		return spec.fallbackModels;
	}
	const base = spec.defaultBaseUrl.replace(/\/$/, '');
	const urls = kind === 'grok'
		? [`${base}/language-models`, `${base}/models`]
		: [`${base}/models`];
	for (const url of urls) {
		try {
			const names = parseModelCatalog(await fetchJson(url, apiKey));
			if (names.length > 0) {
				return names;
			}
		} catch {
			continue;
		}
	}
	return spec.fallbackModels;
}

function parseModelCatalog(body: unknown): readonly string[] {
	const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
	const raw = Array.isArray(record.data) ? record.data
		: Array.isArray(record.models) ? record.models
			: Array.isArray(body) ? body
				: [];
	const names: string[] = [];
	const seen = new Set<string>();
	for (const item of raw) {
		const id = typeof item === 'string' ? item
			: item && typeof item === 'object' ? String((item as Record<string, unknown>).id ?? (item as Record<string, unknown>).name ?? '')
				: '';
		const name = id.trim();
		if (name === '' || seen.has(name)) {
			continue;
		}
		seen.add(name);
		names.push(name);
	}
	return names;
}

async function fetchJson(url: string, apiKey: string): Promise<unknown> {
	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${apiKey}`,
			Accept: 'application/json',
		},
	});
	if (!response.ok) {
		throw new Error(`${url} ${response.status}`);
	}
	return response.json();
}

function readGrokAuth(userHome: string): { email?: string; planType?: string; key?: string } | undefined {
	try {
		const raw = JSON.parse(readFileSync(grokAuthPath(userHome), 'utf8')) as Record<string, unknown>;
		for (const value of Object.values(raw)) {
			if (!value || typeof value !== 'object') {
				continue;
			}
			const entry = value as Record<string, unknown>;
			if (typeof entry.key !== 'string' || entry.key.trim() === '') {
				continue;
			}
			return {
				key: entry.key,
				email: typeof entry.email === 'string' ? entry.email : undefined,
				planType: typeof entry.team_name === 'string' ? entry.team_name : typeof entry.auth_mode === 'string' ? entry.auth_mode : undefined,
			};
		}
	} catch {
		return undefined;
	}
	return undefined;
}

function deepSeekCredentialsPath(userHome: string): string {
	return join(process.env.DSH_HOME || join(userHome, '.dsh'), '.credentials.yaml');
}

function readDeepSeekCredentials(userHome: string): string | undefined {
	try {
		const text = readFileSync(deepSeekCredentialsPath(userHome), 'utf8');
		const match = text.match(/^\s*DEEPSEEK_API_KEY\s*:\s*(.+)\s*$/m);
		const value = match?.[1]?.trim().replace(/^['"]|['"]$/g, '');
		return value || undefined;
	} catch {
		return undefined;
	}
}

function writeDeepSeekCredentials(userHome: string, apiKey: string | undefined): void {
	const path = deepSeekCredentialsPath(userHome);
	mkdirSync(join(path, '..'), { recursive: true });
	if (!apiKey) {
		try {
			const current = readFileSync(path, 'utf8');
			writeFileSync(path, `${current.replace(/^\s*DEEPSEEK_API_KEY\s*:.*$/m, '').trim()}\n`, 'utf8');
		} catch {
			return;
		}
		return;
	}
	writeFileSync(path, `DEEPSEEK_API_KEY: ${JSON.stringify(apiKey)}\n`, 'utf8');
}

function resolveGrokLoginCommand(repoRoot: string): { command: string; prefixArgs: string[] } | undefined {
	const fromWorker = resolveGrokCommand(repoRoot, { ...process.env, FORGE_GROK_SIGNED_IN: '1' } as NodeJS.ProcessEnv);
	if (fromWorker) {
		return { command: fromWorker.command, prefixArgs: fromWorker.prefixArgs };
	}
	return { command: isWindows ? 'grok.cmd' : 'grok', prefixArgs: [] };
}

function spawnDetached(command: string | undefined, args: readonly string[]): void {
	if (!command) {
		return;
	}
	try {
		spawn(command, [...args], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
	} catch {
		return;
	}
}
