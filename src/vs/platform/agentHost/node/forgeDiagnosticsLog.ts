/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { appendFileSync, mkdirSync, statSync } from 'fs';
import { appendFile, rename, unlink } from 'fs/promises';
import { createHash } from 'crypto';
import { join } from '../../../base/common/path.js';
import { URI } from '../../../base/common/uri.js';
import { formatForgeLocalTimestamp, getForgeTimeZone } from '../../environment/common/forgeLogSession.js';

export type ForgeDiagnosticChannel = 'timeline' | 'chat' | 'agent' | 'tools' | 'files' | 'terminal' | 'protocol' | 'errors' | 'summary';

const CHANNEL_FILES: Record<ForgeDiagnosticChannel, string> = {
	timeline: '01-timeline.txt',
	chat: '20-chat.txt',
	agent: '30-agent.txt',
	tools: '40-tools.txt',
	files: '50-files.txt',
	terminal: '60-terminal.txt',
	protocol: '70-protocol.txt',
	errors: '90-errors.txt',
	summary: '99-summary.txt',
};

const SECRET_KEY = /(?:authorization|cookie|password|passwd|secret|token|api[-_]?key|private[-_]?key|client[-_]?secret|credential)/i;
const SECRET_VALUE_PATTERNS = [
	/\b(authorization|cookie|password|passwd|secret|access[-_]?token|refresh[-_]?token|api[-_]?key|client[-_]?secret)\b(\s*[:=]\s*)(?:Bearer\s+[A-Za-z0-9._~+/=-]{8,}|"[^"]*"|'[^']*'|[^\s,;}]+)/gi,
	/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
	/\b(?:sk|sess|ghp|github_pat|xox[abprs])[-_][A-Za-z0-9._-]{8,}/gi,
	/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

const MAX_VALUE_CHARS = 256 * 1024;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_ROTATED_FILES = 2;
const ANSI_ESCAPE_PATTERN = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

let activeForgeDiagnosticsLog: ForgeDiagnosticsLog | undefined;

export function setActiveForgeDiagnosticsLog(log: ForgeDiagnosticsLog | undefined): void {
	activeForgeDiagnosticsLog = log;
}

export function getActiveForgeDiagnosticsLog(): ForgeDiagnosticsLog | undefined {
	return activeForgeDiagnosticsLog;
}

export function redactForgeDiagnosticValue(value: unknown, key?: string, seen = new Set<object>()): unknown {
	if (key && SECRET_KEY.test(key)) {
		return '<redacted>';
	}
	if (typeof value === 'string') {
		const compactBase64 = value.replace(/\s/g, '');
		if (compactBase64.length >= 1_024 && compactBase64.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(compactBase64)) {
			return `<base64 omitted chars=${value.length} sha256=${createHash('sha256').update(value).digest('hex')}>`;
		}
		let redacted = value;
		for (let index = 0; index < SECRET_VALUE_PATTERNS.length; index++) {
			const pattern = SECRET_VALUE_PATTERNS[index];
			redacted = index === 0
				? redacted.replace(pattern, '$1$2<redacted>')
				: redacted.replace(pattern, '<redacted>');
		}
		return redacted.length > MAX_VALUE_CHARS ? `${redacted.slice(0, MAX_VALUE_CHARS)}\n<clipped ${redacted.length - MAX_VALUE_CHARS} chars>` : redacted;
	}
	if (!value || typeof value !== 'object') {
		return value;
	}
	if (ArrayBuffer.isView(value)) {
		const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
		return `<binary omitted bytes=${bytes.byteLength} sha256=${createHash('sha256').update(bytes).digest('hex')}>`;
	}
	if (value instanceof ArrayBuffer) {
		const bytes = Buffer.from(value);
		return `<binary omitted bytes=${bytes.byteLength} sha256=${createHash('sha256').update(bytes).digest('hex')}>`;
	}
	if (seen.has(value)) {
		return '<circular>';
	}
	seen.add(value);
	try {
		if (Array.isArray(value)) {
			return value.map(item => redactForgeDiagnosticValue(item, undefined, seen));
		}
		const result: Record<string, unknown> = {};
		for (const [childKey, childValue] of Object.entries(value)) {
			result[childKey] = redactForgeDiagnosticValue(childValue, childKey, seen);
		}
		return result;
	} finally {
		seen.delete(value);
	}
}

function compactJson(value: unknown): string {
	try {
		return JSON.stringify(redactForgeDiagnosticValue(value));
	} catch (error) {
		return JSON.stringify({ serializationError: String(error) });
	}
}

interface IBufferedStream {
	readonly channel: ForgeDiagnosticChannel;
	readonly type: string;
	readonly context: Record<string, unknown>;
	content: string;
	timer: ReturnType<typeof setTimeout>;
}

/**
 * Compact, append-only diagnostics owned by Forge. It is deliberately independent of every
 * model/provider: the application records events it observes instead of asking a model to log.
 */
export class ForgeDiagnosticsLog {
	private readonly _directory: string;
	private readonly _timeZone = getForgeTimeZone();
	private readonly _started = Date.now();
	private readonly _queues = new Map<string, string[]>();
	private readonly _streams = new Map<string, IBufferedStream>();
	private readonly _latestText = new Map<string, IBufferedStream>();
	private _flushTimer: ReturnType<typeof setTimeout> | undefined;
	private _flushPromise: Promise<void> = Promise.resolve();
	private _sequence = 0;
	private _disposed = false;

	constructor(logsHome: URI, private readonly _source = 'agent-host') {
		this._directory = logsHome.fsPath;
		mkdirSync(this._directory, { recursive: true });
		for (const [channel, file] of Object.entries(CHANNEL_FILES)) {
			const path = join(this._directory, file);
			try {
				if (statSync(path).size > 0) {
					continue;
				}
			} catch {
				// Create below.
			}
			appendFileSync(path, `# FORGE ${channel.toUpperCase()} LOG | source=${this._source} | encoding=utf-8\n`, 'utf8');
		}
		this.record('timeline', 'PROCESS.READY', { pid: process.pid, source: this._source });
	}

	record(channel: ForgeDiagnosticChannel, type: string, data?: unknown, context: Record<string, unknown> = {}): string {
		if (this._disposed) {
			return '';
		}
		const now = new Date();
		const id = `R-${this._source}-${String(++this._sequence).padStart(6, '0')}`;
		const elapsed = Date.now() - this._started;
		const fields = Object.keys(context).length ? ` | context=${compactJson(context)}` : '';
		const payload = data === undefined ? '' : ` | data=${compactJson(data)}`;
		this._enqueue(CHANNEL_FILES[channel], `${formatForgeLocalTimestamp(now, this._timeZone)} | +${elapsed}ms | ${id} | ${type}${fields}${payload}\n`);
		return id;
	}

	recordText(channel: ForgeDiagnosticChannel, type: string, content: string, context: Record<string, unknown> = {}): string {
		if (this._disposed) {
			return '';
		}
		const id = this.record(channel, `${type}.BEGIN`, { chars: content.length }, context);
		const tag = type.replace(/[^A-Za-z0-9_.-]/g, '_').toUpperCase();
		const safe = String(redactForgeDiagnosticValue(content));
		this._enqueue(CHANNEL_FILES[channel], `@@BEGIN ${tag} id=${id}\n${safe}\n@@END ${tag} id=${id}\n`);
		return id;
	}

	/** Coalesces fast provider chunks so one streamed answer does not create thousands of lines. */
	recordStream(channel: ForgeDiagnosticChannel, streamKey: string, type: string, content: string, context: Record<string, unknown> = {}): void {
		if (!content || this._disposed) {
			return;
		}
		if (channel === 'terminal') {
			content = content.replace(ANSI_ESCAPE_PATTERN, '');
		}
		const existing = this._streams.get(streamKey);
		if (existing) {
			existing.content += content;
			if (existing.content.length >= 16 * 1024) {
				this._flushStream(streamKey);
			}
			return;
		}
		const stream: IBufferedStream = {
			channel,
			type,
			context,
			content,
			timer: setTimeout(() => this._flushStream(streamKey), 250),
		};
		this._streams.set(streamKey, stream);
	}

	/** Debounces cumulative snapshots (notably live diffs), keeping only the latest pending value. */
	recordLatestText(channel: ForgeDiagnosticChannel, streamKey: string, type: string, content: string, context: Record<string, unknown> = {}): void {
		if (this._disposed) {
			return;
		}
		const existing = this._latestText.get(streamKey);
		if (existing) {
			clearTimeout(existing.timer);
		}
		const latest: IBufferedStream = {
			channel,
			type,
			context,
			content,
			timer: setTimeout(() => this._flushLatestText(streamKey), 500),
		};
		this._latestText.set(streamKey, latest);
	}

	flushStreams(prefix?: string): void {
		for (const key of [...this._streams.keys()]) {
			if (!prefix || key.startsWith(prefix)) {
				this._flushStream(key);
			}
		}
	}

	flushLatestText(prefix?: string): void {
		for (const key of [...this._latestText.keys()]) {
			if (!prefix || key.startsWith(prefix)) {
				this._flushLatestText(key);
			}
		}
	}

	async flush(): Promise<void> {
		this.flushStreams();
		this.flushLatestText();
		if (this._flushTimer) {
			clearTimeout(this._flushTimer);
			this._flushTimer = undefined;
		}
		await this._scheduleFlush(true);
		await this._flushPromise;
	}

	dispose(): void {
		if (this._disposed) {
			return;
		}
		this.flushStreams();
		this.flushLatestText();
		this.record('summary', 'PROCESS.EXIT', { pid: process.pid });
		void this.flush();
		this._disposed = true;
		if (activeForgeDiagnosticsLog === this) {
			activeForgeDiagnosticsLog = undefined;
		}
	}

	private _flushStream(key: string): void {
		const stream = this._streams.get(key);
		if (!stream) {
			return;
		}
		clearTimeout(stream.timer);
		this._streams.delete(key);
		this.recordText(stream.channel, stream.type, stream.content, stream.context);
	}

	private _flushLatestText(key: string): void {
		const latest = this._latestText.get(key);
		if (!latest) {
			return;
		}
		clearTimeout(latest.timer);
		this._latestText.delete(key);
		this.recordText(latest.channel, latest.type, latest.content, latest.context);
	}

	private _enqueue(file: string, text: string): void {
		let queue = this._queues.get(file);
		if (!queue) {
			queue = [];
			this._queues.set(file, queue);
		}
		queue.push(text);
		if (!this._flushTimer) {
			this._flushTimer = setTimeout(() => {
				this._flushTimer = undefined;
				void this._scheduleFlush(false);
			}, 100);
		}
	}

	private async _scheduleFlush(force: boolean): Promise<void> {
		if (!force && this._queues.size === 0) {
			return;
		}
		const batches = [...this._queues].map(([file, chunks]) => [file, chunks.join('')] as const);
		this._queues.clear();
		this._flushPromise = this._flushPromise.then(async () => {
			for (const [file, text] of batches) {
				const path = join(this._directory, file);
				try {
					if (statSync(path).size + Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) {
						await this._rotate(path);
					}
				} catch {
					// Missing files are created by appendFile below.
				}
				await appendFile(path, text, 'utf8');
			}
		}).catch(error => console.error('[ForgeDiagnostics] Failed to flush diagnostic log', error));
		await this._flushPromise;
	}

	private async _rotate(path: string): Promise<void> {
		const rotatedPath = (index: number) => path.replace(/\.txt$/, `.${index}.txt`);
		try {
			await unlink(rotatedPath(MAX_ROTATED_FILES));
		} catch {
			// No oldest segment yet.
		}
		for (let index = MAX_ROTATED_FILES - 1; index >= 1; index--) {
			try {
				await rename(rotatedPath(index), rotatedPath(index + 1));
			} catch {
				// No segment at this index yet.
			}
		}
		await rename(path, rotatedPath(1));
	}
}
