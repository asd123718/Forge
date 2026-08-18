/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { autorun } from '../../../../base/common/observable.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution } from '../../../../workbench/common/contributions.js';
import { LiveEditPreviewController } from '../../../../workbench/contrib/chat/browser/agentSessions/agentHost/liveEditPreview.js';
import { isIChatSessionFileChange2 } from '../../../../workbench/contrib/chat/common/chatSessionsService.js';
import { ISessionsService } from '../../../services/sessions/browser/sessionsService.js';
import { isActiveSessionStatus } from '../../../services/sessions/common/session.js';

export { buildStreamingEditAnimation, buildStreamingEditFrames } from '../../../../workbench/contrib/chat/browser/agentSessions/agentHost/liveEditPreview.js';

/** Routes Sessions-app file snapshots through Forge's shared live Diff controller. */
export class StreamingEditPreviewContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.sessions.streamingEditPreview';

	private readonly _controller: LiveEditPreviewController;
	private readonly _seenRevisions = new Map<string, string>();
	private _activeContextKey: string | undefined;
	private _activeChatKey: string | undefined;
	private _turnSequence = 0;
	private _wasActive = false;

	constructor(
		@ISessionsService sessionsService: ISessionsService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		this._controller = this._register(instantiationService.createInstance(LiveEditPreviewController));
		this._register(autorun(reader => {
			const session = sessionsService.activeSession.read(reader);
			const chat = session?.activeChat.read(reader);
			const status = chat?.status.read(reader);
			const chatKey = session && chat ? `${session.resource.toString()}\0${chat.resource.toString()}` : undefined;
			if (!session || !chat || !chatKey || status === undefined) {
				return;
			}
			if (this._activeChatKey !== chatKey) {
				this._activeChatKey = chatKey;
				this._turnSequence = 0;
				this._wasActive = false;
			}
			const isActive = isActiveSessionStatus(status);
			if (isActive && !this._wasActive) {
				this._turnSequence++;
			}
			this._wasActive = isActive;
			const contextKey = `${chatKey}\0${this._turnSequence}`;
			if (this._activeContextKey !== contextKey) {
				this._activeContextKey = contextKey;
				this._seenRevisions.clear();
				this._controller.setContext(contextKey);
			}
			if (!isActive) {
				this._controller.finishContext(contextKey);
				return;
			}
			for (const change of chat.lastTurnChanges?.read(reader) ?? []) {
				const snapshotUri = change.modifiedSnapshotUri;
				if (!snapshotUri) {
					continue;
				}
				const resource = isIChatSessionFileChange2(change) ? change.uri : change.modifiedUri;
				if (this._seenRevisions.get(resource.toString()) === snapshotUri.toString()) {
					continue;
				}
				this._seenRevisions.set(resource.toString(), snapshotUri.toString());
				this._controller.show({ contextKey, chatKey: chat.resource.toString(), resource, originalUri: change.originalUri, snapshotUri, isFinal: false });
			}
		}));
	}
}
