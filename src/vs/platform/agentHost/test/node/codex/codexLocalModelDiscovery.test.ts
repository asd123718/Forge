/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CodexLocalModelDiscoveryError, discoverCodexLocalModels } from '../../../node/codex/codexLocalModelDiscovery.js';
import { ollamaTagsUrl, parseOllamaListOutput, parseOllamaTagsJson } from '../../../../native/common/ollamaList.js';

suite('Codex local model discovery', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('discovers Ollama models from its native API', async () => {
		let requestedUrl = '';
		const models = await discoverCodexLocalModels('ollama', 'http://localhost:11434/v1', async input => {
			requestedUrl = String(input);
			return new Response(JSON.stringify({ models: [{ name: 'qwen3-coder' }, { model: 'gpt-oss:20b' }] }), { status: 200 });
		});
		assert.strictEqual(requestedUrl, 'http://localhost:11434/api/tags');
		assert.deepStrictEqual(models, [
			{ id: 'qwen3-coder', name: 'qwen3-coder' },
			{ id: 'gpt-oss:20b', name: 'gpt-oss:20b' },
		]);
	});

	test('discovers LM Studio model metadata', async () => {
		const models = await discoverCodexLocalModels('lmstudio', 'http://localhost:1234/v1/', async input => {
			assert.strictEqual(String(input), 'http://localhost:1234/api/v0/models');
			return new Response(JSON.stringify({ data: [{ id: 'local/model', max_context_length: 32768 }] }), { status: 200 });
		});
		assert.deepStrictEqual(models, [{ id: 'local/model', name: 'local/model', contextWindow: 32768 }]);
	});

	test('classifies authentication errors', async () => {
		await assert.rejects(
			() => discoverCodexLocalModels('lmstudio', 'http://localhost:1234/v1', async () => new Response('', { status: 401 })),
			(error: unknown) => error instanceof CodexLocalModelDiscoveryError && error.kind === 'unauthorized',
		);
	});

	test('parses ollama list table output', () => {
		const names = parseOllamaListOutput([
			'NAME                       ID              SIZE      MODIFIED',
			'llama3.2:latest            abc123          2.0 GB    2 weeks ago',
			'qwen2.5:7b                 def456          4.7 GB    3 days ago',
		].join('\n'));
		assert.deepStrictEqual(names, ['llama3.2:latest', 'qwen2.5:7b']);
	});

	test('parses ollama list names that contain slashes', () => {
		const names = parseOllamaListOutput([
			'NAME                                 ID              SIZE     MODIFIED',
			'huihui_ai/Qwen3.6-abliterated:27b    418838acbea7    17 GB    3 days ago',
		].join('\n'));
		assert.deepStrictEqual(names, ['huihui_ai/Qwen3.6-abliterated:27b']);
	});

	test('parses ollama /api/tags JSON', () => {
		assert.strictEqual(ollamaTagsUrl('http://localhost:11434/v1'), 'http://localhost:11434/api/tags');
		assert.deepStrictEqual(parseOllamaTagsJson({
			models: [{ name: 'huihui_ai/Qwen3.6-abliterated:27b', model: 'huihui_ai/Qwen3.6-abliterated:27b' }],
		}), ['huihui_ai/Qwen3.6-abliterated:27b']);
	});
});
