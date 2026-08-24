/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from '../../../../base/common/path.js';

export const GROK_OAUTH_ISSUER = 'https://auth.x.ai';
export const GROK_OAUTH_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
export const GROK_OAUTH_SCOPES = [
	'openid',
	'profile',
	'email',
	'offline_access',
	'grok-cli:access',
	'api:access',
	'conversations:read',
	'conversations:write',
	'workspaces:read',
	'workspaces:write',
] as const;

const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
const DEVICE_CODE_TIMEOUT_MS = 20_000;
const TOKEN_POLL_TIMEOUT_MS = 20_000;

export type IGrokFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface IGrokDeviceCode {
	readonly verificationUri: string;
	readonly verificationUriComplete?: string;
	readonly userCode: string;
	readonly deviceCode: string;
	readonly intervalSec: number;
	readonly expiresInSec: number;
}

export interface IGrokDeviceTokens {
	readonly accessToken: string;
	readonly refreshToken?: string;
	readonly expiresInSec?: number;
	readonly idToken?: string;
}

export function grokAuthScope(issuer = GROK_OAUTH_ISSUER, clientId = GROK_OAUTH_CLIENT_ID): string {
	return `${issuer.replace(/\/$/, '')}::${clientId}`;
}

export function grokAuthPath(userHome: string): string {
	return join(process.env.GROK_HOME || join(userHome, '.grok'), 'auth.json');
}

export function grokLoginUrl(device: IGrokDeviceCode): string {
	return device.verificationUriComplete || device.verificationUri;
}

export function decodeJwtClaims(jwt: string | undefined): { sub?: string; email?: string } {
	if (!jwt) {
		return {};
	}
	const payload = jwt.split('.')[1];
	if (!payload) {
		return {};
	}
	try {
		const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
		const claims = JSON.parse(json) as { sub?: unknown; email?: unknown };
		return {
			sub: typeof claims.sub === 'string' ? claims.sub : undefined,
			email: typeof claims.email === 'string' ? claims.email : undefined,
		};
	} catch {
		return {};
	}
}

/**
 * Prefer Electron `net.fetch` (Chromium stack + system/PAC proxy, no CORS).
 * Fall back to the agent-host proxy-patched fetch, then to global fetch.
 */
export async function resolveGrokFetch(fallback?: IGrokFetch): Promise<IGrokFetch> {
	try {
		const electron = await import('electron') as { net?: { fetch?: IGrokFetch } };
		if (typeof electron.net?.fetch === 'function') {
			const netFetch = electron.net.fetch.bind(electron.net);
			return (input, init) => netFetch(input, init);
		}
	} catch {
		// Node child-process agent host has no Electron net module.
	}
	return fallback ?? ((input, init) => globalThis.fetch(input, init));
}

export async function requestGrokDeviceCode(fetchImpl: IGrokFetch, abort?: AbortSignal): Promise<IGrokDeviceCode> {
	const url = `${GROK_OAUTH_ISSUER}/oauth2/device/code`;
	const body = new URLSearchParams({
		client_id: GROK_OAUTH_CLIENT_ID,
		scope: GROK_OAUTH_SCOPES.join(' '),
		referrer: 'grok-build',
	});
	const response = await grokPost(fetchImpl, url, body, abort, DEVICE_CODE_TIMEOUT_MS);
	if (response.status === 404) {
		throw new Error('当前账号体系不支持浏览器设备登录，请改用 API 密钥。');
	}
	if (response.status < 200 || response.status >= 300) {
		throw new Error(`Grok 登录申请失败（HTTP ${response.status}）：${response.text.slice(0, 300)}`);
	}
	const data = parseJsonObject(response.text);
	const deviceCode = stringField(data, 'device_code');
	const userCode = stringField(data, 'user_code');
	const verificationUri = stringField(data, 'verification_uri');
	if (!deviceCode || !userCode || !verificationUri) {
		throw new Error('Grok 登录服务没有返回设备授权信息。');
	}
	return {
		deviceCode,
		userCode,
		verificationUri,
		verificationUriComplete: stringField(data, 'verification_uri_complete'),
		intervalSec: Math.max(1, numberField(data, 'interval') ?? 5),
		expiresInSec: Math.max(60, numberField(data, 'expires_in') ?? 600),
	};
}

