import { describe, expect, it } from "vitest"
import { configSchema } from "@/types/config/config"
import { normalizeConfigForDistribution } from "@/utils/config/distribution"
import { migrateConfig } from "@/utils/config/migration"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { DEFAULT_PROVIDER_CONFIG } from "@/utils/constants/providers"
import { IS_PURE_BUILD, isProviderConfigAvailableInDistribution } from "@/utils/distribution"
import { BUILT_IN_AI_PROVIDER_ID } from "@/utils/providers/provider-registry"
import { testSeries as v101Fixtures } from "./example/v101"
import { testSeries as v107Fixtures } from "./example/v107"

describe.skipIf(!IS_PURE_BUILD)("pure config normalization", () => {
  it("normalizes newly defaulted actions when the UI reads a v101 config before migration", () => {
    const oldConfig = structuredClone(v101Fixtures["complex-config-from-v020"]!.config)
    const result = normalizeConfigForDistribution(oldConfig)
    const parsed = configSchema.parse(result.config)
    expect(parsed.selectionToolbar.builtInActions.sentenceAnalysis.providerId).not.toBe(
      BUILT_IN_AI_PROVIDER_ID,
    )
    expect(parsed.selectionToolbar.builtInActions.improveWriting.providerId).not.toBe(
      BUILT_IN_AI_PROVIDER_ID,
    )
    expect(parsed.selectionToolbar.builtInActions.improveWriting.enabled).toBe(false)
    expect(normalizeConfigForDistribution(parsed).changed).toBe(false)
  })

  it("migrates v101 settings without losing local providers or custom actions", async () => {
    const oldConfig = structuredClone(v101Fixtures["complex-config-from-v020"]!.config)
    const migrated = await migrateConfig(oldConfig, 101)
    const normalized = configSchema.parse(normalizeConfigForDistribution(migrated).config)
    expect(normalized.language).toEqual(oldConfig.language)
    expect(normalized.selectionToolbar.customActions.map((action) => action.id)).toEqual(
      oldConfig.selectionToolbar.customActions.map((action: { id: string }) => action.id),
    )
    const localProviders = oldConfig.providersConfig.filter(isProviderConfigAvailableInDistribution)
    for (const provider of localProviders) {
      expect(
        normalized.providersConfig.find((current) => current.id === provider.id),
      ).toMatchObject({
        id: provider.id,
        ...("apiKey" in provider ? { apiKey: provider.apiKey } : {}),
      })
    }
    expect(JSON.stringify(normalized)).not.toContain(BUILT_IN_AI_PROVIDER_ID)
    expect(normalizeConfigForDistribution(normalized).changed).toBe(false)
  })

  it("migrates v107 to v109 without losing local settings or action sample data", async () => {
    const oldConfig = structuredClone(v107Fixtures["custom-action-with-custom-layout"]!.config)
    expect(oldConfig.selectionToolbar.customActions.length).toBeGreaterThan(0)
    const migrated = await migrateConfig(oldConfig, 107)
    const normalized = configSchema.parse(normalizeConfigForDistribution(migrated).config)
    expect(normalized.pageTranslation.page.translateTitle).toBe(true)
    expect(normalized.language).toEqual(oldConfig.language)
    expect(normalized.siteRules).toEqual(oldConfig.siteRules)
    expect(normalized.selectionToolbar.customActions.map((action) => action.id)).toEqual(
      oldConfig.selectionToolbar.customActions.map((action: { id: string }) => action.id),
    )
    for (const action of normalized.selectionToolbar.customActions) {
      const original = oldConfig.selectionToolbar.customActions.find(
        (candidate: { id: string }) => candidate.id === action.id,
      )
      expect(action.layout).toBe(original.layout)
      expect(action.outputSchema).toEqual(original.outputSchema)
      expect(action.sampleData).toBeDefined()
      expect(action.notebaseConnection).toBeUndefined()
    }
    for (const provider of oldConfig.providersConfig.filter(
      isProviderConfigAvailableInDistribution,
    )) {
      expect(normalized.providersConfig.find((current) => current.id === provider.id)).toEqual(
        provider,
      )
    }
    expect(JSON.stringify(normalized)).not.toContain(BUILT_IN_AI_PROVIDER_ID)
    expect(normalizeConfigForDistribution(normalized).changed).toBe(false)
  })

  it("preserves disabled local hub selections and explicit empty selections", () => {
    const config = structuredClone(DEFAULT_CONFIG)
    const disabledProvider = {
      ...structuredClone(DEFAULT_PROVIDER_CONFIG.openai),
      id: "disabled-local-provider",
      enabled: false,
    }
    config.providersConfig.push(disabledProvider)
    config.translationHub.selectedProviderIds = [disabledProvider.id]
    const normalized = normalizeConfigForDistribution(config).config
    expect(normalized.translationHub.selectedProviderIds).toEqual([disabledProvider.id])
    expect(
      normalized.providersConfig.find((provider) => provider.id === disabledProvider.id)?.enabled,
    ).toBe(false)
    config.translationHub.selectedProviderIds = []
    expect(
      normalizeConfigForDistribution(config).config.translationHub.selectedProviderIds,
    ).toEqual([])
  })

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
    for (const action of Object.values(config.selectionToolbar.builtInActions)) {
      action.providerId = BUILT_IN_AI_PROVIDER_ID
      action.notebaseConnection = structuredClone(
        config.selectionToolbar.builtInActions.dictionary.notebaseConnection,
      )
    }
    config.translationHub.selectedProviderIds = [
      BUILT_IN_AI_PROVIDER_ID,
      DEFAULT_PROVIDER_CONFIG.tensdaq.id,
      DEFAULT_PROVIDER_CONFIG.openai.id,
    ]
    config.selectionToolbar.noteSuggestion.enabled = true
    config.selectionToolbar.noteSuggestion.providerId = BUILT_IN_AI_PROVIDER_ID
    config.languageDetection = { mode: "llm", providerId: BUILT_IN_AI_PROVIDER_ID }

    const result = normalizeConfigForDistribution(config)

    expect(result.changed).toBe(true)
    expect(result.config.providersConfig.every(isProviderConfigAvailableInDistribution)).toBe(true)
    for (const action of Object.values(result.config.selectionToolbar.builtInActions)) {
      expect(action.notebaseConnection).toBeUndefined()
      expect(action.providerId).toBe(DEFAULT_PROVIDER_CONFIG.openai.id)
    }
    expect(result.config.translationHub.selectedProviderIds).toEqual([
      DEFAULT_PROVIDER_CONFIG.openai.id,
    ])
    expect(result.config.selectionToolbar.noteSuggestion.enabled).toBe(false)
    expect(JSON.stringify(result.config)).not.toContain(BUILT_IN_AI_PROVIDER_ID)
    expect(configSchema.safeParse(result.config).success).toBe(true)

    const secondPass = normalizeConfigForDistribution(result.config)
    expect(secondPass.changed).toBe(false)
  })
})
