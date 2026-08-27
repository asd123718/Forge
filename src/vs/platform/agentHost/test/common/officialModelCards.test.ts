/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { emptyCodexModelsConfig, normalizeCodexModelsConfig, withDefaultCodexRouting } from '../../common/codexModelsConfig.js';
import {
	OFFICIAL_CODEX_PROVIDER_ID,
	findOfficialModelProvider,
	isOfficialLockedModel,
	isOfficialQuotaExhausted,
	officialApiFallbackReady,
	removeOfficialModelProvider,
	resolveCodexOfficialRoute,
	shouldIncludeOfficialProviderInCodexPicker,
	upsertOfficialModelProvider,
} from '../../common/officialModelCards.js';

suite('Official model cards', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('adds an official card beside a manual card instead of replacing it', () => {
		const manual = normalizeCodexModelsConfig({
			providers: [{
				id: 'openai',
				catalogId: 'openai',
				name: 'OpenAI',
				enabled: true,
				models: [{ name: 'my-proxy-model', enabled: true }],
			}],
		});
		const next = upsertOfficialModelProvider(manual, 'codex', ['gpt-5.4', 'gpt-5.3-codex']);
		assert.strictEqual(next.providers.length, 2);
		assert.strictEqual(findOfficialModelProvider(next, 'codex')?.id, OFFICIAL_CODEX_PROVIDER_ID);
		assert.deepStrictEqual(next.providers.find(provider => provider.id === 'openai')?.models.map(model => model.name), ['my-proxy-model']);
		assert.deepStrictEqual(findOfficialModelProvider(next, 'codex')?.officialModels, ['gpt-5.4', 'gpt-5.3-codex']);
		assert.strictEqual(findOfficialModelProvider(next, 'codex')?.enabled, true);
		assert.strictEqual(findOfficialModelProvider(next, 'codex')?.baseUrl, '');
	});

	test('keeps extra user models and filled URL when refreshing official names', () => {
		const first = upsertOfficialModelProvider(emptyCodexModelsConfig(), 'grok', ['grok-4.6']);
		const withExtras = normalizeCodexModelsConfig({
			providers: first.providers.map(provider => provider.official ? {
				...provider,
				baseUrl: 'https://api.x.ai/v1',
				models: [...provider.models, { name: 'custom-grok', enabled: true }],
			} : provider),
		});
		const refreshed = upsertOfficialModelProvider(withExtras, 'grok', ['grok-4.6', 'grok-4']);
		const official = findOfficialModelProvider(refreshed, 'grok');
		assert.strictEqual(official?.baseUrl, 'https://api.x.ai/v1');
		assert.deepStrictEqual(official?.models.map(model => model.name), ['grok-4.6', 'grok-4', 'custom-grok']);
		assert.strictEqual(isOfficialLockedModel(official, 'grok-4'), true);
		assert.strictEqual(isOfficialLockedModel(official, 'custom-grok'), false);
	});

	test('removes only the official card for the signed-out vendor', () => {
		const both = upsertOfficialModelProvider(
			upsertOfficialModelProvider(emptyCodexModelsConfig(), 'codex', ['gpt-5.4']),
			'deepseek',
			['deepseek-chat'],
		);
		const after = removeOfficialModelProvider(both, 'codex');
		assert.strictEqual(findOfficialModelProvider(after, 'codex'), undefined);
		assert.ok(findOfficialModelProvider(after, 'deepseek'));
	});

	test('routes official Codex models through ChatGPT until quota is exhausted and BYOK is filled', () => {
		const config = upsertOfficialModelProvider(emptyCodexModelsConfig(), 'codex', ['gpt-5.4']);
		const official = findOfficialModelProvider(config, 'codex')!;
		const filled = normalizeCodexModelsConfig({
			providers: [{ ...official, baseUrl: 'https://api.openai.com/v1' }],
		});
		assert.deepStrictEqual(resolveCodexOfficialRoute({
			modelProvider: 'openai',
			modelId: 'gpt-5.4',
			config: filled,
			remainingPercent: 12,
			hasOfficialApiKey: true,
		}), { modelProvider: 'openai', modelId: 'gpt-5.4' });
		assert.deepStrictEqual(resolveCodexOfficialRoute({
			modelProvider: 'openai',
			modelId: 'gpt-5.4',
			config: filled,
			remainingPercent: 0,
			hasOfficialApiKey: true,
		}), { modelProvider: OFFICIAL_CODEX_PROVIDER_ID, modelId: 'gpt-5.4' });
		assert.deepStrictEqual(resolveCodexOfficialRoute({
			modelProvider: 'openai',
			modelId: 'gpt-5.4',
			config: filled,
			remainingPercent: 0,
			hasOfficialApiKey: false,
		}), { modelProvider: 'openai', modelId: 'gpt-5.4' });
		assert.strictEqual(isOfficialQuotaExhausted(0), true);
		assert.strictEqual(isOfficialQuotaExhausted(1), false);
		assert.strictEqual(officialApiFallbackReady(findOfficialModelProvider(filled, 'codex'), true), true);
	});

	test('does not use empty official cards as the Codex default provider', () => {
		const config = upsertOfficialModelProvider(normalizeCodexModelsConfig({
			providers: [{
				id: 'ollama',
				catalogId: 'ollama',
				name: 'Ollama',
				baseUrl: 'http://localhost:11434/v1',
				enabled: true,
				models: [{ name: 'qwen3-coder', enabled: true }],
			}],
		}), 'codex', ['gpt-5.4']);
		const routed = withDefaultCodexRouting(config);
		assert.strictEqual(routed.modelProvider, 'ollama');
		assert.strictEqual(routed.model, 'qwen3-coder');
	});

	test('keeps Grok and DeepSeek official cards out of the Codex picker', () => {
		const grok = findOfficialModelProvider(upsertOfficialModelProvider(emptyCodexModelsConfig(), 'grok', ['grok-4.6']), 'grok')!;
		const codex = findOfficialModelProvider(upsertOfficialModelProvider(emptyCodexModelsConfig(), 'codex', ['gpt-5.4']), 'codex')!;
		assert.strictEqual(shouldIncludeOfficialProviderInCodexPicker(grok), false);
		assert.strictEqual(shouldIncludeOfficialProviderInCodexPicker(codex), true);
	});
});