export async function pollGrokDeviceToken(fetchImpl: IGrokFetch, device: IGrokDeviceCode, abort: AbortSignal): Promise<IGrokDeviceTokens> {
	const url = `${GROK_OAUTH_ISSUER}/oauth2/token`;
	let intervalMs = Math.max(0, device.intervalSec) * 1000;
	const deadline = Date.now() + Math.max(device.expiresInSec, 600) * 1000;
	while (Date.now() < deadline) {
		if (abort.aborted) {
			throw new Error('已取消 Grok 登录。');
		}
		await sleep(intervalMs, abort);
		const response = await grokPost(fetchImpl, url, new URLSearchParams({
			grant_type: DEVICE_GRANT_TYPE,
			device_code: device.deviceCode,
			client_id: GROK_OAUTH_CLIENT_ID,
		}), abort, TOKEN_POLL_TIMEOUT_MS);
		const data = parseJsonObject(response.text);
		const accessToken = stringField(data, 'access_token');
		if (response.status >= 200 && response.status < 300 && accessToken) {
			return {
				accessToken,
				refreshToken: stringField(data, 'refresh_token'),
				expiresInSec: numberField(data, 'expires_in'),
				idToken: stringField(data, 'id_token'),
			};
		}
		const error = stringField(data, 'error') ?? '';
		if (error === 'authorization_pending') {
			continue;
		}
		if (error === 'slow_down') {
			intervalMs += 5000;
			continue;
		}
		if (error === 'access_denied') {
			throw new Error('已拒绝 Grok 登录。');
		}
		if (error === 'expired_token') {
			throw new Error('Grok 登录已超时，请重试。');
		}
		throw new Error(stringField(data, 'error_description') || error || `Grok 登录失败（HTTP ${response.status}）。`);
	}
	throw new Error('Grok 登录已超时，请重试。');
}

export function writeGrokOidcAuth(userHome: string, tokens: IGrokDeviceTokens): { email?: string } {
	const claims = decodeJwtClaims(tokens.idToken);
	const now = new Date();
	const entry = {
		key: tokens.accessToken,
		auth_mode: 'oidc',
		create_time: now.toISOString(),
		user_id: claims.sub ?? '',
		email: claims.email,
		refresh_token: tokens.refreshToken,
		expires_at: tokens.expiresInSec ? new Date(now.getTime() + tokens.expiresInSec * 1000).toISOString() : undefined,
		oidc_issuer: GROK_OAUTH_ISSUER,
		oidc_client_id: GROK_OAUTH_CLIENT_ID,
		coding_data_retention_opt_out: true,
	};
	const path = grokAuthPath(userHome);
	mkdirSync(dirname(path), { recursive: true });
	let current: Record<string, unknown> = {};
	if (existsSync(path)) {
		try {
			current = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
		} catch {
			current = {};
		}
	}
	current[grokAuthScope()] = entry;
	writeFileSync(path, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
	return { email: claims.email };
}

export function grokNetworkErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message === '已取消 Grok 登录。') {
		return error.message;
	}
	const message = error instanceof Error ? error.message : String(error);
	if (/timeout|fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|network|offline|AbortError|TimeoutError/i.test(message) || (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))) {
		return '无法连接 xAI 登录服务。请检查网络或系统代理，或改用 API 密钥登录。';
	}
	return message;
}

async function grokPost(fetchImpl: IGrokFetch, url: string, body: URLSearchParams, abort: AbortSignal | undefined, timeoutMs: number): Promise<{ status: number; text: string }> {
	const { signal, dispose } = mergeAbort(abort, timeoutMs);
	try {
		const response = await fetchImpl(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'x-grok-client-surface': 'ui',
				Accept: 'application/json',
			},
			body,
			signal,
		});
		return { status: response.status, text: await response.text() };
	} catch (error) {
		if (abort?.aborted) {
			throw new Error('已取消 Grok 登录。');
		}
		throw new Error(grokNetworkErrorMessage(error));
	} finally {
		dispose();
	}
}

function mergeAbort(abort: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const onAbort = () => controller.abort();
	if (abort?.aborted) {
		controller.abort();
	} else {
		abort?.addEventListener('abort', onAbort, { once: true });
	}
	return {
		signal: controller.signal,
		dispose: () => {
			clearTimeout(timer);
			abort?.removeEventListener('abort', onAbort);
		},
	};
}

function parseJsonObject(text: string): Record<string, unknown> {
	try {
		const value = JSON.parse(text) as unknown;
		return value && typeof value === 'object' ? value as Record<string, unknown> : {};
	} catch {
		throw new Error('无法连接 xAI 登录服务。请检查网络或系统代理，或改用 API 密钥登录。');
	}
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
	const value = data[key];
	return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function numberField(data: Record<string, unknown>, key: string): number | undefined {
	const value = data[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function sleep(ms: number, abort: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (abort.aborted) {
			reject(new Error('已取消 Grok 登录。'));
			return;
		}
		if (ms <= 0) {
			resolve();
			return;
		}
		const timer = setTimeout(() => {
			abort.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(new Error('已取消 Grok 登录。'));
		};
		abort.addEventListener('abort', onAbort, { once: true });
	});
}
