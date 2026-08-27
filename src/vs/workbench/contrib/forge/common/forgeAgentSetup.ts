/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getCodexModelCatalogEntry, normalizeCodexModelsConfig } from '../../../../platform/agentHost/common/codexModelsConfig.js';
import {
	CODEX_LEADER_PROVIDER_ID,
	FORGE_ORCHESTRATION_AGENTS,
	orchestrationAgentInfo,
	orchestrationAgentRef,
	type IOrchestrationAssignment,
	type IOrchestrationProviderRef,
} from '../../../../platform/agentHost/common/orchestration/orchestrationTypes.js';
import { reasoningEffortLevels } from '../../../../platform/agentHost/common/reasoningEffort.js';

export const FORGE_LOGOS_AGENT_SETTING_ID = 'forge.logosAgent';
export const FORGE_AGENT_SETUP_SETTING_ID = 'forge.agentSetup';
export const FORGE_AGENT_SETUP_OPEN_ACTION_ID = 'forge.agentSetup.open';
export const FORGE_LOGOS_PICK_AGENT_ACTION_ID = 'forge.logos.pickAgent';

export type ForgeAgentColumn = 'logos' | 'dialectic';

export interface IForgeAgentProfile {
	readonly modelProviderId?: string;
	readonly model?: string;
	readonly thinkingLevel?: string;
	readonly contextSize?: string;
}

export type IForgeAgentProfileMap = { readonly [providerId: string]: IForgeAgentProfile };

export interface IForgeAgentSetup {
	readonly logos: IForgeAgentProfileMap;
	readonly dialectic: IForgeAgentProfileMap;
}

export interface IForgeSetupModelOption {
	readonly providerId: string;
	readonly providerName: string;
	readonly model: string;
	readonly value: string;
}

export const FORGE_CONTEXT_SIZE_OPTIONS: readonly { value: string; label: string }[] = [
	{ value: 'default', label: 'Default' },
	{ value: '32000', label: '32K' },
	{ value: '64000', label: '64K' },
	{ value: '128000', label: '128K' },
	{ value: '272000', label: '272K' },
	{ value: '1000000', label: '1M' },
];

export const FORGE_THINKING_LEVELS: readonly string[] = reasoningEffortLevels.filter(level => level !== 'ultra');

const emptySetup = (): IForgeAgentSetup => ({ logos: {}, dialectic: {} });

function readProfile(value: unknown): IForgeAgentProfile | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const raw = value as Record<string, unknown>;
	return {
		modelProviderId: typeof raw.modelProviderId === 'string' ? raw.modelProviderId : undefined,
		model: typeof raw.model === 'string' ? raw.model : undefined,
		thinkingLevel: typeof raw.thinkingLevel === 'string' ? raw.thinkingLevel : undefined,
		contextSize: typeof raw.contextSize === 'string' ? raw.contextSize : undefined,
	};
}

function readProfileMap(value: unknown): IForgeAgentProfileMap {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return {};
	}
	const result: { [providerId: string]: IForgeAgentProfile } = {};
	for (const [providerId, profile] of Object.entries(value as Record<string, unknown>)) {
		const parsed = readProfile(profile);
		if (parsed) {
			result[providerId] = parsed;
		}
	}
	return result;
}

export function readLogosAgent(value: unknown): string {
	return typeof value === 'string' && orchestrationAgentInfo(value) ? value : CODEX_LEADER_PROVIDER_ID;
}

export function readForgeAgentSetup(value: unknown): IForgeAgentSetup {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return emptySetup();
	}
	const raw = value as Record<string, unknown>;
	return {
		logos: readProfileMap(raw.logos),
		dialectic: readProfileMap(raw.dialectic),
	};
}

export function getAgentProfile(setup: IForgeAgentSetup, column: ForgeAgentColumn, providerId: string): IForgeAgentProfile {
	const saved = setup[column][providerId];
	const agent = orchestrationAgentInfo(providerId);
	return {
		modelProviderId: typeof saved?.modelProviderId === 'string' ? saved.modelProviderId : undefined,
		model: saved?.model || agent?.defaultModel,
		thinkingLevel: saved?.thinkingLevel || 'medium',
		contextSize: saved?.contextSize || 'default',
	};
}

