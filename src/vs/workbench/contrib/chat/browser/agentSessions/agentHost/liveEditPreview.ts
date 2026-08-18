/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler, timeout } from '../../../../../../base/common/async.js';
import { ISequence, LcsDiff } from '../../../../../../base/common/diff/diff.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { basename } from '../../../../../../base/common/resources.js';
import { URI } from '../../../../../../base/common/uri.js';
import { ICodeEditor, isDiffEditor } from '../../../../../../editor/browser/editorBrowser.js';
import { Range } from '../../../../../../editor/common/core/range.js';
import { IEditorDecorationsCollection, ScrollType } from '../../../../../../editor/common/editorCommon.js';
import { ILanguageService } from '../../../../../../editor/common/languages/language.js';
import { ITextModel } from '../../../../../../editor/common/model.js';
import { IModelService } from '../../../../../../editor/common/services/model.js';
import { ITextModelContentProvider, ITextModelService } from '../../../../../../editor/common/services/resolverService.js';
import { localize } from '../../../../../../nls.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IEditorIdentifier } from '../../../../../common/editor.js';
import { IEditorService } from '../../../../../services/editor/common/editorService.js';
import { IWorkbenchLayoutService, Parts } from '../../../../../services/layout/browser/layoutService.js';
import './media/liveEditPreview.css';

const LIVE_EDIT_PREVIEW_SCHEME = 'forge-live-edit-preview';
const PREVIEW_UPDATE_DELAY = 16;
const ANIMATION_START_BEAT_MS = 400;
const ANIMATION_END_BEAT_MS = 250;
const MAX_ANIMATED_LINES = 3_000;
const FINISH_FALLBACK_DELAY_MS = 600;
const FINAL_ANIMATION_MAX_LINGER_MS = 1_500;

const ZIP_FRAME_MS = 16;
const ZIP_LINES_PER_FRAME = 8;
const ZIP_MAX_FRAMES_PER_SPAN = 18;
const TYPE_FRAME_MS = 45;
const TYPE_MIN_RUN_MS = 350;
const TYPE_MAX_FRAMES_PER_RUN = 35;
const MAX_ANIMATION_FRAMES = 200;
const MAX_ANIMATION_DURATION_MS = 5_000;
const MAX_ANIMATION_RETAINED_BYTES = 32 * 1024 * 1024;

export interface ILiveEditFrame {
	readonly content: string;
	/** Zero-based line containing the sweep cursor. */
	readonly activeLine: number;
	readonly delayMs: number;
	readonly zip: boolean;
}

export interface ILiveEditAnimation {
	readonly frames: readonly ILiveEditFrame[];
	readonly firstChangedLine: number;
}

export interface ILiveEditPreviewUpdate {
	readonly contextKey: string;
	readonly chatKey: string;
	readonly resource: URI;
	readonly originalUri?: URI;
	readonly snapshotUri: URI;
	readonly isFinal: boolean;
}

class LineSequence implements ISequence {
	constructor(private readonly _lines: readonly string[]) { }

	getElements(): string[] {
		return [...this._lines];
	}
}

/**
 * Builds the diff-aware top-to-bottom sweep used by Cline's EditPreview.
 * Unchanged spans zip past while each changed run is visibly written. Unlike the
 * extension implementation, Forge feeds this animation real Codex snapshots.
 *
 * Portions adapted from Cline EditPreview, licensed under Apache-2.0.
 */
