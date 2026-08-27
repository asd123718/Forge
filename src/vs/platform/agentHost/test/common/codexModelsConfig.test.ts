/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { allocateCodexProviderId, codexProviderSecretResource, codexProviderStoredApiKeyEnv, discoversCodexLocalModels, enabledCodexPickerModels, isEmptyCodexModelsConfig, listCodexModelCatalog, normalizeCodexModelsConfig, preferCodexModelsConfig } from '../../common/codexModelsConfig.js';

suite('Codex models configuration', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('normalizes provider authentication without retaining plaintext keys', () => {
		assert.deepStrictEqual(normalizeCodexModelsConfig({
			model: 'qwen3-coder',
			modelProvider: 'local-ollama',
			providers: [{
				id: ' local-ollama ',
				name: 'Local Ollama',
				baseUrl: 'http://localhost:11434/v1',
				envKey: codexProviderStoredApiKeyEnv('local-ollama'),
				kind: 'ollama',
				wireApi: 'responses',
			}],
		}), {
			model: 'qwen3-coder',
			modelProvider: 'local-ollama',
			activeProviderId: 'local-ollama',
			providers: [{
				id: 'local-ollama',
				catalogId: 'ollama',
				name: 'Local Ollama',
				baseUrl: 'http://localhost:11434/v1',
				envKey: 'FORGE_CODEX_PROVIDER_LOCAL_OLLAMA_API_KEY',
				kind: 'ollama',
				authMode: 'none',
				wireApi: 'responses',
				enabled: true,
				models: [],
				selectedModel: '',
			}],
		});
	});

	test('uses stable secret resource and environment names', () => {
		assert.strictEqual(codexProviderSecretResource('my provider'), 'https://forge.local/codex/model-provider/my%20provider');
		assert.strictEqual(codexProviderStoredApiKeyEnv('open-router'), 'FORGE_CODEX_PROVIDER_OPEN_ROUTER_API_KEY');
	});

	test('ignores empty model snapshots so toml can fill them in', () => {
		assert.strictEqual(isEmptyCodexModelsConfig({ model: '', modelProvider: '', providers: [] }), true);
		assert.deepStrictEqual(preferCodexModelsConfig(
			{ model: '', modelProvider: '', providers: [] },
			{
				model: '',
				modelProvider: 'forge-ollama',
				providers: [{ id: 'forge-ollama', catalogId: 'ollama', name: 'Ollama', kind: 'ollama' }],
			},
		)?.modelProvider, 'forge-ollama');
	});

	test('keeps saved models and enabled flags when switching providers', () => {
		const config = normalizeCodexModelsConfig({
			providers: [{
				id: 'openai',
				catalogId: 'openai',
				selectedModel: 'gpt-5.6',
				enabled: true,
				models: [{ name: 'gpt-5.6', enabled: true }, { name: 'gpt-4.1', enabled: false }],
			}, {
				id: 'ollama',
				catalogId: 'ollama',
				enabled: false,
				models: [{ name: 'qwen3-coder', enabled: true }],
			}],
		});
		assert.deepStrictEqual(enabledCodexPickerModels(config), [{ providerId: 'openai', name: 'gpt-5.6' }]);
		assert.strictEqual(allocateCodexProviderId('openai', config.providers.map(provider => provider.id)), 'openai-2');
	});

	test('lists model providers alphabetically by display name', () => {
		const labels = listCodexModelCatalog().map(entry => entry.label);
		assert.deepStrictEqual(labels, [...labels].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true })));
		assert.ok(labels.indexOf('Anthropic') < labels.indexOf('OpenAI'));
		assert.ok(labels.indexOf('DeepSeek') < labels.indexOf('Ollama'));
	});

	test('auto-detects local models only for Ollama', () => {
		assert.strictEqual(discoversCodexLocalModels('ollama'), true);
		assert.strictEqual(discoversCodexLocalModels('lmstudio'), false);
		assert.strictEqual(discoversCodexLocalModels('vllm'), false);
	});
});
