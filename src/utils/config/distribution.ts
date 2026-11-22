import type { Config } from "@/types/config/config"
import type { ProviderConfig } from "@/types/config/provider"
import type { SelectionToolbarBuiltInActionState } from "@/types/config/selection-toolbar"
import { isLLMProviderConfig, isTranslateProviderConfig } from "@/types/config/provider"
import { FEATURE_KEYS, FEATURE_PROVIDER_DEFS } from "@/utils/constants/feature-providers"
import { DEFAULT_PROVIDER_CONFIG } from "@/utils/constants/providers"
import { isProviderTypeAvailableInDistribution } from "@/utils/distribution"

type ProviderPredicate = (provider: ProviderConfig) => boolean

export function filterProviderConfigsForDistribution(value: unknown): unknown {
  if (!Array.isArray(value)) return value

  return value.filter(
    (entry: unknown) =>
      !(
        typeof entry === "object" &&
        entry !== null &&
        "provider" in entry &&
        typeof entry.provider === "string" &&
        !isProviderTypeAvailableInDistribution(entry.provider)
      ),
  )
}

function ensureEnabledFallbackProvider(
  providersConfig: ProviderConfig[],
  predicate: ProviderPredicate,
  defaultProvider: ProviderConfig,
): { providersConfig: ProviderConfig[]; providerId: string } {
  const enabledProvider = providersConfig.find(
    (provider) => provider.enabled && predicate(provider),
  )
  if (enabledProvider) {
    return { providersConfig, providerId: enabledProvider.id }
  }

  const disabledProviderIndex = providersConfig.findIndex(predicate)
  if (disabledProviderIndex >= 0) {
    const provider = providersConfig[disabledProviderIndex]!
    const nextProviders = [...providersConfig]
    nextProviders[disabledProviderIndex] = { ...provider, enabled: true }
    return { providersConfig: nextProviders, providerId: provider.id }
  }

  const occupiedIds = new Set(providersConfig.map((provider) => provider.id))
  let fallbackId = defaultProvider.id
  let suffix = 1
  while (occupiedIds.has(fallbackId)) {
    fallbackId = `${defaultProvider.id}-pure-${suffix}`
    suffix += 1
  }

  const fallbackProvider = {
    ...structuredClone(defaultProvider),
    id: fallbackId,
    enabled: true,
  }
  return {
    providersConfig: [...providersConfig, fallbackProvider],
    providerId: fallbackId,
  }
}

function hasEnabledCompatibleProvider(
  providersConfig: ProviderConfig[],
  providerId: string,
  predicate: ProviderPredicate,
): boolean {
  return providersConfig.some(
    (provider) => provider.id === providerId && provider.enabled && predicate(provider),
  )
}

function setConfigValueAtPath(config: Config, path: readonly string[], value: string): void {
  let target = config as unknown as Record<string, unknown>
  for (const key of path.slice(0, -1)) {
    target = target[key] as Record<string, unknown>
  }
  target[path.at(-1)!] = value
}

/**
 * Removes official-only state before validating a config in the pure distribution.
 *
 * This is intentionally a distribution normalization rather than a numbered migration: config
 * schema migrations describe upstream data versions, while switching between official and pure
 * builds is a build-policy change that must also apply to already-current and imported configs.
 */
export function normalizeConfigForDistribution(config: Config): Config {
  if (!__PURE_BUILD__) {
    return config
  }

  const translateFallback = ensureEnabledFallbackProvider(
    config.providersConfig,
    isTranslateProviderConfig,
    DEFAULT_PROVIDER_CONFIG["microsoft-translate"],
  )

  const llmFallback = ensureEnabledFallbackProvider(
    translateFallback.providersConfig,
    isLLMProviderConfig,
    DEFAULT_PROVIDER_CONFIG.openai,
  )
  const { providersConfig } = llmFallback

  const llmProviderId = (providerId: string) => {
    const nextProviderId = hasEnabledCompatibleProvider(
      providersConfig,
      providerId,
      isLLMProviderConfig,
    )
      ? providerId
      : llmFallback.providerId
    return nextProviderId
  }

  const normalizeBuiltInAction = (action: SelectionToolbarBuiltInActionState) => {
    const { notebaseConnection: _notebaseConnection, ...localAction } = action
    const providerId = llmProviderId(action.providerId)
    return { ...localAction, providerId }
  }
  const builtInActions = { ...config.selectionToolbar.builtInActions }
  for (const key of Object.keys(builtInActions) as (keyof typeof builtInActions)[]) {
    builtInActions[key] = normalizeBuiltInAction(builtInActions[key])
  }

  const customActions = config.selectionToolbar.customActions.map((action) => {
    const { notebaseConnection: _notebaseConnection, ...actionWithoutNotebase } = action
    const providerId = llmProviderId(action.providerId)
    return { ...actionWithoutNotebase, providerId }
  })

  const languageDetection = (() => {
    if (config.languageDetection.mode !== "llm") {
      return config.languageDetection
    }

    return {
      ...config.languageDetection,
      providerId: llmProviderId(config.languageDetection.providerId ?? llmFallback.providerId),
    }
  })()
  const selectedProviderIds = config.translationHub.selectedProviderIds
  const availableHubIds = new Set(
    providersConfig.filter(isTranslateProviderConfig).map((provider) => provider.id),
  )
  const localHubIds =
    selectedProviderIds?.filter((id) => availableHubIds.has(id)) ?? selectedProviderIds

  const normalizedConfig: Config = {
    ...config,
    builtInAi: { models: {} },
    providersConfig,
    languageDetection,
    translationHub: {
      ...config.translationHub,
      selectedProviderIds: localHubIds,
    },
    selectionToolbar: {
      ...config.selectionToolbar,
      builtInActions,
      customActions,
      noteSuggestion: {
        ...config.selectionToolbar.noteSuggestion,
        enabled: false,
      },
    },
  }

  for (const featureKey of FEATURE_KEYS) {
    const definition = FEATURE_PROVIDER_DEFS[featureKey]
    const currentProviderId = definition.getProviderId(normalizedConfig)
    const predicate = (provider: ProviderConfig) => definition.isProvider(provider.provider)
    const fallbackProviderId =
      definition.fallbackKind === "llm" ? llmFallback.providerId : translateFallback.providerId
    const nextProviderId = hasEnabledCompatibleProvider(
      providersConfig,
      currentProviderId,
      predicate,
    )
      ? currentProviderId
      : fallbackProviderId

    if (nextProviderId !== currentProviderId) {
      setConfigValueAtPath(normalizedConfig, definition.configPath, nextProviderId)
    }
  }

  return normalizedConfig
}
