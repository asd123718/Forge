/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { autorun } from '../../../../base/common/observable.js';
import { isAbsolute, join } from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';
import { fromAgentHostUri } from '../../../../platform/agentHost/common/agentHostUri.js';
import { IAgentHostService } from '../../../../platform/agentHost/common/agentService.js';
import {
	DEFAULT_ORCHESTRATION_ASSIGNMENT,
	FORGE_ORCHESTRATION_ASSIGNMENT_KEY,
	isActiveOrchestrationStatus,
	readAssignment,
	readOrchestrationState,
	type IOrchestrationRunState,
	type IOrchestrationTaskState,
} from '../../../../platform/agentHost/common/orchestration/orchestrationTypes.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { FileChangeType, FileChangesEvent, IFileService } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IChatWidget, IChatWidgetService, isIChatViewViewContext } from '../../chat/browser/chat.js';
import { LiveEditPreviewController } from '../../chat/browser/agentSessions/agentHost/liveEditPreview.js';
import { IChatResponseFileChangesService } from '../../chat/browser/chatResponseFileChangesService.js';
import {
	DialecticLiveEditSlotMap,
	dialecticLiveEditContextKey,
	dialecticLiveEditPane,
	dialecticLiveEditSourceId,
	type IDialecticLiveEditTaskRef,
} from '../../chat/common/liveEditPreviewSlots.js';
import { SessionType } from '../../chat/common/chatSessionsService.js';
import { getChatSessionType } from '../../chat/common/model/chatUri.js';
import { FORGE_WORK_MODE_SETTING_ID, readForgeWorkMode } from '../common/forgeWorkMode.js';

/** Feeds live Codex file snapshots from the regular side-bar Chat into the shared Diff controller. */
class ForgeCodexLiveEditContribution extends Disposable {
	static readonly ID = 'workbench.contrib.forgeCodexLiveEdit';

	private readonly _controller: LiveEditPreviewController;
	private readonly _widgetStore = this._register(new DisposableStore());
	private readonly _slots = new DialecticLiveEditSlotMap();
	private readonly _baselines = new Map<string, string>();
	private readonly _dirty = new Set<string>();
	private readonly _playedTasks = new Set<string>();
	private readonly _fileScheduler: RunOnceScheduler;
	private _chatKey: string | undefined;
	private _focused = false;
	private _runId: string | undefined;

