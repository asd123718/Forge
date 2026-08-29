/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, EventType, onDidRegisterWindow } from '../../../../base/browser/dom.js';
import { CodeWindow, mainWindow } from '../../../../base/browser/window.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { joinPath } from '../../../../base/common/resources.js';
import { formatForgeLocalTimestamp, getForgeTimeZone } from '../../../../platform/environment/common/forgeLogSession.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { FileOperation, IFileService } from '../../../../platform/files/common/files.js';
import { ILogger, ILoggerService } from '../../../../platform/log/common/log.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';

const CREDENTIAL_PATTERN = /(?:Bearer\s+|(?:sk|sess|ghp|github_pat|xox[abprs])[-_])[A-Za-z0-9._~+/=-]{8,}/gi;
const CREDENTIAL_ASSIGNMENT_PATTERN = /\b(authorization|cookie|password|passwd|secret|access[-_]?token|refresh[-_]?token|api[-_]?key|client[-_]?secret)\b(\s*[:=]\s*)(?:Bearer\s+[A-Za-z0-9._~+/=-]{8,}|"[^"]*"|'[^']*'|[^\s,;}]+)/gi;

function safeText(value: unknown): string {
	return String(value).replace(CREDENTIAL_ASSIGNMENT_PATTERN, '$1$2<redacted>').replace(CREDENTIAL_PATTERN, '<redacted>').replace(/[\r\n]+/g, ' ').slice(0, 2_048);
}

function fileOperationName(operation: FileOperation): string {
	switch (operation) {
		case FileOperation.CREATE: return 'CREATE';
		case FileOperation.DELETE: return 'DELETE';
		case FileOperation.MOVE: return 'MOVE';
		case FileOperation.COPY: return 'COPY';
		case FileOperation.WRITE: return 'WRITE';
	}
}

export function describeForgeUiTarget(target: EventTarget | null): string {
	if (!target || typeof (target as HTMLElement).closest !== 'function') {
		return 'unknown';
	}
	const element = target as HTMLElement;
	const semantic = element.closest<HTMLElement>('[data-forge-log-id], [data-action-id], [aria-label], [title], button, a, input, [role]') ?? element;
	const attributes = [
		semantic.dataset['forgeLogId'],
		semantic.dataset['actionId'],
		semantic.getAttribute('aria-label'),
		semantic.getAttribute('title'),
		semantic.getAttribute('role'),
	].filter((value): value is string => !!value);
	const classes = [...semantic.classList].filter(name => /(?:action|button|codicon|forge|chat|tab|monaco)/i.test(name)).slice(0, 4).join('.');
	const suffix = classes ? `.${classes}` : '';
	return safeText(`${semantic.tagName.toLowerCase()}${suffix}${attributes.length ? ` label=${attributes.join('/')}` : ''}`);
}

/** Workbench-side semantic UI diagnostics. Values typed into controls are never observed. */
class ForgeDiagnosticsContribution extends Disposable {
	static readonly ID = 'workbench.contrib.forgeDiagnostics';
	private readonly _uiLogger: ILogger;
	private readonly _errorLogger: ILogger;
	private readonly _fileLogger: ILogger;
	private readonly _timeZone = getForgeTimeZone();
	private readonly _started = Date.now();
	private _sequence = 0;
	private _interactionSequence = 0;
	private _lastInteraction: { readonly id: string; readonly at: number } | undefined;
	private readonly _commandStarts = new Map<string, { readonly at: number; readonly trace?: string }>();

