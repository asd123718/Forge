/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { RootState } from './state/protocol/state.js';
import type { ICodexAccountRateLimitInfo } from './codexAccount.js';

export type ForgeVendorAccountKind = 'grok' | 'deepseek';

export const GROK_ACCOUNT_META_KEY = 'vscode.grokAccount';
export const GROK_ACCOUNT_SIGN_IN_REQUEST_KEY = 'vscode.grokAccount.signInRequest';
export const GROK_ACCOUNT_SIGN_OUT_REQUEST_KEY = 'vscode.grokAccount.signOutRequest';

export const DEEPSEEK_ACCOUNT_META_KEY = 'vscode.deepseekAccount';
export const DEEPSEEK_ACCOUNT_SIGN_IN_REQUEST_KEY = 'vscode.deepseekAccount.signInRequest';
export const DEEPSEEK_ACCOUNT_SIGN_OUT_REQUEST_KEY = 'vscode.deepseekAccount.signOutRequest';

export const GROK_ACCOUNT_SECRET_RESOURCE = 'https://forge.local/account/grok';
export const DEEPSEEK_ACCOUNT_SECRET_RESOURCE = 'https://forge.local/account/deepseek';
export const GROK_ACCOUNT_SECRET_STORAGE_KEY = 'forge.account.grok.apiKey';
export const DEEPSEEK_ACCOUNT_SECRET_STORAGE_KEY = 'forge.account.deepseek.apiKey';

export interface IForgeVendorAccountInfo {
	readonly status: 'unknown' | 'signingIn' | 'signedIn' | 'signedOut' | 'error';
	readonly email?: string;
	readonly planType?: string;
	readonly rateLimit?: ICodexAccountRateLimitInfo;
	readonly error?: string;
	readonly authUrl?: string;
	readonly authUrlNonce?: string;
	readonly userCode?: string;
}

export function vendorAccountMetaKey(kind: ForgeVendorAccountKind): string {
	return kind === 'grok' ? GROK_ACCOUNT_META_KEY : DEEPSEEK_ACCOUNT_META_KEY;
}

export function vendorAccountSignInRequestKey(kind: ForgeVendorAccountKind): string {
	return kind === 'grok' ? GROK_ACCOUNT_SIGN_IN_REQUEST_KEY : DEEPSEEK_ACCOUNT_SIGN_IN_REQUEST_KEY;
}

export function vendorAccountSignOutRequestKey(kind: ForgeVendorAccountKind): string {
	return kind === 'grok' ? GROK_ACCOUNT_SIGN_OUT_REQUEST_KEY : DEEPSEEK_ACCOUNT_SIGN_OUT_REQUEST_KEY;
}

export function vendorAccountSecretResource(kind: ForgeVendorAccountKind): string {
	return kind === 'grok' ? GROK_ACCOUNT_SECRET_RESOURCE : DEEPSEEK_ACCOUNT_SECRET_RESOURCE;
}

export function vendorAccountSecretStorageKey(kind: ForgeVendorAccountKind): string {
	return kind === 'grok' ? GROK_ACCOUNT_SECRET_STORAGE_KEY : DEEPSEEK_ACCOUNT_SECRET_STORAGE_KEY;
}

export function parseForgeVendorAccountInfo(value: unknown): IForgeVendorAccountInfo {
	if (!value || typeof value !== 'object') {
		return { status: 'unknown' };
	}
	const account = value as Partial<IForgeVendorAccountInfo>;
	if (account.status !== 'unknown' && account.status !== 'signingIn' && account.status !== 'signedIn' && account.status !== 'signedOut' && account.status !== 'error') {
		return { status: 'unknown' };
	}
	const rateLimit = account.rateLimit;
	const validRateLimit = rateLimit
		&& typeof rateLimit === 'object'
		&& typeof rateLimit.usedPercent === 'number'
		&& Number.isFinite(rateLimit.usedPercent)
		&& rateLimit.usedPercent >= 0
		&& rateLimit.usedPercent <= 100
		&& (rateLimit.windowDurationMins === undefined || (typeof rateLimit.windowDurationMins === 'number' && Number.isFinite(rateLimit.windowDurationMins) && rateLimit.windowDurationMins > 0))
		&& (rateLimit.resetsAt === undefined || (typeof rateLimit.resetsAt === 'number' && Number.isFinite(rateLimit.resetsAt) && rateLimit.resetsAt > 0));
	return {
		status: account.status,
		email: typeof account.email === 'string' ? account.email : undefined,
		planType: typeof account.planType === 'string' ? account.planType : undefined,
		rateLimit: validRateLimit ? {
			usedPercent: rateLimit.usedPercent,
			windowDurationMins: rateLimit.windowDurationMins,
			resetsAt: rateLimit.resetsAt,
		} : undefined,
		error: typeof account.error === 'string' ? account.error : undefined,
		authUrl: typeof account.authUrl === 'string' ? account.authUrl : undefined,
		authUrlNonce: typeof account.authUrlNonce === 'string' ? account.authUrlNonce : undefined,
		userCode: typeof account.userCode === 'string' ? account.userCode : undefined,
	};
}

export function readForgeVendorAccountInfo(state: RootState | undefined, kind: ForgeVendorAccountKind): IForgeVendorAccountInfo {
	const key = vendorAccountMetaKey(kind);
	// eslint-disable-next-line local/code-no-untyped-meta-access -- sanctioned reader for namespaced vendor account slots; validated below.
	const metaValue = state?._meta?.[key];
	return parseForgeVendorAccountInfo(state?.config?.values[key] ?? metaValue);
}
