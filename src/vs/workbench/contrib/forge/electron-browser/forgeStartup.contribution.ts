/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/forgeStartup.css';
import { $, append } from '../../../../base/browser/dom.js';
import { disposableTimeout, timeout } from '../../../../base/common/async.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { ILifecycleService, LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ChatViewId, ChatViewPaneTarget, IChatWidgetService } from '../../chat/browser/chat.js';
import { ChatViewPane } from '../../chat/browser/widgetHosts/viewPane/chatViewPane.js';
import { IChatSessionsService, SessionType } from '../../chat/common/chatSessionsService.js';
import { getChatSessionType } from '../../chat/common/model/chatUri.js';

const MINIMUM_SPLASH_DURATION = 1_000;
const CODEX_DISCOVERY_TIMEOUT = 8_000;
const CODEX_DISCOVERY_INTERVAL = 50;

/**
 * Turns Forge's former Agents entry experience into the regular editor shell:
 * the editor restores behind a startup cover and Codex opens in the native
 * auxiliary Chat view, so chat and code always remain separate panes.
 */
class ForgeStartupContribution extends Disposable {
	static readonly ID = 'workbench.contrib.forgeStartup';

	private readonly _overlay: HTMLElement;

	constructor(
		@ILifecycleService private readonly _lifecycleService: ILifecycleService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IViewsService private readonly _viewsService: IViewsService,
		@IChatSessionsService private readonly _chatSessionsService: IChatSessionsService,
		@IChatWidgetService private readonly _chatWidgetService: IChatWidgetService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._overlay = append(layoutService.mainContainer, $('div.forge-startup-overlay'));
		this._overlay.setAttribute('role', 'status');
		this._overlay.setAttribute('aria-busy', 'true');
		this._overlay.setAttribute('aria-label', localize('forge.startup.loading', "Loading Forge"));
		append(this._overlay, $('div.forge-startup-icon.codicon.codicon-agent'));
		this._register(toDisposable(() => this._overlay.remove()));
		void this._initialize();
	}

	private async _initialize(): Promise<void> {
		const minimumDuration = timeout(MINIMUM_SPLASH_DURATION);
		try {
			await this._lifecycleService.when(LifecyclePhase.Restored);
			const codexReady = await this._waitForCodexRegistration();
			if (codexReady) {
				await this._openCodexChat();
			} else {
				await this._viewsService.openView(ChatViewId, false);
			}
		} catch (error) {
			this._logService.warn(`[ForgeStartup] Failed to prepare the Codex side bar: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			await minimumDuration;
			this._overlay.classList.add('forge-startup-dismissed');
			this._overlay.setAttribute('aria-busy', 'false');
			this._register(disposableTimeout(() => this._overlay.remove(), 220));
		}
	}

	private async _waitForCodexRegistration(): Promise<boolean> {
		const deadline = Date.now() + CODEX_DISCOVERY_TIMEOUT;
		while (Date.now() < deadline) {
			if (this._chatSessionsService.getChatSessionContribution(SessionType.AgentHostCodex)) {
				return true;
			}
			await timeout(CODEX_DISCOVERY_INTERVAL);
		}
		return false;
	}

	private async _openCodexChat(): Promise<void> {
		const view = await this._viewsService.openView(ChatViewId, false);
		const activeResource = view instanceof ChatViewPane ? view.widget.viewModel?.sessionResource : undefined;
		if (activeResource && getChatSessionType(activeResource) === SessionType.AgentHostCodex) {
			return;
		}

		await this._chatWidgetService.openSession(
			URI.from({ scheme: SessionType.AgentHostCodex, path: `/untitled-${generateUuid()}` }),
			ChatViewPaneTarget,
			{ preserveFocus: true },
		);
	}
}

registerWorkbenchContribution2(ForgeStartupContribution.ID, ForgeStartupContribution, WorkbenchPhase.BlockRestore);
