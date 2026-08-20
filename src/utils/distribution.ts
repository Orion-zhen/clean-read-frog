import type { APIProviderTypes, ProviderConfig } from "@/types/config/provider"
import { API_PROVIDER_COMMERCIAL_POLICIES, isAPIProvider } from "@/types/config/provider"

/**
 * The official distribution includes Read Frog's hosted services and commercial integrations.
 * WXT and Vitest replace this global with a boolean literal so dead-code elimination can remove
 * unreachable official-only imports from pure bundles.
 */
export const IS_PURE_BUILD = __PURE_BUILD__

export type DistributionCapability =
  | "account"
  | "readFrogCloud"
  | "hostedAi"
  | "notebase"
  | "aiSubtitles"
  | "noteSuggestion"

/** Every distribution-aware capability must declare its availability explicitly. */
export const DISTRIBUTION_CAPABILITY_POLICIES: Record<
  DistributionCapability,
  "all" | "officialOnly"
> = {
  account: "officialOnly",
  readFrogCloud: "officialOnly",
  hostedAi: "officialOnly",
  notebase: "officialOnly",
  aiSubtitles: "officialOnly",
  noteSuggestion: "officialOnly",
}

export function isDistributionCapabilityEnabled(capability: DistributionCapability): boolean {
  return !IS_PURE_BUILD || DISTRIBUTION_CAPABILITY_POLICIES[capability] === "all"
}

/** Derived rather than maintained separately from the exhaustive provider policy table. */
export const PURE_EXCLUDED_PROVIDER_TYPES = Object.entries(API_PROVIDER_COMMERCIAL_POLICIES)
  .filter(([, policy]) => policy !== "neutral")
  .map(([providerType]) => providerType as APIProviderTypes)

export function isProviderTypeAvailableInDistribution(providerType: string): boolean {
  if (!IS_PURE_BUILD || !isAPIProvider(providerType)) {
    return true
  }
  return API_PROVIDER_COMMERCIAL_POLICIES[providerType] === "neutral"
}

export function isProviderConfigAvailableInDistribution(providerConfig: ProviderConfig): boolean {
  return isProviderTypeAvailableInDistribution(providerConfig.provider)
}
