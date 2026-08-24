/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs/promises';
import { Disposable, type IReference } from '../../../../base/common/lifecycle.js';
import { basename, isAbsolute, resolve } from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../files/common/files.js';
import { IInstantiationService } from '../../../instantiation/common/instantiation.js';
import { ILogService } from '../../../log/common/log.js';
import type { ISessionDatabase } from '../../common/sessionDataService.js';
import type { ToolResultFileEditContent } from '../../common/state/sessionState.js';
import { FileEditTracker } from '../shared/fileEditTracker.js';
import type { FileUpdateChange } from './protocol/generated/v2/FileUpdateChange.js';

interface IObservedFileEdit {
	readonly path: string;
	afterPath?: string;
	omitBefore?: boolean;
	omitAfter?: boolean;
	readonly beforeText: Promise<string>;
	readonly start: Promise<void>;
}

export interface IShellFileSnapshot {
	readonly existed: boolean;
	readonly content: string;
	readonly skippedContent: boolean;
	readonly size: number;
	readonly mtimeMs: number;
}

interface IObservedShellEdit {
	readonly before: Map<string, IShellFileSnapshot>;
	readonly roots: readonly string[];
	readonly candidates: readonly string[];
}

interface IDirectWrite {
	readonly path: string;
	readonly contents: string;
}

export const shellSnapshotIgnoredDirectories = new Set([
	'.git', '.hg', '.svn', '.cache', '.build', '.venv', '__pycache__',
	'node_modules', 'out', 'build', 'dist', 'target', 'coverage', 'vendor', 'venv',
]);
export const shellSnapshotMaxFiles = 3_000;
export const shellSnapshotMaxFileBytes = 2 * 1024 * 1024;
export const shellSnapshotMaxTotalBytes = 24 * 1024 * 1024;

export const LIVE_PREVIEW_UNAVAILABLE_MESSAGE = 'Live preview unavailable; the final diff will appear when the edit completes.';
export const LIVE_PREVIEW_CONFLICT_MESSAGE = 'Live preview unavailable because the file changed on disk while Codex was streaming. The final diff will appear when the edit completes.';

export interface IFileChangePreviewSuccess {
	readonly ok: true;
	readonly after: string;
	readonly afterPath?: string;
	readonly omitBefore: boolean;
	readonly omitAfter: boolean;
}

export interface IFileChangePreviewFailure {
	readonly ok: false;
	readonly reason: string;
}

export type IFileChangePreview = IFileChangePreviewSuccess | IFileChangePreviewFailure;

export interface IFileEditSnapshotResult {
	readonly edits: readonly ToolResultFileEditContent[];
	readonly previewUnavailable?: string;
}

/**
 * Adapts Codex's streamed `fileChange/patchUpdated` notifications to Agent
 * Host file-edit snapshots. Codex remains responsible for applying and
 * approving patches; this class only builds native, read-only diff previews.
 */
export class CodexFileEditObserver extends Disposable {
	private readonly _tracker: FileEditTracker;
	private readonly _items = new Map<string, Map<string, IObservedFileEdit>>();
	private readonly _shellItems = new Map<string, IObservedShellEdit>();
	private readonly _directWrites = new Map<string, IDirectWrite>();
	private readonly _turnDiffRevisions = new Map<string, number>();

	constructor(
		sessionUri: URI,
		private readonly _database: IReference<ISessionDatabase>,
		@IInstantiationService instantiationService: IInstantiationService,
		@IFileService private readonly _fileService: IFileService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._tracker = instantiationService.createInstance(FileEditTracker, sessionUri.toString(), _database.object);
	}

	begin(itemId: string, workingDirectory: URI | undefined, changes: readonly FileUpdateChange[]): void {
		for (const change of changes) {
			this._ensureFile(itemId, workingDirectory, change.path, change);
		}
	}

