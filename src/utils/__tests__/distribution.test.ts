import { describe, expect, it } from "vitest"
import { SEARCH_ITEMS } from "@/entrypoints/options/command-palette/search-items"
import { API_PROVIDER_COMMERCIAL_POLICIES, API_PROVIDER_TYPES } from "@/types/config/provider"
import { getAPIProvidersConfig } from "@/utils/config/helpers"
import { AVAILABLE_FEATURE_KEYS } from "@/utils/constants/feature-providers"
import {
  API_PROVIDER_ITEMS,
  DEFAULT_PROVIDER_CONFIG,
  DEFAULT_PROVIDER_CONFIG_LIST,
} from "@/utils/constants/providers"
import {
  IS_PURE_BUILD,
  PURE_EXCLUDED_PROVIDER_TYPES,
  isProviderTypeAvailableInDistribution,
} from "@/utils/distribution"
import { getSystemProviderIdsForCapability } from "@/utils/providers/provider-registry"

describe("provider distribution policy", () => {
  it("classifies every API provider explicitly", () => {
    expect(Object.keys(API_PROVIDER_COMMERCIAL_POLICIES).toSorted()).toEqual(
      [...API_PROVIDER_TYPES].toSorted(),
    )
  })

  it.skipIf(IS_PURE_BUILD)("keeps commercial policy in sync with provider metadata", () => {
    const promotedProviderTypes = Object.entries(API_PROVIDER_ITEMS)
      .filter(
        ([, provider]) =>
          provider.sponsor?.sponsoring === true ||
          provider.sponsor?.referUrl !== undefined ||
          /[?&](?:aff|affiliate|code|invite|ref|referral)=/i.test(
            `${provider.website} ${provider.apiKeyUrl ?? ""}`,
          ),
      )
      .map(([providerType]) => providerType)
      .toSorted()

    expect(promotedProviderTypes).toEqual([...PURE_EXCLUDED_PROVIDER_TYPES].toSorted())
  })
})

describe.skipIf(!IS_PURE_BUILD)("pure distribution", () => {
  it("contains only neutral provider catalog entries", () => {
    expect(
      Object.keys(API_PROVIDER_ITEMS).every(
        (providerType) =>
          API_PROVIDER_COMMERCIAL_POLICIES[
            providerType as keyof typeof API_PROVIDER_COMMERCIAL_POLICIES
          ] === "neutral",
      ),
    ).toBe(true)
    expect(
      PURE_EXCLUDED_PROVIDER_TYPES.every((type) => !isProviderTypeAvailableInDistribution(type)),
    ).toBe(true)
  })

  it("removes promoted providers from defaults and provider config queries", () => {
    expect(
      DEFAULT_PROVIDER_CONFIG_LIST.some(
        (provider) => !isProviderTypeAvailableInDistribution(provider.provider),
      ),
    ).toBe(false)

    const promotedConfigs = [
      DEFAULT_PROVIDER_CONFIG.jalapenocloud,
      DEFAULT_PROVIDER_CONFIG.atlascloud,
      DEFAULT_PROVIDER_CONFIG.tensdaq,
    ]
    expect(getAPIProvidersConfig(promotedConfigs)).toEqual([])
  })

  it("does not expose hosted system providers", () => {
    expect(getSystemProviderIdsForCapability("pageTranslation")).toEqual([])
    expect(getSystemProviderIdsForCapability("customAction")).toEqual([])
  })

  it("removes disabled capabilities from feature and search registries", () => {
    expect(AVAILABLE_FEATURE_KEYS).not.toContain("noteSuggestion")
    expect(SEARCH_ITEMS.map((item) => item.sectionId)).not.toContain(
      "selection-toolbar-note-suggestion",
    )
    expect(SEARCH_ITEMS.map((item) => item.sectionId)).not.toContain("subtitles-ai-quota")
  })
})
