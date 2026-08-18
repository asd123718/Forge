/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { CODEX_AGENT_PROVIDER_ID } from '../../common/agent.js';
import type { IAgentCustomizationSettingsRegistration } from '../../common/agentCustomizationSettings.js';

export function createCodexProviderConfiguration(userHome: URI): IAgentCustomizationSettingsRegistration {
	return {
		provider: CODEX_AGENT_PROVIDER_ID,
		title: localize('codex.configuration.title', "Codex"),
		description: localize('codex.configuration.description', "Configure Codex defaults stored in config.toml. Project and managed configuration can override these user values."),
		properties: {
			'codex.permissionsPreset': {
				type: 'string',
				title: localize('codex.configuration.permissions', "Permissions"),
				description: localize('codex.configuration.permissions.description', "Choose how much Codex can do on its own. Default asks before deleting files, using the internet, or leaving the workspace. Full Access skips those prompts."),
				default: 'default',
				enum: ['default', 'auto-review', 'full-access'],
				enumLabels: [
					localize('codex.configuration.permissions.default', "Default"),
					localize('codex.configuration.permissions.autoReview', "Auto-Review"),
					localize('codex.configuration.permissions.fullAccess', "Full Access"),
				],
				enumDescriptions: [
					localize('codex.configuration.permissions.defaultDescription', "Read and edit files in this workspace and run routine local commands. Codex asks before deleting files, using the internet, or touching paths outside the workspace."),
					localize('codex.configuration.permissions.autoReviewDescription', "Same workspace access as Default, but approval requests go to the auto-reviewer instead of a prompt."),
					localize('codex.configuration.permissions.fullAccessDescription', "Codex can edit or delete files anywhere and use the internet without asking. Use only when you want full machine access."),
				],
			},
			'codex.personality': { type: 'string', title: localize('codex.configuration.personality', "Personality"), description: localize('codex.configuration.personality.description', "Controls the default communication style for Codex. Default leaves personality unset in config.toml."), default: 'default', enum: ['default', 'friendly', 'pragmatic'], enumLabels: [localize('codex.configuration.personality.default', "Default"), localize('codex.configuration.personality.friendly', "Friendly"), localize('codex.configuration.personality.pragmatic', "Pragmatic")] },
			'codex.autoReviewPolicy': { type: 'string', title: localize('codex.configuration.autoReviewPolicy', "Auto-review policy"), description: localize('codex.configuration.autoReviewPolicy.description', "Updates auto_review.policy in config.toml. Leave empty to remove the auto_review section."), default: '' },
			'codex.models': { type: 'object', title: localize('codex.configuration.models', "Models"), description: localize('codex.configuration.models.description', "Choose the default model and provider, and add custom model providers such as Ollama, LM Studio, or any OpenAI-compatible endpoint."), default: { model: '', modelProvider: '', providers: [] } },
		},
		settings: [
			{ key: 'codex.permissionsPreset', group: localize('codex.configuration.permissions.group', "Agent permissions"), kind: 'permissions' },
			{ key: 'codex.models', group: localize('codex.configuration.models.group', "Models"), kind: 'models' },
			{ key: 'codex.personality', group: localize('codex.configuration.personalization', "Personalization") },
			{ key: 'codex.autoReviewPolicy', group: localize('codex.configuration.review', "Review policy"), kind: 'multiline', saveLabel: localize('codex.configuration.review.save', "Save Policy") },
		],
		configurationFile: {
			resource: URI.file(join(userHome.fsPath, '.forge', 'codex', 'config.toml')).toString(),
			title: localize('codex.configuration.file.title', "Advanced configuration"),
			description: localize('codex.configuration.file.description', "Open the Codex configuration file to customize additional agent behavior."),
			openLabel: localize('codex.configuration.file.open', "Open config.toml"),
			documentationUrl: 'https://learn.chatgpt.com/docs/config-file/config-basic',
			documentationLabel: localize('codex.configuration.file.docs', "Codex configuration documentation"),
		},
	};
}