	constructor(
		@IChatWidgetService chatWidgetService: IChatWidgetService,
		@IChatResponseFileChangesService private readonly _fileChangesService: IChatResponseFileChangesService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IAgentHostService private readonly _agentHostService: IAgentHostService,
		@IFileService private readonly _fileService: IFileService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		this._controller = this._register(instantiationService.createInstance(LiveEditPreviewController));
		this._fileScheduler = this._register(new RunOnceScheduler(() => { void this._flushDirtyFiles(); }, 50));
		for (const widget of chatWidgetService.getAllWidgets()) {
			this._bindWidget(widget);
		}
		this._register(chatWidgetService.onDidAddWidget(widget => this._bindWidget(widget)));
		this._register(this._agentHostService.rootState.onDidChange(() => this._onOrchestrationChange()));
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(FORGE_WORK_MODE_SETTING_ID)) {
				this._onOrchestrationChange();
			}
		}));
		this._register(this._fileService.onDidFilesChange(e => this._onWorkspaceFilesChange(e)));
		this._onOrchestrationChange();
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
			this._chatKey = chatKey;
			this._controller.setContext(chatKey);
			let activeRequestId: string | undefined;
			const observedRequests = new Set<string>();
			const requestBinding = store.add(new MutableDisposable<DisposableStore>());
			const bindRequest = () => {
				const request = model.getRequests().at(-1);
				if (!request) {
					return;
				}
				const dialectic = this._isDialectic();
				const run = dialectic ? this._run() : undefined;
				const runId = run && isActiveOrchestrationStatus(run.status) ? run.runId : undefined;
				if (runId) {
					if (observedRequests.has(request.id)) {
						return;
					}
				} else if (request.id === activeRequestId) {
					return;
				} else {
					requestBinding.value = undefined;
					observedRequests.clear();
					this._slots.reset();
					this._focused = false;
				}
				activeRequestId = request.id;
				observedRequests.add(request.id);
				const contextKey = dialecticLiveEditContextKey(chatKey, runId, request.id);
				this._controller.setContext(contextKey);
				if (dialectic) {
					this._controller.ensureSplit();
				}
				const editsObservable = this._fileChangesService.getFileEditsForRequest?.(model.sessionResource, request.id);
				if (!editsObservable) {
					return;
				}
				const seen = new Map<string, string>();
				const requestStore = runId && requestBinding.value ? requestBinding.value : new DisposableStore();
				requestBinding.value = requestStore;
				requestStore.add(autorun(reader => {
					const currentDialectic = this._isDialectic();
					const currentRun = currentDialectic ? this._run() : undefined;
					const currentRunId = currentRun && isActiveOrchestrationStatus(currentRun.status) ? currentRun.runId : undefined;
					const liveContextKey = dialecticLiveEditContextKey(chatKey, currentRunId, request.id);
					const tasks = taskRefs(currentRun);
					const workerIds = workerProviderIds(currentRun, this._assignment());
					for (const edit of editsObservable.read(reader)) {
						if (edit.isDeleted) {
							continue;
						}
						const snapshotUri = edit.modifiedSnapshotURI;
						if (!snapshotUri || seen.get(edit.modifiedURI.toString()) === snapshotUri.toString()) {
							continue;
						}
						seen.set(edit.modifiedURI.toString(), snapshotUri.toString());
						const takeFocus = !this._focused;
						this._focused = true;
						this._controller.show({
							contextKey: liveContextKey,
							chatKey,
							resource: edit.modifiedURI,
							originalUri: edit.originalURI,
							snapshotUri,
							isFinal: edit.isEditComplete === true,
							takeFocus,
							pane: currentDialectic ? dialecticLiveEditPane(dialecticLiveEditSourceId(liveEditFilePath(edit.modifiedURI), tasks), workerIds, this._slots) : 'diff',
						});
					}
				}));
				if (!runId) {
					requestStore.add(model.onDidChange(() => {
						if (this._isDialectic() && isActiveOrchestrationStatus(this._run()?.status)) {
							return;
						}
						const current = model.getRequests().find(candidate => candidate.id === request.id);
						if (current?.response?.isComplete || current?.response?.isCanceled) {
							this._controller.finishContext(dialecticLiveEditContextKey(chatKey, undefined, request.id));
						}
					}));
				}
			};
			store.add(model.onDidChange(bindRequest));
			bindRequest();
		};
		this._widgetStore.add(widget.onDidChangeViewModel(bindModel));
		bindModel();
	}

	private _onOrchestrationChange(): void {
		if (!this._isDialectic()) {
			this._resetOrchestrationPreview();
			return;
		}
		const run = this._run();
		if (!run) {
			this._resetOrchestrationPreview();
			return;
		}
		if (this._runId !== run.runId) {
			this._slots.reset();
			this._baselines.clear();
			this._dirty.clear();
			this._playedTasks.clear();
			this._focused = false;
			this._runId = run.runId;
		}
		if (isActiveOrchestrationStatus(run.status)) {
			this._controller.ensureSplit();
			if (this._chatKey) {
				this._controller.setContext(dialecticLiveEditContextKey(this._chatKey, run.runId, run.runId));
			}
			void this._snapshotRunningTasks(run);
			return;
		}
		if (run.status === 'reviewing' || run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
			void this._playCompletedTasks(run);
			if (this._chatKey) {
				this._controller.finishContext(dialecticLiveEditContextKey(this._chatKey, run.runId, run.runId));
			}
		}
	}

	private _resetOrchestrationPreview(): void {
		if (!this._runId && this._dirty.size === 0 && this._baselines.size === 0) {
			return;
		}
		this._fileScheduler.cancel();
		this._slots.reset();
		this._baselines.clear();
		this._dirty.clear();
		this._playedTasks.clear();
		this._focused = false;
		this._runId = undefined;
		this._controller.setContext(this._chatKey);
	}

	private _onWorkspaceFilesChange(event: FileChangesEvent): void {
		if (!this._isDialectic()) {
			return;
		}
		const run = this._run();
		if (!run || run.status !== 'running') {
			return;
		}
		for (const task of run.tasks) {
			if (task.status !== 'running') {
				continue;
			}
			for (const file of [...task.files, ...(task.result?.changedFiles ?? [])]) {
				const resource = resolveWorkspaceFile(run.workspace, file);
				if (event.contains(resource, FileChangeType.UPDATED, FileChangeType.ADDED)) {
					this._dirty.add(resource.toString());
				}
			}
		}
		if (this._dirty.size > 0) {
			this._fileScheduler.schedule();
		}
	}

	private async _snapshotRunningTasks(run: IOrchestrationRunState): Promise<void> {
		const runId = run.runId;
		for (const task of run.tasks) {
			if (task.status !== 'running' && task.status !== 'queued') {
				continue;
			}
			for (const file of task.files) {
				const resource = resolveWorkspaceFile(run.workspace, file);
				const key = resource.toString();
				if (this._baselines.has(key)) {
					continue;
				}
				const baseline = await this._readText(resource);
				if (!this._isCurrentRun(runId)) {
					return;
				}
				this._baselines.set(key, baseline);
			}
		}
	}

	private async _flushDirtyFiles(): Promise<void> {
		const run = this._run();
		const chatKey = this._chatKey;
		if (!run || !chatKey || !this._isDialectic() || this._dirty.size === 0) {
			this._dirty.clear();
			return;
		}
		const dirty = [...this._dirty];
		this._dirty.clear();
		const contextKey = dialecticLiveEditContextKey(chatKey, run.runId, run.runId);
		const workerIds = workerProviderIds(run, this._assignment());
		for (const uriString of dirty) {
			const resource = URI.parse(uriString);
			const after = await this._readText(resource);
			if (!this._isCurrentRun(run.runId)) {
				return;
			}
			const before = this._baselines.get(uriString) ?? '';
			if (after === before) {
				continue;
			}
			const task = taskForFile(run, resource);
			this._controller.show({
				contextKey,
				chatKey,
				resource,
				snapshotUri: resource,
				originalContent: before,
				isFinal: task?.status === 'completed' || task?.status === 'escalated',
				takeFocus: !this._focused,
				pane: dialecticLiveEditPane(task?.workerProviderId ?? dialecticLiveEditSourceId(resource.fsPath, taskRefs(run)), workerIds, this._slots),
			});
			this._focused = true;
			this._baselines.set(uriString, after);
		}
	}

	private async _playCompletedTasks(run: IOrchestrationRunState): Promise<void> {
		const chatKey = this._chatKey;
		if (!chatKey) {
			return;
		}
		const contextKey = dialecticLiveEditContextKey(chatKey, run.runId, run.runId);
		const workerIds = workerProviderIds(run, this._assignment());
		for (const task of run.tasks) {
			const playKey = `${run.runId}:${task.id}:${task.attempt}`;
			if (this._playedTasks.has(playKey) || !task.result || task.result.changedFiles.length === 0) {
				continue;
			}
			if (task.status !== 'completed' && task.status !== 'escalated' && task.status !== 'failed') {
				continue;
			}
			this._playedTasks.add(playKey);
			for (const file of task.result.changedFiles) {
				const resource = resolveWorkspaceFile(run.workspace, file);
				const key = resource.toString();
				const after = await this._readText(resource);
				if (!this._isCurrentRun(run.runId)) {
					return;
				}
				const before = this._baselines.get(key) ?? '';
				if (after === before) {
					continue;
				}
				this._controller.show({
					contextKey,
					chatKey,
					resource,
					snapshotUri: resource,
					originalContent: before,
					isFinal: true,
					takeFocus: !this._focused,
					pane: dialecticLiveEditPane(task.workerProviderId, workerIds, this._slots),
				});
				this._focused = true;
				this._baselines.set(key, after);
			}
		}
	}

	private async _readText(resource: URI): Promise<string> {
		try {
			return (await this._fileService.readFile(resource)).value.toString();
		} catch {
			return '';
		}
	}

	private _isDialectic(): boolean {
		return readForgeWorkMode(this._configurationService.getValue(FORGE_WORK_MODE_SETTING_ID)) === 'dialectic';
	}

	private _run(): IOrchestrationRunState | undefined {
		return readOrchestrationState(rootValues(this._agentHostService));
	}

	private _isCurrentRun(runId: string): boolean {
		return this._isDialectic() && this._runId === runId && this._run()?.runId === runId;
	}

	private _assignment() {
		return readAssignment(rootValues(this._agentHostService)[FORGE_ORCHESTRATION_ASSIGNMENT_KEY]) ?? DEFAULT_ORCHESTRATION_ASSIGNMENT;
	}
}

