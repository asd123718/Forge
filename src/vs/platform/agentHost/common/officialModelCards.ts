/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	type CodexOfficialModelSource,
	type ICodexModelProviderEntry,
	type ICodexModelsConfig,
	type ICodexSavedModel,
	emptyCodexModelsConfig,
	getCodexModelCatalogEntry,
	normalizeCodexModelsConfig,
} from './codexModelsConfig.js';

export const OFFICIAL_CODEX_PROVIDER_ID = 'forge-official-codex';
export const OFFICIAL_GROK_PROVIDER_ID = 'forge-official-grok';
export const OFFICIAL_DEEPSEEK_PROVIDER_ID = 'forge-official-deepseek';

export const OFFICIAL_CODEX_MODEL_PROVIDER = 'openai';

export interface IOfficialModelCardSpec {
	readonly id: string;
	readonly source: CodexOfficialModelSource;
	readonly catalogId: string;
	readonly name: string;
	readonly fallbackModels: readonly string[];
	readonly defaultBaseUrl: string;
}

export const OFFICIAL_MODEL_CARD_SPECS: readonly IOfficialModelCardSpec[] = [
	{
		id: OFFICIAL_CODEX_PROVIDER_ID,
		source: 'codex',
		catalogId: 'openai',
		name: 'OpenAI 官方',
		defaultBaseUrl: 'https://api.openai.com/v1',
		fallbackModels: ['gpt-5.4', 'gpt-5.3-codex', 'gpt-5.2', 'gpt-5.1-codex', 'gpt-5.1', 'o3', 'o4-mini', 'gpt-4.1'],
	},
	{
		id: OFFICIAL_GROK_PROVIDER_ID,
		source: 'grok',
		catalogId: 'xai',
		name: 'xAI 官方',
		defaultBaseUrl: 'https://api.x.ai/v1',
		fallbackModels: ['grok-4.6', 'grok-4.5', 'grok-4', 'grok-4-fast-reasoning', 'grok-code-fast-1', 'grok-3', 'grok-3-mini', 'grok-2-1212', 'grok-2-vision-1212'],
	},
	{
		id: OFFICIAL_DEEPSEEK_PROVIDER_ID,
		source: 'deepseek',
		catalogId: 'deepseek',
		name: 'DeepSeek 官方',
		defaultBaseUrl: 'https://api.deepseek.com/v1',
		fallbackModels: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-flash', 'deepseek-coder'],
	},
];

export function officialModelCardSpec(source: CodexOfficialModelSource): IOfficialModelCardSpec {
	return OFFICIAL_MODEL_CARD_SPECS.find(entry => entry.source === source) ?? OFFICIAL_MODEL_CARD_SPECS[0];
}

export function isOfficialModelProvider(provider: ICodexModelProviderEntry | undefined): boolean {
	return provider?.official === true;
}

export function isOfficialLockedModel(provider: ICodexModelProviderEntry | undefined, name: string): boolean {
	const trimmed = name.trim();
	return !!provider?.official && !!trimmed && (provider.officialModels ?? []).includes(trimmed);
}

export function shouldIncludeOfficialProviderInCodexPicker(provider: ICodexModelProviderEntry): boolean {
	return provider.enabled && provider.id !== '' && (!provider.official || provider.officialSource === 'codex');
}

export function remainingPercentFromUsed(usedPercent: number | undefined): number | undefined {
	return usedPercent === undefined ? undefined : Math.min(100, Math.max(0, 100 - usedPercent));
}

export function isOfficialQuotaExhausted(remainingPercent: number | undefined): boolean {
	return remainingPercent === 0;
}

export function officialApiFallbackReady(provider: ICodexModelProviderEntry | undefined, hasApiKey: boolean): boolean {
	return !!provider?.official && provider.baseUrl.trim() !== '' && hasApiKey;
}

export function mergeOfficialModels(existing: readonly ICodexSavedModel[], officialNames: readonly string[]): readonly ICodexSavedModel[] {
	const official = uniqueNames(officialNames);
	const officialSet = new Set(official);
	const extras = existing.filter(model => {
		const name = model.name.trim();
		return name !== '' && !officialSet.has(name);
	});
	return [
		...official.map(name => {
			const previous = existing.find(model => model.name.trim() === name);
			return { name, enabled: previous?.enabled !== false };
		}),
		...extras.map(model => ({ name: model.name.trim(), enabled: model.enabled !== false })),
	];
}

