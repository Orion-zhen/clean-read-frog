import { describe, expect, it } from "vitest"
import { SEARCH_ITEMS } from "@/entrypoints/options/command-palette/search-items"
import { AVAILABLE_FEATURE_KEYS } from "@/utils/constants/feature-providers"
import { API_PROVIDER_ITEMS, DEFAULT_PROVIDER_CONFIG_LIST } from "@/utils/constants/providers"
import { IS_PURE_BUILD } from "@/utils/distribution"
import { CUSTOM_ACTION_NOTEBASE_SECTION_ID } from "@/utils/navigation"
import { getSystemProviderIdsForCapability } from "@/utils/providers/provider-registry"

describe.skipIf(IS_PURE_BUILD)("official distribution", () => {
  it("keeps note suggestion and analytics settings available", () => {
    expect(AVAILABLE_FEATURE_KEYS).toContain("noteSuggestion")
    expect(SEARCH_ITEMS.map((item) => item.sectionId)).toEqual(
      expect.arrayContaining(["selection-toolbar-note-suggestion", "analytics"]),
    )
  })
})

describe.skipIf(!IS_PURE_BUILD)("pure distribution", () => {
  it("offers local providers without promoted or hosted options", () => {
    const catalog = Object.keys(API_PROVIDER_ITEMS)
    const defaults = DEFAULT_PROVIDER_CONFIG_LIST.map((provider) => provider.provider)
    expect(catalog).toContain("openai")
    expect(defaults).toEqual(expect.arrayContaining(["openai", "microsoft-translate"]))
    for (const provider of ["jalapenocloud", "atlascloud", "tensdaq"]) {
      expect(catalog).not.toContain(provider)
      expect(defaults).not.toContain(provider)
    }
    expect(getSystemProviderIdsForCapability("pageTranslation")).toEqual([])
    expect(getSystemProviderIdsForCapability("customAction")).toEqual([])
  })

  it("does not offer cloud or analytics settings", () => {
    expect(AVAILABLE_FEATURE_KEYS).not.toContain("noteSuggestion")
    const sections = SEARCH_ITEMS.map((item) => item.sectionId)
    for (const section of [
      "selection-toolbar-note-suggestion",
      "analytics",
      "subtitles-ai-quota",
      CUSTOM_ACTION_NOTEBASE_SECTION_ID,
    ]) {
      expect(sections).not.toContain(section)
    }
  })
})
