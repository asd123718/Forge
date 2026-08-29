/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mkdirSync, writeFileSync } from 'fs';
import { platform, arch, hostname } from 'os';
import { join } from '../../../base/common/path.js';
import { URI } from '../../../base/common/uri.js';
import { formatForgeLocalTimestamp, getForgeTimeZone } from '../common/forgeLogSession.js';

export interface IForgeStartupLogProduct {
	readonly nameLong?: string;
	readonly version?: string;
	readonly commit?: string;
}

/**
 * Creates the application-owned startup manifest before the regular logger is initialized.
 * Environment variable values and command-line arguments are intentionally excluded because
 * both frequently contain credentials.
 */
export function writeForgeStartupLog(logsHome: URI, product: IForgeStartupLogProduct, now = new Date()): void {
	try {
		const directory = logsHome.fsPath;
		mkdirSync(directory, { recursive: true });
		const timeZone = getForgeTimeZone();
		const lines = [
			'# FORGE STARTUP',
			`started.local=${formatForgeLocalTimestamp(now, timeZone)}`,
			`started.utc=${now.toISOString()}`,
			`timezone=${timeZone}`,
			`product=${product.nameLong ?? 'Forge'}`,
			`version=${product.version ?? 'unknown'}`,
			`commit=${product.commit ?? 'unknown'}`,
			`pid=${process.pid}`,
			`ppid=${process.ppid}`,
			`platform=${platform()}`,
			`arch=${arch()}`,
			`hostname=${hostname()}`,
			`locale=${Intl.DateTimeFormat().resolvedOptions().locale}`,
			`cwd=${process.cwd()}`,
			`executable=${process.execPath}`,
			`logs=${directory}`,
			`argv.count=${process.argv.length}`,
			'env.values=not-recorded',
			'argv.values=not-recorded',
			'ownership=Forge application instrumentation; models are never asked to write these logs',
			'reasoning=only provider-published reasoning summaries/events; hidden chain-of-thought is never collected',
			'redaction=credentials, tokens, cookies, passwords and private keys are replaced with <redacted>',
			'index=01 timeline; 10 UI; 20 chat; 30 agent; 40 tools; 50/51 files; 60 terminal; 70 protocol; 90 errors; 99 summary',
			'correlation=sort by detailed timestamp; use session, turn, toolCallId, commandId and R-* event identifiers',
			'',
		].join('\n');
		writeFileSync(join(directory, '00-startup.txt'), lines, { encoding: 'utf8', flag: 'wx' });
	} catch (error) {
		// Startup diagnostics must never prevent the IDE from starting. The regular logger may not
		// exist yet, so stderr is the only safe fallback at this point.
		console.error('[ForgeDiagnostics] Failed to write startup manifest', error);
	}
}