export function buildStreamingEditAnimation(leftContent: string, rightContent: string): ILiveEditAnimation {
	const newLines = rightContent.split('\n');
	const originalLines = leftContent.split('\n');
	const changed = changedNewLineFlags(originalLines, newLines);
	const firstChangedLine = Math.max(0, changed.indexOf(true));
	const renderImmediately = (): ILiveEditAnimation => ({
		frames: [{ content: rightContent, activeLine: firstChangedLine, delayMs: 0, zip: true }],
		firstChangedLine,
	});

	if (!changed.includes(true)) {
		return renderImmediately();
	}

	const frames: ILiveEditFrame[] = [];
	let scheduledDurationMs = 0;
	let estimatedRetainedBytes = 0;
	const newLineLengthPrefixes = cumulativeLineLengths(newLines);
	const originalLineLengthPrefixes = cumulativeLineLengths(originalLines);
	const frameByteLength = (activeLine: number): number => {
		const newLineCount = activeLine + 1;
		const originalStart = Math.min(newLineCount, originalLines.length);
		const originalLineCount = originalLines.length - originalStart;
		const lineCount = newLineCount + originalLineCount;
		const contentLength = newLineLengthPrefixes[newLineCount]
			+ (originalLineLengthPrefixes[originalLines.length] - originalLineLengthPrefixes[originalStart])
			+ Math.max(0, lineCount - 1);
		return contentLength * 2;
	};
	const appendFrame = (activeLine: number, delayMs: number, zip: boolean): boolean => {
		const candidateBytes = frameByteLength(activeLine);
		if (
			frames.length + 1 > MAX_ANIMATION_FRAMES
			|| scheduledDurationMs + delayMs > MAX_ANIMATION_DURATION_MS
			|| estimatedRetainedBytes + candidateBytes > MAX_ANIMATION_RETAINED_BYTES
		) {
			return false;
		}
		frames.push({
			content: [...newLines.slice(0, activeLine + 1), ...originalLines.slice(activeLine + 1)].join('\n'),
			activeLine,
			delayMs,
			zip,
		});
		scheduledDurationMs += delayMs;
		estimatedRetainedBytes += candidateBytes;
		return true;
	};

	let index = 0;
	while (index < newLines.length) {
		const isChanged = changed[index];
		let runEnd = index;
		while (runEnd < newLines.length && changed[runEnd] === isChanged) {
			runEnd++;
		}
		const runLength = runEnd - index;
		let stride: number;
		let delayMs: number;
		if (isChanged) {
			const runFrames = Math.min(runLength, TYPE_MAX_FRAMES_PER_RUN);
			stride = Math.ceil(runLength / runFrames);
			delayMs = Math.max(TYPE_FRAME_MS, Math.round(TYPE_MIN_RUN_MS / runFrames));
		} else {
			const runFrames = Math.min(Math.ceil(runLength / ZIP_LINES_PER_FRAME), ZIP_MAX_FRAMES_PER_SPAN);
			stride = Math.ceil(runLength / runFrames);
			delayMs = ZIP_FRAME_MS;
		}

		for (let line = Math.min(index + stride - 1, runEnd - 1); line < runEnd; line += stride) {
			if (!appendFrame(line, delayMs, !isChanged)) {
				return renderImmediately();
			}
		}
		if (frames[frames.length - 1].activeLine !== runEnd - 1 && !appendFrame(runEnd - 1, delayMs, !isChanged)) {
			return renderImmediately();
		}
		index = runEnd;
	}

	const last = frames[frames.length - 1];
	frames[frames.length - 1] = { ...last, content: rightContent };
	return { frames, firstChangedLine };
}

/** Kept for downstream callers while the preview API migrates to animation metadata. */
export function buildStreamingEditFrames(from: string, to: string): readonly ILiveEditFrame[] {
	return buildStreamingEditAnimation(from, to).frames;
}

function cumulativeLineLengths(lines: readonly string[]): number[] {
	const prefixes = new Array<number>(lines.length + 1).fill(0);
	for (let index = 0; index < lines.length; index++) {
		prefixes[index + 1] = prefixes[index] + lines[index].length;
	}
	return prefixes;
}

function changedNewLineFlags(originalLines: readonly string[], newLines: readonly string[]): boolean[] {
	const flags = new Array<boolean>(newLines.length).fill(false);
	const changes = new LcsDiff(new LineSequence(originalLines), new LineSequence(newLines)).ComputeDiff(false).changes;
	for (const change of changes) {
		for (let index = 0; index < change.modifiedLength; index++) {
			flags[change.modifiedStart + index] = true;
		}
		if (change.modifiedLength === 0 && flags.length > 0) {
			flags[Math.min(change.modifiedStart, flags.length - 1)] = true;
		}
	}
	return flags;
}

class LiveEditPreviewContentProvider implements ITextModelContentProvider {
	private readonly _contents = new Map<string, string>();

	constructor(
		@IModelService private readonly _modelService: IModelService,
		@ILanguageService private readonly _languageService: ILanguageService,
	) { }

	set(resource: URI, content: string): void {
		this._contents.set(resource.toString(), content);
		const model = this._modelService.getModel(resource);
		if (model && !model.isDisposed() && model.getValue() !== content) {
			model.setValue(content);
		}
	}

	delete(resource: URI): void {
		this._contents.delete(resource.toString());
	}

	get(resource: URI): string {
		const model = this._modelService.getModel(resource);
		return model && !model.isDisposed() ? model.getValue() : (this._contents.get(resource.toString()) ?? '');
	}