	async snapshot(turnId: string, toolCallId: string, itemId: string, workingDirectory: URI | undefined, changes: readonly FileUpdateChange[]): Promise<IFileEditSnapshotResult> {
		const edits: ToolResultFileEditContent[] = [];
		const reasons = new Set<string>();
		for (const change of changes) {
			const observed = this._ensureFile(itemId, workingDirectory, change.path, change);
			try {
				await observed.start;
				const beforeText = await observed.beforeText;
				const currentText = await this._readFile(observed.path);
				if (currentText !== beforeText) {
					reasons.add(LIVE_PREVIEW_CONFLICT_MESSAGE);
					continue;
				}
				const preview = previewFileChange(beforeText, change);
				if (!preview.ok) {
					reasons.add(preview.reason);
					continue;
				}
				const afterPath = preview.afterPath
					? (isAbsolute(preview.afterPath) ? preview.afterPath : resolve(workingDirectory?.fsPath ?? process.cwd(), preview.afterPath))
					: observed.afterPath;
				const edit = await this._tracker.snapshotEditContent(turnId, toolCallId, observed.path, preview.after, {
					afterPath,
					omitBefore: preview.omitBefore,
					omitAfter: preview.omitAfter,
				});
				if (edit) {
					edits.push(edit);
				}
			} catch (error) {
				this._logService.warn(`[CodexFileEditObserver] Failed to snapshot ${observed.path}: ${error instanceof Error ? error.message : String(error)}`);
				reasons.add(LIVE_PREVIEW_UNAVAILABLE_MESSAGE);
			}
		}
		return {
			edits,
			previewUnavailable: reasons.size > 0 ? [...reasons][0] : undefined,
		};
	}

