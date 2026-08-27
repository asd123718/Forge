/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Structured value backing the Codex "Models" settings section.
 *
 * This shape is stored under the provider-backed root config key
 * `codex.models`, mirrored to `forge-models.json` under Codex home, and
 * bridged to the Codex `config.toml` `model`, `model_provider`, and
 * `model_providers` keys by the Codex agent (see `codexAgent.ts`).
 */

/** Wire protocol for a custom provider. Only `responses` is supported upstream. */
export type CodexModelWireApi = 'responses';

export type CodexModelProviderKind = 'responses' | 'ollama' | 'lmstudio';
export type CodexModelProviderAuthMode = 'none' | 'environment' | 'stored';
export type CodexModelCatalogGroup = 'cloud' | 'local';
export type CodexOfficialModelSource = 'codex' | 'grok' | 'deepseek';

export const FORGE_MODELS_FILE_NAME = 'forge-models.json';
export const CODEX_MODELS_ROOT_CONFIG_KEY = 'codex.models';

/** A saved model name belonging to one provider tab. */
export interface ICodexSavedModel {
	readonly name: string;
	readonly enabled: boolean;
}

/** A single user-defined model provider (`model_providers.<id>`). */
export interface ICodexModelProviderEntry {
	/** Key in the `model_providers` table. Hidden from the settings UI. */
	readonly id: string;
	/** Catalog vendor id (OpenAI, Ollama, DeepSeek, ...). */
	readonly catalogId: string;
	/** Friendly display name (`name`). */
	readonly name: string;
	/** OpenAI-compatible base URL (`base_url`), e.g. `http://localhost:11434/v1`. */
	readonly baseUrl: string;
	/** Environment variable holding the API key (`env_key`). May be empty. */
	readonly envKey: string;
	/** Provider preset. Local presets also define their model-discovery endpoint. */
	readonly kind: CodexModelProviderKind;
	/** How Forge supplies credentials without persisting a plaintext key in config.toml. */
	readonly authMode: CodexModelProviderAuthMode;
	/** Wire API the provider speaks. */
	readonly wireApi: CodexModelWireApi;
	/** When true, this provider's enabled models appear in the agent picker. */
	readonly enabled: boolean;
	/** Saved model names for this provider card. */
	readonly models: readonly ICodexSavedModel[];
	/** Currently edited model name; restored when switching tabs. */
	readonly selectedModel: string;
	/** Login-managed vendor card. Manual cards never set this. */
	readonly official?: boolean;
	/** Which signed-in agent owns this official card. */
	readonly officialSource?: CodexOfficialModelSource;
	/** Vendor-catalog names that cannot be deleted while signed in. */
	readonly officialModels?: readonly string[];
}

/** Default model + provider plus custom providers configured for Codex. */
export interface ICodexModelsConfig {
	/** Default model id (`model`), e.g. `gpt-5.6-luna` or `ollama/qwen3-coder`. */
	readonly model: string;
	/** Default provider id (`model_provider`), e.g. `openai`, `ollama`, `lmstudio`, or a custom id. */
	readonly modelProvider: string;
	/** User-defined providers (`model_providers.*`). */
	readonly providers: readonly ICodexModelProviderEntry[];
	/** Provider tab that should stay selected after reload. */
	readonly activeProviderId?: string;
}

/** Provider id used for the built-in Ollama OSS provider. */
export const OLLAMA_PROVIDER_ID = 'ollama';
/** Provider id used for the built-in LM Studio OSS provider. */
export const LMSTUDIO_PROVIDER_ID = 'lmstudio';

export interface ICodexModelProviderManifest {
	readonly kind: CodexModelProviderKind;
	readonly label: string;
	readonly defaultBaseUrl: string;
	readonly defaultAuthMode: CodexModelProviderAuthMode;
	readonly allowsStoredApiKey: boolean;
}

export const CODEX_MODEL_PROVIDER_MANIFESTS: readonly ICodexModelProviderManifest[] = [
	{ kind: 'responses', label: 'Responses-compatible', defaultBaseUrl: '', defaultAuthMode: 'stored', allowsStoredApiKey: true },
	{ kind: 'ollama', label: 'Ollama', defaultBaseUrl: 'http://localhost:11434/v1', defaultAuthMode: 'none', allowsStoredApiKey: false },
	{ kind: 'lmstudio', label: 'LM Studio', defaultBaseUrl: 'http://localhost:1234/v1', defaultAuthMode: 'none', allowsStoredApiKey: false },
];

export interface ICodexModelCatalogEntry {
	readonly id: string;
	readonly label: string;
	readonly group: CodexModelCatalogGroup;
	readonly kind: CodexModelProviderKind;
	readonly defaultBaseUrl: string;
	readonly autoConfigure: boolean;
}

