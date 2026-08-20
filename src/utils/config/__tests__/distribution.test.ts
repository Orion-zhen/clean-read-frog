import { describe, expect, it } from "vitest"
import { configSchema } from "@/types/config/config"
import { normalizeConfigForDistribution } from "@/utils/config/distribution"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { DEFAULT_PROVIDER_CONFIG } from "@/utils/constants/providers"
import { IS_PURE_BUILD, isProviderConfigAvailableInDistribution } from "@/utils/distribution"
import { BUILT_IN_AI_PROVIDER_ID } from "@/utils/providers/provider-registry"

describe.skipIf(!IS_PURE_BUILD)("pure config normalization", () => {
  it("removes promoted/cloud state and repairs provider assignments", () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.providersConfig.push(
      structuredClone(DEFAULT_PROVIDER_CONFIG.jalapenocloud),
      structuredClone(DEFAULT_PROVIDER_CONFIG.atlascloud),
      structuredClone(DEFAULT_PROVIDER_CONFIG.tensdaq),
    )
    config.pageTranslation.providerId = DEFAULT_PROVIDER_CONFIG.jalapenocloud.id
    config.videoSubtitles.providerId = BUILT_IN_AI_PROVIDER_ID
    config.inputTranslation.providerId = BUILT_IN_AI_PROVIDER_ID
    config.selectionToolbar.features.translate.providerId = DEFAULT_PROVIDER_CONFIG.atlascloud.id
    config.selectionToolbar.builtInActions.dictionary.providerId = BUILT_IN_AI_PROVIDER_ID
    config.selectionToolbar.builtInActions.dictionary.notebaseConnection = {
      notebaseId: "notebase-id",
      notebaseNameSnapshot: "Dictionary",
      connectedAccount: { id: "account-id", name: "User", email: "user@example.com" },
      mappings: [],
    }
    config.selectionToolbar.noteSuggestion.enabled = true
    config.selectionToolbar.noteSuggestion.providerId = BUILT_IN_AI_PROVIDER_ID
    config.languageDetection = { mode: "llm", providerId: BUILT_IN_AI_PROVIDER_ID }

    const result = normalizeConfigForDistribution(config)

    expect(result.changed).toBe(true)
    expect(result.config.providersConfig.every(isProviderConfigAvailableInDistribution)).toBe(true)
    expect(result.config.selectionToolbar.builtInActions.dictionary.notebaseConnection).toBe(
      undefined,
    )
    expect(result.config.selectionToolbar.noteSuggestion.enabled).toBe(false)
    expect(JSON.stringify(result.config)).not.toContain(BUILT_IN_AI_PROVIDER_ID)
    expect(configSchema.safeParse(result.config).success).toBe(true)

    const secondPass = normalizeConfigForDistribution(result.config)
    expect(secondPass.changed).toBe(false)
  })
})