export function withAgentProfile(setup: IForgeAgentSetup, column: ForgeAgentColumn, providerId: string, patch: Partial<IForgeAgentProfile>): IForgeAgentSetup {
	return {
		logos: column === 'logos' ? { ...setup.logos, [providerId]: { ...getAgentProfile(setup, column, providerId), ...patch } } : setup.logos,
		dialectic: column === 'dialectic' ? { ...setup.dialectic, [providerId]: { ...getAgentProfile(setup, column, providerId), ...patch } } : setup.dialectic,
	};
}

export function encodeSetupModel(providerId: string, model: string): string {
	return `${providerId}::${model}`;
}

export function decodeSetupModel(value: string): { providerId: string; model: string } | undefined {
	const separator = value.indexOf('::');
	if (separator <= 0) {
		return undefined;
	}
	return { providerId: value.slice(0, separator), model: value.slice(separator + 2) };
}

export function listForgeSetupModels(config: unknown): readonly IForgeSetupModelOption[] {
	const models = normalizeCodexModelsConfig(config);
	const options: IForgeSetupModelOption[] = [];
	const seen = new Set<string>();
	for (const provider of models.providers) {
		if (!provider.enabled || provider.id === '') {
			continue;
		}
		const providerName = provider.name.trim() || getCodexModelCatalogEntry(provider.catalogId).label;
		for (const model of provider.models) {
			const name = model.name.trim();
			if (!model.enabled || name === '') {
				continue;
			}
			const value = encodeSetupModel(provider.id, name);
			if (seen.has(value)) {
				continue;
			}
			seen.add(value);
			options.push({ providerId: provider.id, providerName, model: name, value });
		}
	}
	return options;
}

export function withCurrentModelOption(options: readonly IForgeSetupModelOption[], profile: IForgeAgentProfile): readonly IForgeSetupModelOption[] {
	if (!profile.model) {
		return options;
	}
	const value = profile.modelProviderId
		? encodeSetupModel(profile.modelProviderId, profile.model)
		: options.find(option => option.model === profile.model)?.value;
	if (value && options.some(option => option.value === value)) {
		return options;
	}
	const providerId = profile.modelProviderId || 'default';
	return [{
		providerId,
		providerName: providerId === 'default' ? 'Default' : providerId,
		model: profile.model,
		value: encodeSetupModel(providerId, profile.model),
	}, ...options];
}

export function selectedSetupModelValue(profile: IForgeAgentProfile, options: readonly IForgeSetupModelOption[]): string {
	if (profile.modelProviderId && profile.model) {
		return encodeSetupModel(profile.modelProviderId, profile.model);
	}
	const byName = options.find(option => option.model === profile.model);
	return byName?.value ?? (options[0]?.value ?? '');
}

export function forgeCodexModelSelectionId(providerId: string, model: string): string {
	return `@provider=${encodeURIComponent(providerId)}:${encodeURIComponent(model)}`;
}

export function findLanguageModelIdentifier(ids: readonly string[], providerId: string | undefined, model: string | undefined): string | undefined {
	if (!model) {
		return undefined;
	}
	if (providerId) {
		const raw = forgeCodexModelSelectionId(providerId, model);
		const exact = ids.find(id => id.includes(raw));
		if (exact) {
			return exact;
		}
	}
	const encoded = encodeURIComponent(model);
	return ids.find(id => id.endsWith(`:${model}`) || id.endsWith(`:${encoded}`) || id.includes(`:${model}`) || id.includes(`:${encoded}`));
}

export function assignmentWithDialecticProfiles(assignment: IOrchestrationAssignment, setup: IForgeAgentSetup): IOrchestrationAssignment {
	return {
		leader: providerRefFromProfile(assignment.leader.providerId, 'leader', setup),
		workers: assignment.workers.map(worker => providerRefFromProfile(worker.providerId, 'worker', setup)),
	};
}

export function logosAssignment(providerId: string, setup: IForgeAgentSetup): IOrchestrationAssignment {
	const leader = providerRefFromProfile(providerId, 'leader', setup, 'logos');
	return {
		leader,
		workers: [{ ...leader, role: 'worker' }],
	};
}

export function providerRefFromProfile(providerId: string, role: 'leader' | 'worker', setup: IForgeAgentSetup, column: ForgeAgentColumn = 'dialectic'): IOrchestrationProviderRef {
	const profile = getAgentProfile(setup, column, providerId);
	return {
		...orchestrationAgentRef(providerId, role, profile.model),
		thinkingLevel: profile.thinkingLevel,
		contextSize: profile.contextSize === 'default' ? undefined : profile.contextSize,
	};
}

export { FORGE_ORCHESTRATION_AGENTS, orchestrationAgentInfo };