	constructor(
		@IEnvironmentService environmentService: IEnvironmentService,
		@ILoggerService loggerService: ILoggerService,
		@ICommandService commandService: ICommandService,
		@IFileService fileService: IFileService,
	) {
		super();
		this._uiLogger = this._register(loggerService.createLogger(joinPath(environmentService.logsHome, '10-ui.txt'), { id: 'forge-ui-diagnostics', name: 'Forge UI Diagnostics', hidden: true }));
		this._errorLogger = this._register(loggerService.createLogger(joinPath(environmentService.logsHome, '90-ui-errors.txt'), { id: 'forge-ui-errors', name: 'Forge UI Errors', hidden: true }));
		this._fileLogger = this._register(loggerService.createLogger(joinPath(environmentService.logsHome, '51-workbench-files.txt'), { id: 'forge-workbench-files', name: 'Forge Workbench File Operations', hidden: true }));
		this._write(this._uiLogger, 'UI.READY', `window=${mainWindow.vscodeWindowId}`);

		this._register(commandService.onWillExecuteCommand(event => {
			const trace = this._lastInteraction && Date.now() - this._lastInteraction.at <= 1_000 ? this._lastInteraction.id : undefined;
			this._commandStarts.set(event.commandId, { at: Date.now(), trace });
			this._write(this._uiLogger, 'COMMAND.WILL', `id=${safeText(event.commandId)} args.count=${event.args.length}${trace ? ` trace=${trace}` : ''}`);
		}));
		this._register(commandService.onDidExecuteCommand(event => {
			const start = this._commandStarts.get(event.commandId);
			this._commandStarts.delete(event.commandId);
			this._write(this._uiLogger, 'COMMAND.DID', `id=${safeText(event.commandId)}${start ? ` duration=${Date.now() - start.at}ms${start.trace ? ` trace=${start.trace}` : ''}` : ''}`);
		}));
		this._register(fileService.onDidRunOperation(event => {
			const operation = fileOperationName(event.operation);
			const target = event.target?.resource.toString();
			this._write(this._fileLogger, `FILE.${operation}`, `resource=${safeText(event.resource.toString())}${target ? ` target=${safeText(target)}` : ''}`);
		}));
		this._register(Event.runAndSubscribe(onDidRegisterWindow, ({ window, disposables }) => {
			this._registerWindow(window, disposables);
		}, { window: mainWindow, disposables: this._store }));
	}

	private _registerWindow(window: CodeWindow, disposables: { add<T extends { dispose(): void }>(disposable: T): T }): void {
		disposables.add(addDisposableListener(window.document, EventType.CLICK, (event: MouseEvent) => {
			const trace = `UI-${String(++this._interactionSequence).padStart(6, '0')}`;
			this._lastInteraction = { id: trace, at: Date.now() };
			this._write(this._uiLogger, 'UI.CLICK', `window=${window.vscodeWindowId} target=${describeForgeUiTarget(event.target)} via=mouse button=${event.button} trace=${trace}`);
		}, true));
		disposables.add(addDisposableListener(window, 'error', (event: ErrorEvent) => {
			this._write(this._errorLogger, 'UI.ERROR', `window=${window.vscodeWindowId} message=${safeText(event.message)} source=${safeText(event.filename)} line=${event.lineno} column=${event.colno} stack=${safeText(event.error?.stack ?? '')}`);
		}));
		disposables.add(addDisposableListener(window, 'unhandledrejection', (event: PromiseRejectionEvent) => {
			const reason = event.reason instanceof Error ? `${event.reason.message} ${event.reason.stack ?? ''}` : event.reason;
			this._write(this._errorLogger, 'UI.UNHANDLED_REJECTION', `window=${window.vscodeWindowId} reason=${safeText(reason)}`);
		}));
	}

	private _write(logger: ILogger, type: string, details: string): void {
		const now = new Date();
		const id = `R-renderer-${String(++this._sequence).padStart(6, '0')}`;
		logger.info(`${formatForgeLocalTimestamp(now, this._timeZone)} | +${Date.now() - this._started}ms | ${id} | ${type} | ${details}`);
	}
}

registerWorkbenchContribution2(ForgeDiagnosticsContribution.ID, ForgeDiagnosticsContribution, WorkbenchPhase.BlockStartup);
