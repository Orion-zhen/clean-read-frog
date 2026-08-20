import type { Config } from "@/types/config/config"
import type { ProviderConfig } from "@/types/config/provider"
import type { DistributionCapability } from "@/utils/distribution"
import { isLLMProvider, isTranslateProvider } from "@/types/config/provider"
import { mergeWithArrayOverwrite } from "../atoms/config"
import { getProviderConfigById } from "../config/helpers"
import { isDistributionCapabilityEnabled } from "../distribution"

export const FEATURE_KEYS = [
  "pageTranslation",
  "videoSubtitles",
  "selectionTranslation",
  "inputTranslation",
  "noteSuggestion",
] as const

export type FeatureKey = (typeof FEATURE_KEYS)[number]

export interface FeatureProviderDef {
  getProviderId: (config: Config) => string
  configPath: readonly string[]
  isProvider: (provider: string) => boolean
  fallbackKind: "translate" | "llm"
  requiredCapabilities: readonly DistributionCapability[]
}

export const FEATURE_PROVIDER_DEFS = {
  pageTranslation: {
    isProvider: isTranslateProvider,
    getProviderId: (c: Config) => c.pageTranslation.providerId,
    configPath: ["pageTranslation", "providerId"],
    fallbackKind: "translate",
    requiredCapabilities: [],
  },
  videoSubtitles: {
    isProvider: isTranslateProvider,
    getProviderId: (c: Config) => c.videoSubtitles.providerId,
    configPath: ["videoSubtitles", "providerId"],
    fallbackKind: "translate",
    requiredCapabilities: [],
  },
  selectionTranslation: {
    isProvider: isTranslateProvider,
    getProviderId: (c: Config) => c.selectionToolbar.features.translate.providerId,
    configPath: ["selectionToolbar", "features", "translate", "providerId"],
    fallbackKind: "translate",
    requiredCapabilities: [],
  },
  inputTranslation: {
    isProvider: isTranslateProvider,
    getProviderId: (c: Config) => c.inputTranslation.providerId,
    configPath: ["inputTranslation", "providerId"],
    fallbackKind: "translate",
    requiredCapabilities: [],
  },
  noteSuggestion: {
    isProvider: isLLMProvider,
    getProviderId: (c: Config) => c.selectionToolbar.noteSuggestion.providerId,
    configPath: ["selectionToolbar", "noteSuggestion", "providerId"],
    fallbackKind: "llm",
    requiredCapabilities: ["noteSuggestion"],
  },
} as const satisfies Record<FeatureKey, FeatureProviderDef>

export function isFeatureAvailableInDistribution(featureKey: FeatureKey): boolean {
  return FEATURE_PROVIDER_DEFS[featureKey].requiredCapabilities.every(
    isDistributionCapabilityEnabled,
  )
}

export const AVAILABLE_FEATURE_KEYS = FEATURE_KEYS.filter(isFeatureAvailableInDistribution)

/** Maps FeatureKey (with dots) to i18n-safe key (with underscores) for `options.apiProviders.featureProviders.features.*` */
export const FEATURE_KEY_I18N_MAP = {
  pageTranslation: "pageTranslation",
  videoSubtitles: "videoSubtitles",
  selectionTranslation: "selectionTranslation",
  inputTranslation: "inputTranslation",
  noteSuggestion: "noteSuggestion",
} as const satisfies Record<FeatureKey, string>

export type FeatureLabelI18nKey =
  `options.apiProviders.featureProviders.features.${(typeof FEATURE_KEY_I18N_MAP)[FeatureKey]}`

export function getFeatureLabelI18nKey(featureKey: FeatureKey): FeatureLabelI18nKey {
  return `options.apiProviders.featureProviders.features.${FEATURE_KEY_I18N_MAP[featureKey]}`
}

export type FeatureDescriptionI18nKey =
  `options.apiProviders.featureProviders.descriptions.${(typeof FEATURE_KEY_I18N_MAP)[FeatureKey]}`

export function getFeatureDescriptionI18nKey(featureKey: FeatureKey): FeatureDescriptionI18nKey {
  return `options.apiProviders.featureProviders.descriptions.${FEATURE_KEY_I18N_MAP[featureKey]}`
}

export function resolveProviderConfig(config: Config, featureKey: FeatureKey) {
  const providerConfig = resolveProviderConfigOrNull(config, featureKey)
  if (!providerConfig) {
    const providerId = FEATURE_PROVIDER_DEFS[featureKey].getProviderId(config)
    throw new Error(`No provider config for id "${providerId}" (feature "${featureKey}")`)
  }
  return providerConfig
}

export function resolveProviderConfigOrNull(
  config: Config,
  featureKey: FeatureKey,
): ProviderConfig | null {
  const def = FEATURE_PROVIDER_DEFS[featureKey]
  const providerId = def.getProviderId(config)
  return getProviderConfigById(config.providersConfig, providerId) ?? null
}

/**
 * Convert a feature→providerId mapping into a Partial<Config> using FEATURE_PROVIDER_DEFS.configPath.
 * Generic — works for any scenario that assigns provider IDs to features.
 */

export function buildFeatureProviderPatch(
  assignments: Partial<Record<FeatureKey, string>>,
): Partial<Config> {
  let patch: Record<string, unknown> = {}

  for (const key of FEATURE_KEYS) {
    const newId = assignments[key]
    if (newId === undefined) continue

    const def = FEATURE_PROVIDER_DEFS[key]

    const fragment: Record<string, unknown> = {}
    let current: Record<string, unknown> = fragment
    for (let i = 0; i < def.configPath.length - 1; i++) {
      const next: Record<string, unknown> = {}
      current[def.configPath[i]!] = next
      current = next
    }
    current[def.configPath[def.configPath.length - 1]!] = newId

    patch = mergeWithArrayOverwrite(patch, fragment)
  }

  return patch
}
