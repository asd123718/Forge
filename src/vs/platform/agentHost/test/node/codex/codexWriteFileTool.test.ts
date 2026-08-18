/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { normalize } from '../../../../../base/common/path.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FileService } from '../../../../files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../log/common/log.js';
import { applyWriteFileTool, CODEX_WRITE_FILE_TOOL_NAME, getWriteFileToolDisplay, parseWriteFileArgs, resolveWritableWorkspacePath, writeFileToolDefinition } from '../../../node/codex/codexWriteFileTool.js';

suite('codexWriteFileTool', () => {

	const disposables = new DisposableStore();
	const workspace = URI.file('/workspace');
	let fileService: FileService;

	setup(() => {
		fileService = disposables.add(new FileService(new NullLogService()));
		disposables.add(fileService.registerProvider('file', disposables.add(new InMemoryFileSystemProvider())));
	});

	teardown(() => {
		disposables.clear();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	test('definition is a JSON function named write_file, not apply_patch', () => {
		assert.deepStrictEqual({
			name: writeFileToolDefinition.name,
			required: writeFileToolDefinition.inputSchema?.required,
		}, {
			name: CODEX_WRITE_FILE_TOOL_NAME,
			required: ['path', 'contents'],
		});
		assert.ok(writeFileToolDefinition.description?.includes('Never split one file'));
		assert.ok(writeFileToolDefinition.description?.includes('apply_patch.bat'));
	});

	test('parseWriteFileArgs accepts path/contents and file_path/content aliases', () => {
		assert.deepStrictEqual(parseWriteFileArgs({ path: 'game.js', contents: 'full file' }), { path: 'game.js', contents: 'full file' });
		assert.deepStrictEqual(parseWriteFileArgs({ file_path: 'a.ts', content: 'x' }), { path: 'a.ts', contents: 'x' });
		assert.throws(() => parseWriteFileArgs({ path: 'game.js' }), /contents must be a string/);
		assert.throws(() => parseWriteFileArgs({ contents: 'x' }), /path must be a non-empty string/);
	});

	test('resolveWritableWorkspacePath keeps relative and absolute paths inside the workspace', () => {
		const relative = resolveWritableWorkspacePath('src/game.js', [workspace]);
		const absolute = resolveWritableWorkspacePath(URI.joinPath(workspace, 'index.html').fsPath, [workspace]);
		assert.ok(relative.fsPath.replace(/\\/g, '/').endsWith('/workspace/src/game.js'));
		assert.strictEqual(normalize(absolute.fsPath), normalize(URI.joinPath(workspace, 'index.html').fsPath));
		assert.throws(() => resolveWritableWorkspacePath('../outside.js', [workspace]), /inside the workspace/);
		assert.throws(() => resolveWritableWorkspacePath('', [workspace]), /non-empty string/);
	});

	test('applyWriteFileTool writes the complete file in one call, including nested folders', async () => {
		await fileService.createFolder(workspace);

		const body = `${'line\n'.repeat(1200)}end`;
		const result = await applyWriteFileTool(fileService, [workspace], { path: 'src/game.js', contents: body });
		const written = await fileService.readFile(URI.joinPath(workspace, 'src/game.js'));
		assert.strictEqual(written.value.toString(), body);
		assert.ok(result.includes('1200') || result.includes(String(body.length)));
		assert.ok(result.startsWith('Wrote '));
	});

	test('applyWriteFileTool replaces an existing file instead of appending', async () => {
		const target = URI.joinPath(workspace, 'game.js');
		await fileService.createFolder(workspace);
		await fileService.writeFile(target, VSBuffer.fromString('old'));
		await applyWriteFileTool(fileService, [workspace], { path: 'game.js', contents: 'new complete file' });
		assert.strictEqual((await fileService.readFile(target)).value.toString(), 'new complete file');
	});

	test('getWriteFileToolDisplay names the target path', () => {
		const display = getWriteFileToolDisplay('write_file', { path: 'game.js', contents: 'x' }, { success: true });
		assert.strictEqual(display?.displayName, 'Write File');
		assert.ok(String(display?.invocationMessage).includes('game.js'));
		assert.ok(String(display?.pastTenseMessage).includes('game.js'));
		assert.strictEqual(getWriteFileToolDisplay('rename_chat'), undefined);
	});
});