	async provideTextContent(resource: URI): Promise<ITextModel | null> {
		const existing = this._modelService.getModel(resource);
		return existing && !existing.isDisposed() ? existing : this._modelService.createModel(
			this._contents.get(resource.toString()) ?? '',
			this._languageService.createByFilepathOrFirstLine(resource),
			resource,
		);
	}
}

class LiveEditDecorationController {
	private readonly _fadedOverlay: IEditorDecorationsCollection;
	private readonly _activeLine: IEditorDecorationsCollection;

	constructor(private readonly _editor: ICodeEditor) {
		this._fadedOverlay = _editor.createDecorationsCollection();
		this._activeLine = _editor.createDecorationsCollection();
	}

	parkAtTop(totalLines: number): void {
		this._editor.revealLineNearTop(1, ScrollType.Immediate);
		this._activeLine.set([{ range: new Range(1, 1, 1, Number.MAX_SAFE_INTEGER), options: { description: 'forge-live-edit-active-line', isWholeLine: true, className: 'forge-live-edit-active-line' } }]);
		this._setFadedRange(1, totalLines);
	}

	update(activeLine: number, totalLines: number): void {
		const editorLine = activeLine + 1;
		this._activeLine.set([{ range: new Range(editorLine, 1, editorLine, Number.MAX_SAFE_INTEGER), options: { description: 'forge-live-edit-active-line', isWholeLine: true, className: 'forge-live-edit-active-line' } }]);
		this._setFadedRange(editorLine + 1, totalLines);
	}

	clear(): void {
		this._activeLine.clear();
		this._fadedOverlay.clear();
	}

	private _setFadedRange(startLine: number, totalLines: number): void {
		if (startLine > totalLines || totalLines <= 0) {
			this._fadedOverlay.clear();
			return;
		}
		this._fadedOverlay.set([{ range: new Range(startLine, 1, totalLines, Number.MAX_SAFE_INTEGER), options: { description: 'forge-live-edit-faded-lines', isWholeLine: true, className: 'forge-live-edit-faded-line' } }]);
	}
}

interface IActiveLivePreview {
	readonly contextKey: string;
	readonly previewKey: string;
	readonly previewUri: URI;
	readonly resource: URI;
	readonly editorIdentifier: IEditorIdentifier | undefined;
	readonly modifiedEditor: ICodeEditor | undefined;
	targetContent: string;
	hasFinalSnapshot: boolean;
	animation: Promise<void> | undefined;
}

/**
 * VS Code implementation of the read-only edit preview used by both Codex
 * sidebar chat and the Sessions app. Ported from Cline's VscodeEditPreview:
 * both diff sides are virtual, the right side starts as the original file, and
 * a diff-aware sweep types the new content in. The host may only have a
 * complete tool payload (write_file); that is still animated locally, matching
 * Cline's "SDK only surfaces complete tool input" preview.
 */
export class LiveEditPreviewController extends Disposable {
	private readonly _contentProvider: LiveEditPreviewContentProvider;
	private readonly _scheduler: RunOnceScheduler;
	private readonly _finishScheduler: RunOnceScheduler;
	private _pending: ILiveEditPreviewUpdate | undefined;
	private _contextKey: string | undefined;
	private _flushRunning = false;
	private _animationGeneration = 0;
	private _activePreview: IActiveLivePreview | undefined;
	private _activeDecorations: LiveEditDecorationController | undefined;
	private _closingPreview: Promise<void> = Promise.resolve();
	private readonly _finishedContexts = new Set<string>();

	constructor(
		@ITextModelService textModelService: ITextModelService,
		@IModelService modelService: IModelService,
		@ILanguageService languageService: ILanguageService,
		@IFileService private readonly _fileService: IFileService,
		@IEditorService private readonly _editorService: IEditorService,
		@IWorkbenchLayoutService private readonly _layoutService: IWorkbenchLayoutService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._contentProvider = new LiveEditPreviewContentProvider(modelService, languageService);
		this._register(textModelService.registerTextModelContentProvider(LIVE_EDIT_PREVIEW_SCHEME, this._contentProvider));
		this._scheduler = this._register(new RunOnceScheduler(() => { void this._flush(); }, PREVIEW_UPDATE_DELAY));
		this._finishScheduler = this._register(new RunOnceScheduler(() => {
			const active = this._activePreview;
			if (active && !active.hasFinalSnapshot) {
				this._queueCloseActivePreview(true);
			}
		}, FINISH_FALLBACK_DELAY_MS));
	}

	override dispose(): void {
		this._settleActiveAnimation();
		this._queueCloseActivePreview(false);
		super.dispose();
	}

