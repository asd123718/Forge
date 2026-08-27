/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { observableValue } from '../../../../base/common/observable.js';
import { localize } from '../../../../nls.js';
import { CODEX_AGENT_PROVIDER_ID, IAgentHostService } from '../../../../platform/agentHost/common/agentService.js';
import { codexProviderSecretResource, codexProviderSecretStorageKey } from '../../../../platform/agentHost/common/codexModelsConfig.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { ActionType } from '../../../../platform/agentHost/common/state/sessionActions.js';
import { aiCustomizationManagementSectionRegistry } from '../browser/aiCustomization/aiCustomizationManagementSectionRegistry.js';
import { AHPAgentSettingsWidget, type IAgentGlobalConfigurationSettingsTarget } from '../browser/aiCustomization/agentGlobalConfigurationSettingsWidget.js';
import { AICustomizationManagementSection } from '../common/aiCustomizationWorkspaceService.js';
import { SessionType } from '../common/chatSessionsService.js';

function createCodexSettingsTarget(agentHostService: IAgentHostService, secretStorageService: ISecretStorageService, nativeHostService: INativeHostService): IAgentGlobalConfigurationSettingsTarget {
	return {
		onDidChange: agentHostService.rootState.onDidChange,
		getState: () => agentHostService.rootState.value instanceof Error ? undefined : agentHostService.rootState.value,
		setValue: async (key, value) => agentHostService.dispatch('ahp-root://', { type: ActionType.RootConfigChanged, config: { [key]: value } }),
		mapResource: resource => resource,
		getModelProviderApiKey: providerId => secretStorageService.get(codexProviderSecretStorageKey(providerId)),
		setModelProviderApiKey: async (providerId, apiKey) => {
			const storageKey = codexProviderSecretStorageKey(providerId);
			if (apiKey) {
				await secretStorageService.set(storageKey, apiKey);
			} else {
				await secretStorageService.delete(storageKey);
			}
			await agentHostService.authenticate({ resource: codexProviderSecretResource(providerId), token: apiKey ?? '' });
		},
		discoverLocalModels: async (catalogId, baseUrl) => {
			if (catalogId !== 'ollama') {
				return [];
			}
			try {
				return await nativeHostService.listOllamaModels(baseUrl);
			} catch {
				return [];
			}
		},
	};
}

aiCustomizationManagementSectionRegistry.register({
	id: AICustomizationManagementSection.HarnessSettings,
	label: localize('codexCustomizationSettings.navigationLabel', "Codex"),
	icon: Codicon.openai,
	description: localize('codexCustomizationSettings.navigationDescription', "Configure global behavior for this harness."),
	supportsHarness: harnessId => harnessId === SessionType.AgentHostCodex,
	create: (instantiationService, container) => instantiationService.invokeFunction(accessor => {
		const settingsTarget = createCodexSettingsTarget(accessor.get(IAgentHostService), accessor.get(ISecretStorageService), accessor.get(INativeHostService));
		const target = observableValue<IAgentGlobalConfigurationSettingsTarget | undefined>('codexSettings.target', settingsTarget);
		return instantiationService.createInstance(AHPAgentSettingsWidget, container, CODEX_AGENT_PROVIDER_ID, target, 'harness');
	}),
});

aiCustomizationManagementSectionRegistry.register({
	id: AICustomizationManagementSection.Models,
	label: localize('codexModelsSettings.navigationLabel', "Models"),
	icon: Codicon.vm,
	description: localize('codexModelsSettings.navigationDescription', "Configure Codex model providers and API keys."),
	supportsHarness: harnessId => harnessId === SessionType.AgentHostCodex,
	create: (instantiationService, container) => instantiationService.invokeFunction(accessor => {
		const settingsTarget = createCodexSettingsTarget(accessor.get(IAgentHostService), accessor.get(ISecretStorageService), accessor.get(INativeHostService));
		const target = observableValue<IAgentGlobalConfigurationSettingsTarget | undefined>('codexModels.target', settingsTarget);
		return instantiationService.createInstance(AHPAgentSettingsWidget, container, CODEX_AGENT_PROVIDER_ID, target, 'models');
	}),
});
