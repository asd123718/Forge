/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Forge diagnostic log session helpers. These deliberately live in the environment layer so
 * every process uses the exact same, Windows-safe session directory naming convention.
 */

function pad(value: number, width = 2): string {
	return String(value).padStart(width, '0');
}

export function getForgeTimeZone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local';
	} catch {
		return 'Local';
	}
}

export function formatForgeUtcOffset(date: Date, separator = ':'): string {
	const totalMinutes = -date.getTimezoneOffset();
	const sign = totalMinutes >= 0 ? '+' : '-';
	const absolute = Math.abs(totalMinutes);
	return `${sign}${pad(Math.floor(absolute / 60))}${separator}${pad(absolute % 60)}`;
}

export function formatForgeLocalTimestamp(date: Date, timeZone = getForgeTimeZone()): string {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)} ${formatForgeUtcOffset(date)} ${timeZone}`;
}

export function createForgeLogSessionName(date: Date = new Date(), timeZone = getForgeTimeZone()): string {
	const local = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
	const offset = `UTC${formatForgeUtcOffset(date, '-')}`;
	const safeZone = timeZone.replace(/[^a-zA-Z0-9._-]+/g, '-');
	const run = date.getTime().toString(36).slice(-7);
	return `${local}_${offset}_${safeZone}_run-${run}`;
}

/** Matches both Forge's detailed directories and the historical Code - OSS directory format. */
export function isForgeLogSessionName(name: string): boolean {
	return /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.\d{3}_UTC[+-]\d{2}-\d{2}_[a-zA-Z0-9._-]+_run-[a-z0-9]+$/.test(name)
		|| /^\d{8}T\d{6}$/.test(name);
}