export const CODEX_MODEL_CATALOG: readonly ICodexModelCatalogEntry[] = [
	{ id: 'openai', label: 'OpenAI', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'azure-openai', label: 'Azure OpenAI', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'anthropic', label: 'Anthropic', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'google', label: 'Google Gemini', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'vertex', label: 'Google Vertex AI', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'groq', label: 'Groq', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'mistral', label: 'Mistral', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'cohere', label: 'Cohere', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'together', label: 'Together AI', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'fireworks', label: 'Fireworks', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'openrouter', label: 'OpenRouter', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'deepseek', label: 'DeepSeek', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'moonshot', label: 'Moonshot / Kimi', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'zhipu', label: 'Zhipu GLM', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'dashscope', label: 'Alibaba DashScope / Qwen', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'qianfan', label: 'Baidu Qianfan', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'volcengine', label: 'ByteDance Doubao', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'minimax', label: 'MiniMax', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'yi', label: '01.AI Yi', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'xai', label: 'xAI Grok', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'perplexity', label: 'Perplexity', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'nvidia', label: 'NVIDIA NIM', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'huggingface', label: 'Hugging Face', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'bedrock', label: 'Amazon Bedrock', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'cloudflare', label: 'Cloudflare Workers AI', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'siliconflow', label: 'SiliconFlow', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'deepinfra', label: 'DeepInfra', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'sambanova', label: 'SambaNova', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'replicate', label: 'Replicate', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'ai21', label: 'AI21', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'cerebras', label: 'Cerebras', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'novita', label: 'Novita', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'github-models', label: 'GitHub Models', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'stepfun', label: 'StepFun', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'baichuan', label: 'Baichuan', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'sensenova', label: 'SenseNova', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'hunyuan', label: 'Tencent Hunyuan', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'spark', label: 'iFlytek Spark', group: 'cloud', kind: 'responses', defaultBaseUrl: '', autoConfigure: false },
	{ id: 'ollama', label: 'Ollama', group: 'local', kind: 'ollama', defaultBaseUrl: 'http://localhost:11434/v1', autoConfigure: true },
	{ id: 'lmstudio', label: 'LM Studio', group: 'local', kind: 'lmstudio', defaultBaseUrl: 'http://localhost:1234/v1', autoConfigure: true },
	{ id: 'vllm', label: 'vLLM', group: 'local', kind: 'responses', defaultBaseUrl: 'http://localhost:8000/v1', autoConfigure: false },
	{ id: 'localai', label: 'LocalAI', group: 'local', kind: 'responses', defaultBaseUrl: 'http://localhost:8080/v1', autoConfigure: false },
	{ id: 'llamacpp', label: 'llama.cpp', group: 'local', kind: 'responses', defaultBaseUrl: 'http://localhost:8080/v1', autoConfigure: false },
	{ id: 'gpt4all', label: 'GPT4All', group: 'local', kind: 'responses', defaultBaseUrl: 'http://localhost:4891/v1', autoConfigure: false },
	{ id: 'openwebui', label: 'Open WebUI', group: 'local', kind: 'responses', defaultBaseUrl: 'http://localhost:3000/v1', autoConfigure: false },
	{ id: 'jan', label: 'Jan', group: 'local', kind: 'responses', defaultBaseUrl: 'http://localhost:1337/v1', autoConfigure: false },
	{ id: 'oobabooga', label: 'Oobabooga', group: 'local', kind: 'responses', defaultBaseUrl: 'http://localhost:5000/v1', autoConfigure: false },
	{ id: 'mlx', label: 'MLX', group: 'local', kind: 'responses', defaultBaseUrl: 'http://localhost:8080/v1', autoConfigure: false },
	{ id: 'tgi', label: 'Text Generation Inference', group: 'local', kind: 'responses', defaultBaseUrl: 'http://localhost:8080/v1', autoConfigure: false },
];

const STORED_API_KEY_ENV_PREFIX = 'FORGE_CODEX_PROVIDER_';
const STORED_API_KEY_ENV_SUFFIX = '_API_KEY';

export function getCodexModelCatalogEntry(catalogId: string): ICodexModelCatalogEntry {
	return CODEX_MODEL_CATALOG.find(entry => entry.id === catalogId)
		?? CODEX_MODEL_CATALOG.find(entry => entry.id === 'openai')
		?? CODEX_MODEL_CATALOG[0];
}

/** Providers shown in the model-card picker, sorted by display name. */
export function listCodexModelCatalog(): readonly ICodexModelCatalogEntry[] {
	return [...CODEX_MODEL_CATALOG].sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base', numeric: true }));
}