	show(update: ILiveEditPreviewUpdate): void {
		if (this._contextKey !== update.contextKey) {
			this.setContext(update.contextKey);
		}
		this._pending = this._finishedContexts.has(update.contextKey) ? { ...update, isFinal: true } : update;
		this._scheduler.schedule();
	}

	finishContext(contextKey: string): void {
		this._finishedContexts.add(contextKey);
		const active = this._activePreview;
		if (active?.contextKey === contextKey) {
			active.hasFinalSnapshot = true;
			this._finishScheduler.cancel();
			this._closeAfterSweep(active, active.animation ?? Promise.resolve(), true);
		}
	}

	setContext(contextKey: string | undefined): void {
		if (this._contextKey === contextKey) {
			return;
		}
		if (this._contextKey) {
			this._finishedContexts.delete(this._contextKey);
		}
		this._contextKey = contextKey;
		this._settleActiveAnimation();
		this._queueCloseActivePreview(true);
		this._pending = undefined;
		this._scheduler.cancel();
		this._finishScheduler.cancel();
	}

	private async _flush(): Promise<void> {
		if (this._flushRunning) {
			return;
		}
		this._flushRunning = true;
		try {
			while (this._pending) {
				const pending = this._pending;
				this._pending = undefined;
				await this._show(pending);
			}
		} finally {
			this._flushRunning = false;
			if (this._pending) {
				this._scheduler.schedule();
			}
		}
	}

