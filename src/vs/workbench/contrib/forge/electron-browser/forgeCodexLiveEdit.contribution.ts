/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { autorun } from '../../../../base/common/observable.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IChatWidget, IChatWidgetService, isIChatViewViewContext } from '../../chat/browser/chat.js';
import { LiveEditPreviewController } from '../../chat/browser/agentSessions/agentHost/liveEditPreview.js';
import { IChatResponseFileChangesService } from '../../chat/browser/chatResponseFileChangesService.js';
import { SessionType } from '../../chat/common/chatSessionsService.js';
import { getChatSessionType } from '../../chat/common/model/chatUri.js';

/** Feeds live Codex file snapshots from the regular side-bar Chat into the shared Diff controller. */
class ForgeCodexLiveEditContribution extends Disposable {
	static readonly ID = 'workbench.contrib.forgeCodexLiveEdit';

	private readonly _controller: LiveEditPreviewController;
	private readonly _widgetStore = this._register(new DisposableStore());

	constructor(
		@IChatWidgetService chatWidgetService: IChatWidgetService,
		@IChatResponseFileChangesService private readonly _fileChangesService: IChatResponseFileChangesService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		this._controller = this._register(instantiationService.createInstance(LiveEditPreviewController));
		for (const widget of chatWidgetService.getAllWidgets()) {
			this._bindWidget(widget);
		}
		this._register(chatWidgetService.onDidAddWidget(widget => this._bindWidget(widget)));
	}

	private _bindWidget(widget: IChatWidget): void {
		if (!isIChatViewViewContext(widget.viewContext)) {
			return;
		}
		const modelBinding = this._widgetStore.add(new MutableDisposable<DisposableStore>());
		const bindModel = () => {
			const store = new DisposableStore();
			modelBinding.value = store;
			const model = widget.viewModel?.model;
			if (!model || getChatSessionType(model.sessionResource) !== SessionType.AgentHostCodex) {
				return;
			}
			const chatKey = model.sessionResource.toString();
			this._controller.setContext(chatKey);
			let activeRequestId: string | undefined;
			const requestBinding = store.add(new MutableDisposable<DisposableStore>());
			const bindRequest = () => {
				const request = model.getRequests().at(-1);
				if (!request || request.id === activeRequestId) {
					return;
				}
				activeRequestId = request.id;
				const contextKey = `${chatKey}\0${request.id}`;
				this._controller.setContext(contextKey);
				const editsObservable = this._fileChangesService.getFileEditsForRequest?.(model.sessionResource, request.id);
				if (!editsObservable) {
					return;
				}
				const seen = new Map<string, string>();
				const requestStore = new DisposableStore();
				requestBinding.value = requestStore;
				requestStore.add(autorun(reader => {
					for (const edit of editsObservable.read(reader)) {
						const snapshotUri = edit.modifiedSnapshotURI;
						if (!snapshotUri || seen.get(edit.modifiedURI.toString()) === snapshotUri.toString()) {
							continue;
						}
						seen.set(edit.modifiedURI.toString(), snapshotUri.toString());
						this._controller.show({
							contextKey,
							chatKey,
							resource: edit.modifiedURI,
							originalUri: edit.originalURI,
							snapshotUri,
							isFinal: edit.isEditComplete === true,
						});
					}
				}));
				requestStore.add(model.onDidChange(() => {
					const current = model.getRequests().find(candidate => candidate.id === request.id);
					if (current?.response?.isComplete || current?.response?.isCanceled) {
						this._controller.finishContext(contextKey);
					}
				}));
			};
			store.add(model.onDidChange(bindRequest));
			bindRequest();
		};
		this._widgetStore.add(widget.onDidChangeViewModel(bindModel));
		bindModel();
	}
}

registerWorkbenchContribution2(ForgeCodexLiveEditContribution.ID, ForgeCodexLiveEditContribution, WorkbenchPhase.AfterRestored);