function rootValues(agentHostService: IAgentHostService): Record<string, unknown> {
	const state = agentHostService.rootState.value;
	if (!state || state instanceof Error) {
		return {};
	}
	return state.config?.values ?? {};
}

function workerProviderIds(run: IOrchestrationRunState | undefined, assignment: { readonly workers: readonly { readonly providerId: string }[] }): readonly string[] {
	return (run?.assignment ?? assignment).workers.map(worker => worker.providerId);
}

function taskRefs(run: IOrchestrationRunState | undefined): readonly IDialecticLiveEditTaskRef[] {
	return (run?.tasks ?? []).map(task => ({
		workerProviderId: task.workerProviderId,
		files: task.files,
		changedFiles: task.result?.changedFiles,
	}));
}

function taskForFile(run: IOrchestrationRunState, resource: URI): IOrchestrationTaskState | undefined {
	const path = resource.fsPath;
	return run.tasks.find(task => dialecticLiveEditSourceId(path, [{
		workerProviderId: task.workerProviderId,
		files: task.files,
		changedFiles: task.result?.changedFiles,
	}]) === task.workerProviderId);
}

function resolveWorkspaceFile(workspace: string, file: string): URI {
	return URI.file(isAbsolute(file) ? file : join(workspace, file));
}

function liveEditFilePath(uri: URI): string {
	const unwrapped = fromAgentHostUri(uri);
	return unwrapped.fsPath || unwrapped.path;
}

registerWorkbenchContribution2(ForgeCodexLiveEditContribution.ID, ForgeCodexLiveEditContribution, WorkbenchPhase.AfterRestored);