	async complete(turnId: string, toolCallId: string, itemId: string, workingDirectory: URI | undefined, changes: readonly FileUpdateChange[], modelId: string | undefined): Promise<readonly ToolResultFileEditContent[]> {
		this.begin(itemId, workingDirectory, changes);
		const item = this._items.get(itemId);
		if (!item) {
			return [];
		}
		this._items.delete(itemId);
		const edits: ToolResultFileEditContent[] = [];
		for (const [path, observed] of item) {
			try {
				await observed.start;
				await this._tracker.completeEdit(path, {
					afterPath: observed.afterPath,
					omitBefore: observed.omitBefore,
					omitAfter: observed.omitAfter,
				});
				const edit = await this._tracker.takeCompletedEdit(turnId, toolCallId, path, 'apply_patch', changes, modelId);
				if (edit) {
					edits.push(edit);
				}
			} catch (error) {
				this._logService.warn(`[CodexFileEditObserver] Failed to complete ${path}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		return edits;
	}

	/**
	 * Takes a bounded before-snapshot for shell commands that appear capable of
	 * writing files. Exact paths mentioned by the command are always included;
	 * small workspaces are additionally snapshotted so variable/generated paths
	 * are covered without imposing an unbounded cost on large repositories.
	 */
	async beginShell(itemId: string, command: string, cwd: string | undefined, workingDirectories: readonly URI[]): Promise<void> {
		if (!mayMutateFiles(command)) {
			return;
		}
		const roots = distinctPaths([
			...(cwd ? [cwd] : []),
			...workingDirectories.map(directory => directory.fsPath),
		]);
		const base = cwd ?? roots[0] ?? process.cwd();
		const candidates = shellCommandFileCandidates(command, base);
		const before = new Map<string, IShellFileSnapshot>();
		for (const candidate of candidates) {
			before.set(candidate, await readShellSnapshot(candidate));
		}
		let remainingFiles = shellSnapshotMaxFiles;
		let remainingBytes = shellSnapshotMaxTotalBytes;
		for (const root of roots) {
			const result = await snapshotDirectory(root, before, remainingFiles, remainingBytes);
			remainingFiles -= result.files;
			remainingBytes -= result.bytes;
			if (remainingFiles <= 0 || remainingBytes <= 0) {
				break;
			}
		}
		this._shellItems.set(itemId, { before, roots, candidates });
	}

	/** Returns file-edit results for writes performed by a completed shell command. */
	async completeShell(turnId: string, toolCallId: string, itemId: string): Promise<readonly ToolResultFileEditContent[]> {
		const observed = this._shellItems.get(itemId);
		this._shellItems.delete(itemId);
		if (!observed) {
			return [];
		}
		const after = new Map<string, IShellFileSnapshot>();
		for (const candidate of observed.candidates) {
			after.set(candidate, await readShellSnapshot(candidate));
		}
		let remainingFiles = shellSnapshotMaxFiles;
		let remainingBytes = shellSnapshotMaxTotalBytes;
		for (const root of observed.roots) {
			const result = await snapshotDirectory(root, after, remainingFiles, remainingBytes);
			remainingFiles -= result.files;
			remainingBytes -= result.bytes;
			if (remainingFiles <= 0 || remainingBytes <= 0) {
				break;
			}
		}
		const paths = new Set([...observed.before.keys(), ...after.keys()]);
		const edits: ToolResultFileEditContent[] = [];
		const missing: IShellFileSnapshot = { existed: false, content: '', skippedContent: false, size: 0, mtimeMs: 0 };
		for (const path of paths) {
			const before = observed.before.get(path) ?? missing;
			const current = after.get(path) ?? missing;
			if (before.skippedContent || current.skippedContent) {
				if (before.existed === current.existed && before.size === current.size && before.mtimeMs === current.mtimeMs) {
					continue;
				}
				this._logService.warn(`[CodexFileEditObserver] Refusing shell preview for binary or oversized file ${path}`);
				continue;
			}
			if (before.existed === current.existed && before.content === current.content) {
				continue;
			}
			try {
				edits.push(await this._tracker.snapshotKnownContents(turnId, toolCallId, path, before.content, before.existed, current.content, 1, {
					omitBefore: !before.existed,
					omitAfter: !current.existed,
				}));
			} catch (error) {
				this._logService.warn(`[CodexFileEditObserver] Failed to snapshot shell edit ${path}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		return edits;
	}

	/** Captures Codex's cumulative turn diff, including files written by shell tools. */
	async snapshotTurnDiff(turnId: string, toolCallId: string, workingDirectories: readonly URI[], diff: string): Promise<readonly ToolResultFileEditContent[]> {
		const edits: ToolResultFileEditContent[] = [];
		for (const file of parseGitTurnDiff(diff)) {
			try {
				const path = await resolveTurnDiffPath(file.path, file.afterExists, workingDirectories, candidate => this._fileService.exists(URI.file(candidate)));
				const afterText = file.afterExists ? await this._readFile(path) : '';
				const inverted = file.beforeExisted ? invertUnifiedDiff(file.patch) : '';
				const beforeText = file.beforeExisted ? applyUnifiedDiff(afterText, inverted) : '';
				if (file.beforeExisted && beforeText === undefined) {
					this._logService.warn(`[CodexFileEditObserver] Refusing turn-diff preview for ${file.path}: reconstructed before-state does not match the patch`);
					continue;
				}
				const revisionKey = `${turnId}\0${path}`;
				const revision = (this._turnDiffRevisions.get(revisionKey) ?? 0) + 1;
				this._turnDiffRevisions.set(revisionKey, revision);
				edits.push(await this._tracker.snapshotKnownContents(turnId, toolCallId, path, beforeText ?? '', file.beforeExisted, afterText, revision, {
					omitBefore: !file.beforeExisted,
					omitAfter: !file.afterExists,
				}));
			} catch (error) {
				this._logService.warn(`[CodexFileEditObserver] Failed to snapshot turn diff for ${file.path}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		return edits;
	}

	clearTurnDiff(turnId: string): void {
		for (const key of this._turnDiffRevisions.keys()) {
			if (key.startsWith(`${turnId}\0`)) {
				this._turnDiffRevisions.delete(key);
			}
		}
	}

	/**
	 * Host `write_file` does not stream `fileChange/patchUpdated`. Snapshot the
	 * current on-disk bytes, persist the complete after-content, then write the
	 * workspace file. Live Codex Edit plays Cline's local sweep from that pair;
	 * dripping prefixes here would abort that sweep.
	 */
	async beginDirectWrite(itemId: string, filePath: string, contents: string): Promise<void> {
		this._directWrites.set(itemId, { path: filePath, contents });
		await this._tracker.trackEditStart(filePath);
	}

	async snapshotDirectWrite(turnId: string, toolCallId: string, itemId: string, afterContent?: string): Promise<ToolResultFileEditContent | undefined> {
		const write = this._directWrites.get(itemId);
		if (!write) {
			return undefined;
		}
		try {
			return await this._tracker.snapshotEditContent(turnId, toolCallId, write.path, afterContent ?? write.contents);
		} catch (error) {
			this._logService.warn(`[CodexFileEditObserver] Failed to snapshot write_file ${write.path}: ${error instanceof Error ? error.message : String(error)}`);
			return undefined;
		}
	}

	async completeDirectWrite(turnId: string, toolCallId: string, itemId: string, modelId: string | undefined): Promise<readonly ToolResultFileEditContent[]> {
		const write = this._directWrites.get(itemId);
		this._directWrites.delete(itemId);
		if (!write) {
			return [];
		}
		try {
			await this._tracker.completeEdit(write.path);
			const edit = await this._tracker.takeCompletedEdit(turnId, toolCallId, write.path, 'write_file', { path: write.path, contents: write.contents }, modelId);
			return edit ? [edit] : [];
		} catch (error) {
			this._logService.warn(`[CodexFileEditObserver] Failed to complete write_file ${write.path}: ${error instanceof Error ? error.message : String(error)}`);
			return [];
		}
	}

	abandonDirectWrite(itemId: string): void {
		const write = this._directWrites.get(itemId);
		this._directWrites.delete(itemId);
		if (write) {
			this._tracker.abandonEdit(write.path);
		}
	}

	private _ensureFile(itemId: string, workingDirectory: URI | undefined, filePath: string, change?: FileUpdateChange): IObservedFileEdit {
		let item = this._items.get(itemId);
		if (!item) {
			item = new Map();
			this._items.set(itemId, item);
		}
		const path = isAbsolute(filePath) ? filePath : resolve(workingDirectory?.fsPath ?? process.cwd(), filePath);
		const movePath = change?.kind.type === 'update' ? change.kind.move_path ?? undefined : undefined;
		const afterPath = movePath
			? (isAbsolute(movePath) ? movePath : resolve(workingDirectory?.fsPath ?? process.cwd(), movePath))
			: undefined;
		const omitBefore = change?.kind.type === 'add';
		const omitAfter = change?.kind.type === 'delete';
		let observed = item.get(path);
		if (!observed) {
			observed = {
				path,
				afterPath,
				omitBefore,
				omitAfter,
				beforeText: this._readFile(path),
				start: this._tracker.trackEditStart(path),
			};
			item.set(path, observed);
		} else if (change) {
			observed.afterPath = afterPath ?? observed.afterPath;
			observed.omitBefore = omitBefore;
			observed.omitAfter = omitAfter;
		}
		return observed;
	}

	private async _readFile(path: string): Promise<string> {
		try {
			return (await this._fileService.readFile(URI.file(path))).value.toString();
		} catch {
			return '';
		}
	}

	override dispose(): void {
		this._items.clear();
		this._shellItems.clear();
		this._directWrites.clear();
		this._turnDiffRevisions.clear();
		this._database.dispose();
		super.dispose();
	}
}

function mayMutateFiles(command: string): boolean {
	return /(?:apply_patch|writeall(?:text|lines)|set-content|add-content|out-file|new-item|remove-item|rename-item|move-item|copy-item|\b(?:rm|mv|cp|touch|mkdir|tee|sed|perl)\b|(?:^|[^>])>{1,2}(?!=)|writeFile|appendFile|rename\(|unlink\(|mkdir\(|shutil\.|pathlib\.)/i.test(command);
}

/** Best-effort extraction of text-file paths embedded in a shell command. */
export function shellCommandFileCandidates(command: string, cwd: string): readonly string[] {
	const values = new Set<string>();
	const patterns = [
		/[A-Za-z]:[\\/][^'"`\r\n;|<>]+/g,
		/\.\.?[\\/][^'"`\r\n;|<>),]+/g,
		/(?:[\w@().-]+[\\/])+[\w@().-]+\.[A-Za-z0-9_-]{1,16}/g,
	];
	for (const pattern of patterns) {
		for (const match of command.matchAll(pattern)) {
			let value = match[0].trim().replace(/[),\]}]+$/, '').trim();
			if (!value || value.includes('$') || value.includes('*') || value.includes('?')) {
				continue;
			}
			value = isAbsolute(value) ? value : resolve(cwd, value);
			values.add(value);
		}
	}
	return [...values];
}

function distinctPaths(paths: readonly string[]): string[] {
	return [...new Set(paths.map(path => resolve(path)))];
}

export async function readShellSnapshot(path: string): Promise<IShellFileSnapshot> {
	try {
		const stat = await fs.stat(path);
		if (!stat.isFile()) {
			return { existed: false, content: '', skippedContent: false, size: 0, mtimeMs: 0 };
		}
		if (stat.size > shellSnapshotMaxFileBytes) {
			return { existed: true, content: '', skippedContent: true, size: stat.size, mtimeMs: stat.mtimeMs };
		}
		const buffer = await fs.readFile(path);
		if (buffer.includes(0)) {
			return { existed: true, content: '', skippedContent: true, size: stat.size, mtimeMs: stat.mtimeMs };
		}
		return { existed: true, content: buffer.toString('utf8'), skippedContent: false, size: stat.size, mtimeMs: stat.mtimeMs };
	} catch {
		return { existed: false, content: '', skippedContent: false, size: 0, mtimeMs: 0 };
	}
}

export async function snapshotDirectory(root: string, snapshots: Map<string, IShellFileSnapshot>, maxFiles: number, maxBytes: number): Promise<{ files: number; bytes: number }> {
	let files = 0;
	let bytes = 0;
	const pending = [root];
	while (pending.length > 0 && files < maxFiles && bytes < maxBytes) {
		const directory = pending.pop()!;
		let entries: import('fs').Dirent[];
		try {
			entries = await fs.readdir(directory, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (files >= maxFiles || bytes >= maxBytes) {
				break;
			}
			const path = resolve(directory, entry.name);
			if (entry.isDirectory()) {
				if (!shellSnapshotIgnoredDirectories.has(entry.name.toLowerCase())) {
					pending.push(path);
				}
				continue;
			}
			if (!entry.isFile() || snapshots.has(path)) {
				continue;
			}
			const snapshot = await readShellSnapshot(path);
			if (!snapshot.existed) {
				continue;
			}
			if (snapshot.skippedContent) {
				snapshots.set(path, snapshot);
				files++;
				continue;
			}
			const size = snapshot.size || Buffer.byteLength(snapshot.content, 'utf8');
			if (bytes + size > maxBytes) {
				break;
			}
			snapshots.set(path, snapshot);
			files++;
			bytes += size;
		}
	}
	return { files, bytes };
}

export async function resolveTurnDiffPath(
	relativePath: string,
	afterExists: boolean,
	workingDirectories: readonly URI[],
	exists: (candidate: string) => Promise<boolean>,
): Promise<string> {
	const roots = workingDirectories.length > 0 ? workingDirectories : [URI.file(process.cwd())];
	for (const root of roots) {
		const rootName = basename(root.fsPath);
		const relativeToRoot = relativePath.startsWith(`${rootName}/`) ? relativePath.slice(rootName.length + 1) : relativePath;
		const candidate = resolve(root.fsPath, relativeToRoot);
		if (!afterExists || await exists(candidate)) {
			return candidate;
		}
	}
	return resolve(roots[0].fsPath, relativePath);
}

export interface ICodexTurnDiffFile {
	readonly path: string;
	readonly beforeExisted: boolean;
	readonly afterExists: boolean;
	readonly patch: string;
}

/** Splits the cumulative git-style diff published by `turn/diff/updated`. */
export function parseGitTurnDiff(diff: string): readonly ICodexTurnDiffFile[] {
	const starts: number[] = [];
	const pattern = /^diff --git /gm;
	for (let match = pattern.exec(diff); match; match = pattern.exec(diff)) {
		starts.push(match.index);
	}
	const files: ICodexTurnDiffFile[] = [];
	for (let index = 0; index < starts.length; index++) {
		const section = diff.slice(starts[index], starts[index + 1] ?? diff.length);
		const beforeMarker = /^--- (.+)$/m.exec(section)?.[1];
		const afterMarker = /^\+\+\+ (.+)$/m.exec(section)?.[1];
		if (!beforeMarker || !afterMarker) {
			continue;
		}
		const beforePath = normalizeGitDiffPath(beforeMarker);
		const afterPath = normalizeGitDiffPath(afterMarker);
		const beforeExisted = beforePath !== undefined;
		const afterExists = afterPath !== undefined;
		const path = afterPath ?? beforePath;
		if (path) {
			files.push({ path, beforeExisted, afterExists, patch: section });
		}
	}
	return files;
}

function normalizeGitDiffPath(marker: string): string | undefined {
	const value = marker.split('\t', 1)[0].trim();
	if (value === '/dev/null') {
		return undefined;
	}
	const unquoted = value.startsWith('"') && value.endsWith('"')
		? value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
		: value;
	return unquoted.replace(/^[ab]\//, '');
}

/** Reverses unified hunks so they can be applied to the on-disk after-state. */
export function invertUnifiedDiff(diff: string): string {
	const result: string[] = [];
	let inHunk = false;
	for (const line of diff.split('\n')) {
		const header = /^@@ -(\d+)(,\d+)? \+(\d+)(,\d+)? @@(.*)$/.exec(line);
		if (header) {
			inHunk = true;
			result.push(`@@ -${header[3]}${header[4] ?? ''} +${header[1]}${header[2] ?? ''} @@${header[5]}`);
		} else if (inHunk && line.startsWith('+')) {
			result.push(`-${line.slice(1)}`);
		} else if (inHunk && line.startsWith('-')) {
			result.push(`+${line.slice(1)}`);
		} else if (inHunk) {
			result.push(line);
		}
	}
	return result.join('\n');
}

/** Build the right-hand diff content without writing to the workspace. Fails closed on a mismatched patch. */
export function previewFileChange(beforeText: string, change: FileUpdateChange): IFileChangePreview {
	switch (change.kind.type) {
		case 'add':
			return { ok: true, after: change.diff, omitBefore: true, omitAfter: false };
		case 'delete':
			return { ok: true, after: '', omitBefore: false, omitAfter: true };
		case 'update': {
			const after = applyUnifiedDiff(beforeText, stripMoveTrailer(change.diff, change.kind.move_path));
			if (after === undefined) {
				return { ok: false, reason: LIVE_PREVIEW_UNAVAILABLE_MESSAGE };
			}
			return {
				ok: true,
				after,
				afterPath: change.kind.move_path ?? undefined,
				omitBefore: false,
				omitAfter: false,
			};
		}
	}
}

function stripMoveTrailer(diff: string, movePath: string | null): string {
	if (!movePath) {
		return diff;
	}
	const trailer = `\n\nMoved to: ${movePath}`;
	return diff.endsWith(trailer) ? diff.slice(0, -trailer.length) : diff;
}

function splitPatchLines(text: string): string[] {
	if (text === '') {
		return [];
	}
	const endsWithNewline = text.endsWith('\n');
	const lines = text.split(/\r?\n/);
	if (endsWithNewline) {
		lines.pop();
	}
	return lines;
}

function stripCarriageReturn(value: string): string {
	return value.endsWith('\r') ? value.slice(0, -1) : value;
}

/**
 * Applies the hunk form emitted by Codex's `FileUpdateChange.diff`.
 * Context and deleted lines must match the baseline; any mismatch returns `undefined`
 * instead of a guessed after-state.
 */
export function applyUnifiedDiff(original: string, diff: string): string | undefined {
	const newline = original.includes('\r\n') ? '\r\n' : '\n';
	const originalEndsWithNewline = original.endsWith('\n');
	const originalLines = splitPatchLines(original);
	const diffLines = diff.split('\n');
	const result: string[] = [];
	let originalIndex = 0;
	let sawHunk = false;
	let afterEndsWithNewline = originalEndsWithNewline;

	const lineEquals = (actual: string | undefined, expected: string): boolean => {
		return actual !== undefined && stripCarriageReturn(actual) === stripCarriageReturn(expected);
	};

	for (let index = 0; index < diffLines.length; index++) {
		const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(diffLines[index]);
		if (!header) {
			continue;
		}
		sawHunk = true;
		const oldStart = Number(header[1]);
		const oldCount = header[2] !== undefined ? Number(header[2]) : (oldStart === 0 ? 0 : 1);
		const hunkStart = oldStart === 0 ? 0 : oldStart - 1;
		if (hunkStart < originalIndex || hunkStart > originalLines.length) {
			return undefined;
		}
		result.push(...originalLines.slice(originalIndex, hunkStart));
		originalIndex = hunkStart;
		let consumedOld = 0;
		let previousContributedToAfter = false;
		for (index++; index < diffLines.length && !diffLines[index].startsWith('@@ '); index++) {
			const line = diffLines[index];
			if (line === '\\ No newline at end of file') {
				if (previousContributedToAfter) {
					afterEndsWithNewline = false;
				}
				continue;
			}
			if (line.startsWith(' ')) {
				const expected = line.slice(1);
				if (!lineEquals(originalLines[originalIndex], expected)) {
					return undefined;
				}
				result.push(originalLines[originalIndex]);
				originalIndex++;
				consumedOld++;
				previousContributedToAfter = true;
				afterEndsWithNewline = true;
			} else if (line.startsWith('-')) {
				const expected = line.slice(1);
				if (!lineEquals(originalLines[originalIndex], expected)) {
					return undefined;
				}
				originalIndex++;
				consumedOld++;
				previousContributedToAfter = false;
			} else if (line.startsWith('+')) {
				result.push(line.slice(1));
				previousContributedToAfter = true;
				afterEndsWithNewline = true;
			} else if (line === '' && index === diffLines.length - 1) {
				continue;
			} else {
				return undefined;
			}
		}
		if (header[2] !== undefined && consumedOld !== oldCount) {
			return undefined;
		}
		index--;
	}
	if (!sawHunk) {
		return undefined;
	}
	const leftover = originalLines.slice(originalIndex);
	result.push(...leftover);
	if (leftover.length > 0) {
		afterEndsWithNewline = originalEndsWithNewline;
	}
	return result.join(newline) + (afterEndsWithNewline ? newline : '');
}
