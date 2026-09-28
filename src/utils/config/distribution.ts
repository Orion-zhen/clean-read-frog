import type { Config } from "@/types/config/config"
import type { ProviderConfig } from "@/types/config/provider"
import type { SelectionToolbarBuiltInActionState } from "@/types/config/selection-toolbar"
import { isLLMProviderConfig, isTranslateProviderConfig } from "@/types/config/provider"
import { selectionToolbarBuiltInActionsSchema } from "@/types/config/selection-toolbar"
import { FEATURE_KEYS, FEATURE_PROVIDER_DEFS } from "@/utils/constants/feature-providers"
import { DEFAULT_PROVIDER_CONFIG } from "@/utils/constants/providers"
import { isProviderConfigAvailableInDistribution } from "@/utils/distribution"

export interface NormalizeConfigForDistributionResult {
  config: Config
  changed: boolean
}

type ProviderPredicate = (provider: ProviderConfig) => boolean

function ensureEnabledFallbackProvider(
  providersConfig: ProviderConfig[],
  predicate: ProviderPredicate,
  defaultProvider: ProviderConfig,
): { providersConfig: ProviderConfig[]; providerId: string; changed: boolean } {
  const enabledProvider = providersConfig.find(
    (provider) => provider.enabled && predicate(provider),
  )
  if (enabledProvider) {
    return { providersConfig, providerId: enabledProvider.id, changed: false }
  }

  const disabledProviderIndex = providersConfig.findIndex(predicate)
  if (disabledProviderIndex >= 0) {
    const provider = providersConfig[disabledProviderIndex]!
    const nextProviders = [...providersConfig]
    nextProviders[disabledProviderIndex] = { ...provider, enabled: true }
    return { providersConfig: nextProviders, providerId: provider.id, changed: true }
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
    changed: true,
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
export function normalizeConfigForDistribution(
  config: Config,
): NormalizeConfigForDistributionResult {
  if (!__PURE_BUILD__) {
    return { config, changed: false }
  }

  let changed = false
  let providersConfig = config.providersConfig.filter((provider) => {
    const available = isProviderConfigAvailableInDistribution(provider)
    changed ||= !available
    return available
  })

  const translateFallback = ensureEnabledFallbackProvider(
    providersConfig,
    isTranslateProviderConfig,
    DEFAULT_PROVIDER_CONFIG["microsoft-translate"],
  )
  providersConfig = translateFallback.providersConfig
  changed ||= translateFallback.changed

  const llmFallback = ensureEnabledFallbackProvider(
    providersConfig,
    isLLMProviderConfig,
    DEFAULT_PROVIDER_CONFIG.openai,
  )
  providersConfig = llmFallback.providersConfig
  changed ||= llmFallback.changed

  const llmProviderId = (providerId: string) => {
    const nextProviderId = hasEnabledCompatibleProvider(
      providersConfig,
      providerId,
      isLLMProviderConfig,
    )
      ? providerId
      : llmFallback.providerId
    changed ||= nextProviderId !== providerId
    return nextProviderId
  }

  const normalizeBuiltInAction = (action: SelectionToolbarBuiltInActionState) => {
    const { notebaseConnection: _notebaseConnection, ...localAction } = action
    const providerId = llmProviderId(action.providerId)
    changed ||= action.notebaseConnection !== undefined
    return { ...localAction, providerId }
  }
  const builtInActions = { ...config.selectionToolbar.builtInActions }
  // UI reads can precede background migration. Normalize schema defaults too.
  for (const key of ["sentenceAnalysis", "improveWriting"] as const) {
    if (builtInActions[key] === undefined) {
      builtInActions[key] = selectionToolbarBuiltInActionsSchema.shape[key].parse(undefined)
      changed = true
    }
  }
  for (const key of Object.keys(builtInActions) as (keyof typeof builtInActions)[]) {
    builtInActions[key] = normalizeBuiltInAction(builtInActions[key])
  }

  const customActions = config.selectionToolbar.customActions.map((action) => {
    const { notebaseConnection: _notebaseConnection, ...actionWithoutNotebase } = action
    const providerId = llmProviderId(action.providerId)
    changed ||= action.notebaseConnection !== undefined
    return { ...actionWithoutNotebase, providerId }
  })

  changed ||= config.selectionToolbar.noteSuggestion.enabled

  const languageDetection = (() => {
    if (config.languageDetection.mode !== "llm") {
      return config.languageDetection
    }

    if (config.languageDetection.providerId === undefined) {
      changed = true
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
  changed ||= localHubIds?.length !== selectedProviderIds?.length

  const normalizedConfig: Config = {
    ...config,
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
      changed = true
    }
  }

  return { config: normalizedConfig, changed }
}
