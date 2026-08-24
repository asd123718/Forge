/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IAgentHostService } from '../../../../platform/agentHost/common/agentService.js';
import { ActionType } from '../../../../platform/agentHost/common/state/sessionActions.js';
import { ROOT_STATE_URI } from '../../../../platform/agentHost/common/state/sessionState.js';
import {
	type ForgeVendorAccountKind,
	type IForgeVendorAccountInfo,
	readForgeVendorAccountInfo,
	vendorAccountSecretResource,
	vendorAccountSignInRequestKey,
	vendorAccountSignOutRequestKey,
} from '../../../../platform/agentHost/common/forgeVendorAccount.js';
import { openCodexAuthUrl } from './codexAccountService.js';

export const IGrokAccountService = createDecorator<IGrokAccountService>('grokAccountService');
export const IDeepSeekAccountService = createDecorator<IDeepSeekAccountService>('deepSeekAccountService');

export interface IForgeVendorAccountService {
	readonly _serviceBrand: undefined;
	readonly account: IForgeVendorAccountInfo;
	readonly onDidChangeAccount: Event<IForgeVendorAccountInfo>;
	signIn(): void;
	signOut(): void;
}

export interface IGrokAccountService extends IForgeVendorAccountService { }
export interface IDeepSeekAccountService extends IForgeVendorAccountService { }

class ForgeVendorAccountService extends Disposable implements IForgeVendorAccountService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeAccount = this._register(new Emitter<IForgeVendorAccountInfo>());
	readonly onDidChangeAccount = this._onDidChangeAccount.event;
	private readonly _pendingSignInRequests = new Set<string>();
	private _account: IForgeVendorAccountInfo;

	get account(): IForgeVendorAccountInfo {
		return this._account;
	}

	constructor(
		private readonly _kind: ForgeVendorAccountKind,
		@IAgentHostService private readonly _agentHostService: IAgentHostService,
		@IOpenerService private readonly _openerService: IOpenerService,
		private readonly _nativeHostService?: INativeHostService,
	) {
		super();
		const initialState = this._agentHostService.rootState.value;
		this._account = readForgeVendorAccountInfo(initialState instanceof Error ? undefined : initialState, this._kind);
		this._register(this._agentHostService.rootState.onDidChange(state => this._updateAccount(readForgeVendorAccountInfo(state, this._kind))));
	}

	signIn(): void {
		const request = generateUuid();
		this._pendingSignInRequests.add(request);
		this._agentHostService.dispatch(ROOT_STATE_URI, {
			type: ActionType.RootConfigChanged,
			config: { [vendorAccountSignInRequestKey(this._kind)]: request },
		});
	}

	signOut(): void {
		this._agentHostService.dispatch(ROOT_STATE_URI, {
			type: ActionType.RootConfigChanged,
			config: { [vendorAccountSignOutRequestKey(this._kind)]: generateUuid() },
		});
	}

	private _updateAccount(account: IForgeVendorAccountInfo): void {
		this._account = account;
		this._onDidChangeAccount.fire(account);
		if (account.authUrlNonce && this._pendingSignInRequests.delete(account.authUrlNonce) && account.authUrl) {
			void this._openAuthUrl(account.authUrl);
		}
	}

	private async _openAuthUrl(authUrl: string): Promise<void> {
		try {
			if (this._nativeHostService && await this._nativeHostService.openExternal(authUrl)) {
				return;
			}
		} catch {
			// Fall through to the opener service.
		}
		await openCodexAuthUrl(this._openerService, authUrl);
	}
}

class GrokAccountService extends ForgeVendorAccountService implements IGrokAccountService {
	constructor(
		@IAgentHostService agentHostService: IAgentHostService,
		@IOpenerService openerService: IOpenerService,
		@INativeHostService nativeHostService: INativeHostService,
	) {
		super('grok', agentHostService, openerService, nativeHostService);
	}
}

class DeepSeekAccountService extends ForgeVendorAccountService implements IDeepSeekAccountService {
	constructor(
		@IAgentHostService agentHostService: IAgentHostService,
		@IOpenerService openerService: IOpenerService,
	) {
		super('deepseek', agentHostService, openerService);
	}
}

registerSingleton(IGrokAccountService, GrokAccountService, InstantiationType.Delayed);
registerSingleton(IDeepSeekAccountService, DeepSeekAccountService, InstantiationType.Delayed);

export { vendorAccountSecretResource };
