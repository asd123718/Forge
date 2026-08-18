/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { dirname, isAbsolute, join, normalize } from '../../../../base/common/path.js';
import { extUriBiasedIgnorePathCase } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../files/common/files.js';
import type { ToolDefinition } from '../../common/state/protocol/state.js';
import type { IServerToolDisplay, IServerToolDisplayResult } from '../shared/agentServerToolHost.js';

/**
 * Host-side JSON function that writes a complete workspace file in one call.
 *
 * Official Codex models already have a native freeform `apply_patch` tool.
 * Custom models (DeepSeek, etc.) do not — they were told to invoke `apply_patch`
 * through `shell_command`, which on Windows goes through `apply_patch.bat` and
 * CreateProcess argv. That path cannot carry a large or quote-heavy file, so
 * the model split writes and retried a failing tool. This function tool puts
 * the file body in the tool-call JSON instead of a process command line.
 *
 * Named `write_file` on purpose: advertising a second tool named `apply_patch`
 * panics Codex's registry when the model already has the native freeform tool.
 */
export const CODEX_WRITE_FILE_TOOL_NAME = 'write_file';

export const writeFileToolDefinition: ToolDefinition = {
	name: CODEX_WRITE_FILE_TOOL_NAME,
	title: 'Write File',
	description: [
		'Create or replace one workspace text file with its complete contents in a single call.',
		'Always send the entire file. Never split one file across multiple writes, and never invoke apply_patch, apply_patch.bat, or `codex.exe --codex-run-as-apply-patch` through shell_command — those Windows wrappers fail on large or quoted patches.',
		'Use shell_command only to read, search, test, or build.',
	].join(' '),
	inputSchema: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Workspace-relative or absolute path of the file to create or replace.',
			},
			contents: {
				type: 'string',
				description: 'The complete file contents. Include the whole file in this one argument.',
			},
		},
		required: ['path', 'contents'],
	},
	annotations: { readOnlyHint: false },
};

export function getWriteFileToolDisplay(toolName: string, args?: unknown, result?: IServerToolDisplayResult): IServerToolDisplay | undefined {
	if (toolName !== CODEX_WRITE_FILE_TOOL_NAME) {
		return undefined;
	}
	const path = typeof args === 'object' && args !== null && typeof (args as { path?: unknown }).path === 'string'
		? (args as { path: string }).path
		: undefined;
	const target = path ? `\`${path}\`` : 'file';
	return {
		displayName: localize('codex.writeFile.displayName', "Write File"),
		invocationMessage: localize('codex.writeFile.invocation', "Writing {0}", target),
		pastTenseMessage: result?.success === false
			? localize('codex.writeFile.failed', "Failed to write {0}", target)
			: localize('codex.writeFile.pastTense', "Wrote {0}", target),
	};
}

export function parseWriteFileArgs(rawArgs: unknown): { path: string; contents: string } {
	if (typeof rawArgs !== 'object' || rawArgs === null) {
		throw new Error('Invalid write_file input: expected an object with path and contents.');
	}
	const args = rawArgs as { path?: unknown; file_path?: unknown; contents?: unknown; content?: unknown };
	const path = readRequiredString(args.path ?? args.file_path, 'path');
	const contentsValue = args.contents ?? args.content;
	if (typeof contentsValue !== 'string') {
		throw new Error('Invalid write_file input: contents must be a string containing the complete file.');
	}
	return { path, contents: contentsValue };
}

export function resolveWritableWorkspacePath(requested: string, roots: readonly URI[]): URI {
	const trimmed = requested.trim();
	if (!trimmed) {
		throw new Error('Invalid write_file input: path must be a non-empty string.');
	}
	if (roots.length === 0) {
		throw new Error('write_file cannot run: this session has no workspace folder.');
	}
	const candidate = toFileUri(trimmed, roots[0]);
	const normalized = URI.file(normalize(candidate.fsPath));
	const inside = roots.some(root => extUriBiasedIgnorePathCase.isEqualOrParent(normalized, URI.file(normalize(root.fsPath))));
	if (!inside) {
		throw new Error(`write_file path must stay inside the workspace: ${trimmed}`);
	}
	return normalized;
}

export async function applyWriteFileTool(fileService: IFileService, roots: readonly URI[], rawArgs: unknown): Promise<string> {
	const { path, contents } = parseWriteFileArgs(rawArgs);
	const target = resolveWritableWorkspacePath(path, roots);
	await fileService.createFolder(URI.file(dirname(target.fsPath)));
	await fileService.writeFile(target, VSBuffer.fromString(contents));
	return `Wrote ${target.fsPath} (${contents.length} characters).`;
}

function readRequiredString(value: unknown, field: string): string {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`Invalid write_file input: ${field} must be a non-empty string.`);
	}
	return value;
}

function toFileUri(requested: string, cwd: URI): URI {
	if (/^file:/i.test(requested)) {
		return URI.parse(requested);
	}
	return URI.file(isAbsolute(requested) ? requested : join(cwd.fsPath, requested));
}
