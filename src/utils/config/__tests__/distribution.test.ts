import { beforeEach, describe, expect, it } from "vitest"
import { browser } from "wxt/browser"
import { storage } from "#imports"
import { initializeConfig } from "@/utils/config/init"
import { getLocalConfig } from "@/utils/config/storage"
import { CONFIG_SCHEMA_VERSION, CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "@/utils/constants/config"
import { DEFAULT_PROVIDER_CONFIG } from "@/utils/constants/providers"
import { getBuiltInActions } from "@/utils/custom-actions"
import { IS_PURE_BUILD } from "@/utils/distribution"
import { BUILT_IN_AI_PROVIDER_ID } from "@/utils/providers/provider-registry"

describe.skipIf(!IS_PURE_BUILD)("pure config lifecycle", () => {
  beforeEach(async () => {
    await browser.storage.local.clear()
  })

  it("starts translation and built-in actions on local providers", async () => {
    await initializeConfig()
    const config = (await getLocalConfig())!
    const enabledProviderIds = config.providersConfig
      .filter((provider) => provider.enabled)
      .map((provider) => provider.id)

    expect(enabledProviderIds).toContain(config.pageTranslation.providerId)
    for (const action of getBuiltInActions(config.selectionToolbar)) {
      expect(enabledProviderIds).toContain(action.providerId)
    }
    expect(config.selectionToolbar.noteSuggestion.enabled).toBe(false)
  })

  it("keeps saved preferences while replacing official-only services on startup", async () => {
    const saved = structuredClone(DEFAULT_CONFIG)
    saved.language.targetCode = "jpn"
    saved.providersConfig.push(structuredClone(DEFAULT_PROVIDER_CONFIG.jalapenocloud))
    saved.pageTranslation.providerId = DEFAULT_PROVIDER_CONFIG.jalapenocloud.id
    saved.selectionToolbar.noteSuggestion.enabled = true
    saved.selectionToolbar.builtInActions.dictionary.providerId = BUILT_IN_AI_PROVIDER_ID
    saved.selectionToolbar.builtInActions.dictionary.notebaseConnection = {
      notebaseId: "dictionary",
      notebaseNameSnapshot: "Dictionary",
      connectedAccount: { id: "reader", name: "Reader", email: "reader@example.com" },
      mappings: [],
    }
    await storage.setItem(`local:${CONFIG_STORAGE_KEY}`, saved)
    await storage.setMeta(`local:${CONFIG_STORAGE_KEY}`, {
      schemaVersion: CONFIG_SCHEMA_VERSION,
    })

    await initializeConfig()
    const config = (await getLocalConfig())!
    const enabledProviderIds = config.providersConfig
      .filter((provider) => provider.enabled)
      .map((provider) => provider.id)

    expect(config.language.targetCode).toBe("jpn")
    expect(enabledProviderIds).not.toContain(DEFAULT_PROVIDER_CONFIG.jalapenocloud.id)
    expect(enabledProviderIds).toContain(config.pageTranslation.providerId)
    expect(enabledProviderIds).toContain(
      config.selectionToolbar.builtInActions.dictionary.providerId,
    )
    expect(config.selectionToolbar.builtInActions.dictionary.notebaseConnection).toBeUndefined()
    expect(config.selectionToolbar.noteSuggestion.enabled).toBe(false)
  })
})