export function isOllamaCatalog(catalogId: string): boolean {
	return catalogId === 'ollama';
}

/** Only Ollama can list installed models; other local servers require a typed name. */
export function discoversCodexLocalModels(catalogId: string): boolean {
	return isOllamaCatalog(catalogId);
}

export function isLocalCatalog(catalogId: string): boolean {
	return getCodexModelCatalogEntry(catalogId).group === 'local';
}

export function allocateCodexProviderId(catalogId: string, existingIds: readonly string[]): string {
	const base = (catalogId || 'provider').replace(/[^A-Za-z0-9_-]/g, '-').replace(/^-+|-+$/g, '') || 'provider';
	if (!existingIds.includes(base)) {
		return base;
	}
	let suffix = 2;
	while (existingIds.includes(`${base}-${suffix}`)) {
		suffix++;
	}
	return `${base}-${suffix}`;
}

export function enabledCodexPickerModels(config: ICodexModelsConfig): readonly { providerId: string; name: string }[] {
	return config.providers
		.filter(provider => provider.enabled && provider.id !== '')
		.flatMap(provider => provider.models
			.filter(model => model.enabled && model.name.trim() !== '')
			.map(model => ({ providerId: provider.id, name: model.name })));
}

function isRoutableCodexProvider(provider: ICodexModelProviderEntry): boolean {
	if (!provider.enabled || provider.id === '') {
		return false;
	}
	// Official cards with empty URL stay on the vendor subscription until BYOK is filled.
	if (provider.official && provider.baseUrl.trim() === '') {
		return false;
	}
	return true;
}

export function withDefaultCodexRouting(config: ICodexModelsConfig): ICodexModelsConfig {
	const enabled = enabledCodexPickerModels(config).filter(model => {
		const provider = config.providers.find(candidate => candidate.id === model.providerId);
		return !!provider && isRoutableCodexProvider(provider);
	});
	const selected = config.providers.find(provider => provider.id === config.activeProviderId && isRoutableCodexProvider(provider))
		?? config.providers.find(provider => isRoutableCodexProvider(provider));
	const selectedModel = selected?.models.find(model => model.enabled && model.name === selected.selectedModel)
		?? selected?.models.find(model => model.enabled);
	const fallback = enabled[0];
	return {
		...config,
		model: selectedModel?.name || fallback?.name || config.model,
		modelProvider: selected?.id || fallback?.providerId || config.modelProvider,
	};
}

export function codexProviderSecretStorageKey(providerId: string): string {
	return `forge.codex.modelProvider.${encodeURIComponent(providerId)}.apiKey`;
}

export function codexProviderSecretResource(providerId: string): string {
	return `https://forge.local/codex/model-provider/${encodeURIComponent(providerId)}`;
}

export function codexProviderStoredApiKeyEnv(providerId: string): string {
	const normalized = providerId.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
	return `${STORED_API_KEY_ENV_PREFIX}${normalized}${STORED_API_KEY_ENV_SUFFIX}`;
}

export function isCodexProviderStoredApiKeyEnv(envKey: string): boolean {
	return envKey.startsWith(STORED_API_KEY_ENV_PREFIX) && envKey.endsWith(STORED_API_KEY_ENV_SUFFIX);
}

export function defaultCodexModelProviderEntry(catalogId = 'openai'): ICodexModelProviderEntry {
	const catalog = getCodexModelCatalogEntry(catalogId);
	return {
		id: '',
		catalogId: catalog.id,
		name: catalog.label,
		baseUrl: catalog.autoConfigure ? catalog.defaultBaseUrl : '',
		envKey: '',
		kind: catalog.kind,
		authMode: catalog.autoConfigure ? 'none' : 'stored',
		wireApi: 'responses',
		enabled: true,
		models: [],
		selectedModel: '',
	};
}

export function emptyCodexModelsConfig(): ICodexModelsConfig {
	return { model: '', modelProvider: '', providers: [] };
}

export function isEmptyCodexModelsConfig(value: unknown): boolean {
	const config = normalizeCodexModelsConfig(value);
	return config.model === '' && config.modelProvider === '' && config.providers.length === 0;
}

export function preferCodexModelsConfig(...candidates: readonly unknown[]): ICodexModelsConfig | undefined {
	for (const candidate of candidates) {
		if (candidate === undefined) {
			continue;
		}
		const config = normalizeCodexModelsConfig(candidate);
		if (!isEmptyCodexModelsConfig(config)) {
			return config;
		}
	}
	return undefined;
}