	private async _show(update: ILiveEditPreviewUpdate): Promise<void> {
		if (update.contextKey !== this._contextKey) {
			return;
		}
		try {
			const shouldFinalize = update.isFinal || this._finishedContexts.has(update.contextKey);
			const targetContent = (await this._fileService.readFile(update.snapshotUri)).value.toString();
			if (update.contextKey !== this._contextKey) {
				return;
			}
			const previewUri = URI.from({ scheme: LIVE_EDIT_PREVIEW_SCHEME, path: update.resource.path, query: JSON.stringify({ chat: update.chatKey, resource: update.resource.toString(), original: update.originalUri?.toString() }) });
			const previewKey = previewUri.toString();
			let newlyOpened = false;
			if (this._activePreview?.previewKey !== previewKey) {
				this._settleActiveAnimation();
				this._queueCloseActivePreview(true);
				await this._closingPreview;
				this._contentProvider.set(previewUri, await this._readBaseline(update));
				if (update.contextKey !== this._contextKey) {
					return;
				}
				this._layoutService.setPartHidden(false, Parts.EDITOR_PART);
				const pane = await this._editorService.openEditor({
					original: { resource: update.originalUri },
					modified: { resource: previewUri },
					label: localize('liveEditPreview.label', "{0} — Live Codex Edit", basename(update.resource)),
					description: localize('liveEditPreview.description', "Codex is writing this file line by line"),
					options: { pinned: true, preserveFocus: true, revealIfOpened: true },
				});
				const control = pane?.getControl();
				const modifiedEditor = isDiffEditor(control) ? control.getModifiedEditor() : undefined;
				this._activePreview = {
					contextKey: update.contextKey,
					previewKey,
					previewUri,
					resource: update.resource,
					editorIdentifier: pane?.input ? { groupId: pane.group.id, editor: pane.input } : undefined,
					modifiedEditor,
					targetContent,
					hasFinalSnapshot: shouldFinalize,
					animation: undefined,
				};
				newlyOpened = true;
			} else if (this._activePreview.targetContent === targetContent) {
				this._activePreview.hasFinalSnapshot ||= shouldFinalize;
				if (shouldFinalize) {
					this._finishScheduler.cancel();
					this._closeAfterSweep(this._activePreview, this._activePreview.animation ?? Promise.resolve(), true);
				}
				return;
			} else {
				this._activePreview.targetContent = targetContent;
				this._activePreview.hasFinalSnapshot ||= shouldFinalize;
			}

			const active = this._activePreview;
			if (!active) {
				return;
			}
			if (shouldFinalize) {
				active.hasFinalSnapshot = true;
				this._finishScheduler.cancel();
			}
			const animation = this._animate(active, targetContent, newlyOpened);
			active.animation = animation;
			this._closeAfterSweep(active, animation, newlyOpened);
		} catch (error) {
			this._logService.warn(`[LiveEditPreview] Failed to update ${update.resource.toString()}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Cline's VscodeEditPreview plays the full diff-aware sweep (up to 5s) and
	 * only then closes. A 1.5s linger race is for later incremental patches that
	 * already had a chance to animate — not for the first open of a complete file,
	 * and not for a final snapshot of the same content already being swept.
	 */
	private _closeAfterSweep(active: IActiveLivePreview, animation: Promise<void>, playFullSweep: boolean): void {
		if (!active.hasFinalSnapshot) {
			return;
		}
		const wait = playFullSweep ? animation : Promise.race([animation, timeout(FINAL_ANIMATION_MAX_LINGER_MS)]);
		void wait.then(() => {
			if (active === this._activePreview) {
				this._queueCloseActivePreview(true);
			}
		}, error => {
			this._logService.warn(`[LiveEditPreview] Animation failed for ${active.resource.toString()}: ${error instanceof Error ? error.message : String(error)}`);
		});
	}

	private async _readBaseline(update: ILiveEditPreviewUpdate): Promise<string> {
		for (const resource of [update.originalUri, update.resource]) {
			if (resource) {
				try {
					return (await this._fileService.readFile(resource)).value.toString();
				} catch { }
			}
		}
		return '';
	}

	private async _animate(active: IActiveLivePreview, targetContent: string, newlyOpened: boolean): Promise<void> {
		active.targetContent = targetContent;
		const generation = ++this._animationGeneration;
		const currentContent = this._contentProvider.get(active.previewUri);
		const totalLines = targetContent.split('\n').length;
		if (!active.modifiedEditor || totalLines > MAX_ANIMATED_LINES) {
			this._contentProvider.set(active.previewUri, targetContent);
			return;
		}

		const { frames, firstChangedLine } = buildStreamingEditAnimation(currentContent, targetContent);
		if (frames.length <= 1) {
			this._contentProvider.set(active.previewUri, targetContent);
			active.modifiedEditor.revealLineInCenter(firstChangedLine + 1, ScrollType.Smooth);
			return;
		}

		this._activeDecorations?.clear();
		const decorations = new LiveEditDecorationController(active.modifiedEditor);
		this._activeDecorations = decorations;
		if (newlyOpened) {
			decorations.parkAtTop(Math.max(1, active.modifiedEditor.getModel()?.getLineCount() ?? totalLines));
			await timeout(ANIMATION_START_BEAT_MS);
		}
		try {
			for (const frame of frames) {
				if (generation !== this._animationGeneration || active !== this._activePreview) {
					return;
				}
				this._contentProvider.set(active.previewUri, frame.content);
				const model = active.modifiedEditor.getModel();
				if (model?.uri.toString() === active.previewKey) {
					const line = Math.min(frame.activeLine + 1, model.getLineCount());
					decorations.update(line - 1, model.getLineCount());
					if (frame.zip) {
						active.modifiedEditor.revealLineInCenter(line, ScrollType.Smooth);
					} else {
						active.modifiedEditor.revealLineInCenterIfOutsideViewport(line, ScrollType.Smooth);
					}
				}
				await timeout(frame.delayMs);
			}
		} finally {
			decorations.clear();
			if (this._activeDecorations === decorations) {
				this._activeDecorations = undefined;
			}
		}
		if (generation === this._animationGeneration && active === this._activePreview) {
			await timeout(ANIMATION_END_BEAT_MS);
			active.modifiedEditor.revealLineInCenter(firstChangedLine + 1, ScrollType.Smooth);
		}
	}

	private _settleActiveAnimation(): void {
		this._animationGeneration++;
		this._activeDecorations?.clear();
		this._activeDecorations = undefined;
		const active = this._activePreview;
		if (active) {
			this._contentProvider.set(active.previewUri, active.targetContent);
		}
	}

	private _queueCloseActivePreview(openRealFile: boolean): void {
		const active = this._activePreview;
		if (!active) {
			return;
		}
		this._settleActiveAnimation();
		this._activePreview = undefined;
		this._closingPreview = this._closingPreview.then(() => this._closePreview(active, openRealFile));
	}

	private async _closePreview(active: IActiveLivePreview, openRealFile: boolean): Promise<void> {
		try {
			if (openRealFile) {
				try {
					await this._editorService.openEditor({ resource: active.resource, options: { pinned: true, preserveFocus: true, revealIfOpened: true } }, active.editorIdentifier?.groupId);
				} catch (error) {
					this._logService.debug(`[LiveEditPreview] The completed resource cannot be opened: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
			if (active.editorIdentifier) {
				await this._editorService.closeEditor(active.editorIdentifier, { preserveFocus: true });
			}
		} finally {
			this._contentProvider.delete(active.previewUri);
		}
	}
}