export function upsertOfficialModelProvider(
	config: ICodexModelsConfig,
	source: CodexOfficialModelSource,
	officialNames: readonly string[],
): ICodexModelsConfig {
	const spec = officialModelCardSpec(source);
	const names = uniqueNames(officialNames.length > 0 ? officialNames : spec.fallbackModels);
	const providers = dropEmptyDrafts(config.providers);
	const index = providers.findIndex(provider => provider.official && (provider.officialSource === source || provider.id === spec.id));
	const previous = index >= 0 ? providers[index] : undefined;
	const nextProvider: ICodexModelProviderEntry = {
		id: spec.id,
		catalogId: spec.catalogId,
		name: spec.name,
		baseUrl: previous?.baseUrl ?? '',
		envKey: previous?.envKey ?? '',
		kind: getCodexModelCatalogEntry(spec.catalogId).kind,
		authMode: 'stored',
		wireApi: 'responses',
		enabled: previous?.enabled !== false,
		models: mergeOfficialModels(previous?.models ?? [], names),
		selectedModel: previous?.selectedModel && names.includes(previous.selectedModel)
			? previous.selectedModel
			: (names[0] ?? ''),
		official: true,
		officialSource: source,
		officialModels: names,
	};
	const nextProviders = index >= 0
		? providers.map((provider, i) => i === index ? nextProvider : provider)
		: [nextProvider, ...providers.filter(provider => provider.id !== spec.id)];
	return normalizeCodexModelsConfig({
		...config,
		providers: nextProviders,
		activeProviderId: config.activeProviderId && nextProviders.some(provider => provider.id === config.activeProviderId)
			? config.activeProviderId
			: nextProviders[0]?.id,
	});
}

export function removeOfficialModelProvider(config: ICodexModelsConfig, source: CodexOfficialModelSource): ICodexModelsConfig {
	const spec = officialModelCardSpec(source);
	const providers = config.providers.filter(provider => !(provider.official && (provider.officialSource === source || provider.id === spec.id)));
	if (providers.length === config.providers.length) {
		return config;
	}
	return normalizeCodexModelsConfig({
		...config,
		providers,
		modelProvider: providers.some(provider => provider.id === config.modelProvider) ? config.modelProvider : '',
		activeProviderId: providers.some(provider => provider.id === config.activeProviderId) ? config.activeProviderId : providers[0]?.id,
	});
}

export function findOfficialModelProvider(config: ICodexModelsConfig, source: CodexOfficialModelSource): ICodexModelProviderEntry | undefined {
	const spec = officialModelCardSpec(source);
	return config.providers.find(provider => provider.official && (provider.officialSource === source || provider.id === spec.id));
}

export function officialCardsEqual(left: ICodexModelsConfig, right: ICodexModelsConfig): boolean {
	return JSON.stringify(normalizeCodexModelsConfig(left)) === JSON.stringify(normalizeCodexModelsConfig(right));
}

export function resolveCodexOfficialRoute(args: {
	readonly modelProvider: string;
	readonly modelId: string;
	readonly config: ICodexModelsConfig;
	readonly remainingPercent: number | undefined;
	readonly hasOfficialApiKey: boolean;
}): { readonly modelProvider: string; readonly modelId: string } {
	const official = findOfficialModelProvider(args.config, 'codex');
	if (!official) {
		return { modelProvider: args.modelProvider, modelId: args.modelId };
	}
	const isOfficialModel = (official.officialModels ?? []).includes(args.modelId)
		|| args.modelProvider === official.id && isOfficialLockedModel(official, args.modelId);
	const fallback = isOfficialModel
		&& isOfficialQuotaExhausted(args.remainingPercent)
		&& officialApiFallbackReady(official, args.hasOfficialApiKey);
	if (fallback) {
		return { modelProvider: official.id, modelId: args.modelId };
	}
	if (isOfficialModel && (args.modelProvider === official.id || args.modelProvider === OFFICIAL_CODEX_MODEL_PROVIDER || args.modelProvider === 'chatgpt')) {
		return { modelProvider: OFFICIAL_CODEX_MODEL_PROVIDER, modelId: args.modelId };
	}
	return { modelProvider: args.modelProvider, modelId: args.modelId };
}

export function emptyOfficialAwareConfig(): ICodexModelsConfig {
	return emptyCodexModelsConfig();
}

function uniqueNames(names: readonly string[]): readonly string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const raw of names) {
		const name = raw.trim();
		if (name === '' || seen.has(name)) {
			continue;
		}
		seen.add(name);
		result.push(name);
	}
	return result;
}

function dropEmptyDrafts(providers: readonly ICodexModelProviderEntry[]): ICodexModelProviderEntry[] {
	return providers.filter(provider => provider.id !== '' || provider.models.some(model => model.name.trim() !== '') || provider.baseUrl.trim() !== '');
}
