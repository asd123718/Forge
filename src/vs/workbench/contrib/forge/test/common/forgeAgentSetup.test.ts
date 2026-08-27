/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { emptyCodexModelsConfig, type ICodexModelsConfig } from '../../../../../platform/agentHost/common/codexModelsConfig.js';
import { CODEX_LEADER_PROVIDER_ID, DEEPSEEK_WORKER_PROVIDER_ID, DEFAULT_ORCHESTRATION_ASSIGNMENT, GROK_WORKER_PROVIDER_ID } from '../../../../../platform/agentHost/common/orchestration/orchestrationTypes.js';
import { assignmentWithDialecticProfiles, decodeSetupModel, encodeSetupModel, findLanguageModelIdentifier, getAgentProfile, listForgeSetupModels, logosAssignment, readForgeAgentSetup, readLogosAgent, selectedSetupModelValue, withAgentProfile, withCurrentModelOption } from '../../common/forgeAgentSetup.js';

suite('Forge agent setup', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('defaults logos agent to Codex and fills missing profiles', () => {
		assert.strictEqual(readLogosAgent(undefined), CODEX_LEADER_PROVIDER_ID);
		assert.strictEqual(readLogosAgent('grok-build'), GROK_WORKER_PROVIDER_ID);
		assert.strictEqual(readLogosAgent('nope'), CODEX_LEADER_PROVIDER_ID);
		const profile = getAgentProfile(readForgeAgentSetup(undefined), 'logos', DEEPSEEK_WORKER_PROVIDER_ID);
		assert.strictEqual(profile.model, 'deepseek-v4-flash');
		assert.strictEqual(profile.thinkingLevel, 'medium');
		assert.strictEqual(profile.contextSize, 'default');
	});

	test('round-trips model provider encoding and profile patches', () => {
		assert.deepStrictEqual(decodeSetupModel(encodeSetupModel('openai', 'gpt-5.6-sol')), { providerId: 'openai', model: 'gpt-5.6-sol' });
		const next = withAgentProfile(readForgeAgentSetup({}), 'dialectic', CODEX_LEADER_PROVIDER_ID, {
			modelProviderId: 'openai',
			model: 'gpt-5.6-sol',
			thinkingLevel: 'high',
			contextSize: '272000',
		});
		const profile = getAgentProfile(next, 'dialectic', CODEX_LEADER_PROVIDER_ID);
		assert.strictEqual(profile.model, 'gpt-5.6-sol');
		assert.strictEqual(profile.thinkingLevel, 'high');
		assert.strictEqual(getAgentProfile(next, 'logos', CODEX_LEADER_PROVIDER_ID).thinkingLevel, 'medium');
	});

	test('lists enabled settings-models and keeps a saved model visible', () => {
		const config: ICodexModelsConfig = {
			...emptyCodexModelsConfig(),
			providers: [{
				id: 'openai',
				catalogId: 'openai',
				name: 'OpenAI',
				baseUrl: '',
				envKey: 'OPENAI_API_KEY',
				kind: 'responses',
				authMode: 'environment',
				wireApi: 'responses',
				enabled: true,
				models: [{ name: 'gpt-5.6-sol', enabled: true }, { name: 'hidden', enabled: false }],
				selectedModel: 'gpt-5.6-sol',
			}],
		};
		const options = listForgeSetupModels(config);
		assert.deepStrictEqual(options.map(option => option.value), ['openai::gpt-5.6-sol']);
		const withSaved = withCurrentModelOption(options, { modelProviderId: 'xai', model: 'grok-4.6' });
		assert.strictEqual(withSaved[0].value, 'xai::grok-4.6');
		assert.strictEqual(selectedSetupModelValue({ modelProviderId: 'openai', model: 'gpt-5.6-sol' }, options), 'openai::gpt-5.6-sol');
	});

	test('maps dialectic profiles onto the current assignment without swapping agents', () => {
		const setup = withAgentProfile(readForgeAgentSetup({}), 'dialectic', GROK_WORKER_PROVIDER_ID, {
			modelProviderId: 'xai',
			model: 'grok-4.6',
			thinkingLevel: 'low',
		});
		const assignment = assignmentWithDialecticProfiles(DEFAULT_ORCHESTRATION_ASSIGNMENT, setup);
		assert.strictEqual(assignment.leader.providerId, CODEX_LEADER_PROVIDER_ID);
		const grok = assignment.workers.find(worker => worker.providerId === GROK_WORKER_PROVIDER_ID);
		assert.strictEqual(grok?.model, 'grok-4.6');
		assert.strictEqual(grok?.thinkingLevel, 'low');
	});

	test('builds a single-agent logos assignment from the logos column', () => {
		const setup = withAgentProfile(readForgeAgentSetup({}), 'logos', DEEPSEEK_WORKER_PROVIDER_ID, {
			model: 'deepseek-v4-flash',
			thinkingLevel: 'high',
		});
		const assignment = logosAssignment(DEEPSEEK_WORKER_PROVIDER_ID, setup);
		assert.strictEqual(assignment.leader.providerId, DEEPSEEK_WORKER_PROVIDER_ID);
		assert.strictEqual(assignment.workers.length, 1);
		assert.strictEqual(assignment.workers[0].role, 'worker');
		assert.strictEqual(assignment.leader.thinkingLevel, 'high');
	});

	test('matches Codex language-model identifiers from provider and model', () => {
		const ids = ['agent-host-codex:@provider=openai:gpt-5.6-sol', 'agent-host-codex:@provider=xai:grok-4.6'];
		assert.strictEqual(findLanguageModelIdentifier(ids, 'openai', 'gpt-5.6-sol'), ids[0]);
		assert.strictEqual(findLanguageModelIdentifier(ids, undefined, 'grok-4.6'), ids[1]);
	});
});