function inferCatalogId(id: string, kind: CodexModelProviderKind): string {
	if (CODEX_MODEL_CATALOG.some(entry => entry.id === id)) {
		return id;
	}
	if (kind === 'ollama') {
		return 'ollama';
	}
	if (kind === 'lmstudio') {
		return 'lmstudio';
	}
	const normalized = id.toLowerCase();
	const match = CODEX_MODEL_CATALOG.find(entry => normalized.includes(entry.id));
	return match?.id ?? 'openai';
}

function normalizeSavedModels(value: unknown, selectedModel: string): readonly ICodexSavedModel[] {
	const models: ICodexSavedModel[] = [];
	const seen = new Set<string>();
	if (Array.isArray(value)) {
		for (const raw of value) {
			if (typeof raw === 'string' && raw.trim() !== '') {
				const name = raw.trim();
				if (seen.has(name)) {
					continue;
				}
				seen.add(name);
				models.push({ name, enabled: true });
				continue;
			}
			if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
				continue;
			}
			const entry = raw as Record<string, unknown>;
			const name = typeof entry.name === 'string' ? entry.name.trim() : '';
			if (name === '' || seen.has(name)) {
				continue;
			}
			seen.add(name);
			models.push({ name, enabled: entry.enabled !== false });
		}
	}
	if (selectedModel && !seen.has(selectedModel)) {
		models.push({ name: selectedModel, enabled: true });
	}
	return models;
}

function normalizeProvider(raw: unknown): ICodexModelProviderEntry | undefined {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return undefined;
	}
	const entry = raw as Record<string, unknown>;
	if (typeof entry.id !== 'string' || entry.id.trim() === '') {
		return undefined;
	}
	const kind: CodexModelProviderKind = entry.kind === 'ollama' || entry.kind === 'lmstudio' ? entry.kind : 'responses';
	const envKey = typeof entry.envKey === 'string' ? entry.envKey : '';
	const authMode: CodexModelProviderAuthMode = entry.authMode === 'stored' || isCodexProviderStoredApiKeyEnv(envKey)
		? 'stored'
		: entry.authMode === 'none'
			? 'none'
			: envKey === '' ? 'none' : 'environment';
	const catalogId = typeof entry.catalogId === 'string' && entry.catalogId.trim() !== ''
		? entry.catalogId.trim()
		: inferCatalogId(entry.id.trim(), kind);
	const catalog = getCodexModelCatalogEntry(catalogId);
	const selectedModel = typeof entry.selectedModel === 'string' ? entry.selectedModel.trim() : '';
	const official = entry.official === true;
	const officialSource: CodexOfficialModelSource | undefined = entry.officialSource === 'codex' || entry.officialSource === 'grok' || entry.officialSource === 'deepseek'
		? entry.officialSource
		: undefined;
	const officialModels = Array.isArray(entry.officialModels)
		? uniqueNonEmptyStrings(entry.officialModels)
		: [];
	return {
		id: entry.id.trim(),
		catalogId: catalog.id,
		name: typeof entry.name === 'string' && entry.name.trim() !== '' ? entry.name : catalog.label,
		baseUrl: typeof entry.baseUrl === 'string' ? entry.baseUrl : '',
		envKey,
		kind: catalog.kind,
		authMode: catalog.autoConfigure ? 'none' : authMode,
		wireApi: 'responses',
		enabled: entry.enabled !== false,
		models: normalizeSavedModels(entry.models, selectedModel),
		selectedModel,
		...(official ? {
			official: true,
			officialSource,
			officialModels,
		} : {}),
	};
}

function uniqueNonEmptyStrings(value: readonly unknown[]): readonly string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const item of value) {
		if (typeof item !== 'string') {
			continue;
		}
		const name = item.trim();
		if (name === '' || seen.has(name)) {
			continue;
		}
		seen.add(name);
		result.push(name);
	}
	return result;
}

/**
 * Coerces an arbitrary root-config value into a well-formed
 * {@link ICodexModelsConfig}. Malformed or missing fields are dropped so the
 * settings UI and the write bridge never propagate invalid data.
 */
export function normalizeCodexModelsConfig(value: unknown): ICodexModelsConfig {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return emptyCodexModelsConfig();
	}
	const record = value as Record<string, unknown>;
	const model = typeof record.model === 'string' ? record.model : '';
	const modelProvider = typeof record.modelProvider === 'string' ? record.modelProvider : '';
	const providers = Array.isArray(record.providers)
		? record.providers.map(normalizeProvider).filter((entry): entry is ICodexModelProviderEntry => !!entry)
		: [];
	const activeProviderId = typeof record.activeProviderId === 'string' && providers.some(provider => provider.id === record.activeProviderId)
		? record.activeProviderId
		: providers[0]?.id;
	return { model, modelProvider, providers, activeProviderId };
}
