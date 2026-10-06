// @vitest-environment jsdom
import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { createPureServiceBoundaryPlugin } from "../../../scripts/pure-build-output"

async function loadPureAdapter(modulePath: string) {
  const plugin = createPureServiceBoundaryPlugin("/repo")
  const hook = plugin.load
  if (typeof hook !== "function") throw new Error("Expected the Pure module loader")
  const source = await hook.call({} as any, `/repo${modulePath}`)
  if (typeof source !== "string") throw new Error(`Missing Pure adapter for ${modulePath}`)
  return import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(source)}`)
}

describe("pure gateway adapters", () => {
  it.each([
    ["/src/components/badges/plan-badge.tsx", "PlanBadge"],
    ["/src/entrypoints/options/app-sidebar/whats-new-footer.tsx", "WhatsNewFooter"],
    ["/src/entrypoints/popup/components/blog-notification.tsx", "default"],
    [
      "/src/entrypoints/options/pages/custom-actions/components/intro-video-button.tsx",
      "IntroVideoButton",
    ],
    [
      "/src/entrypoints/options/pages/custom-actions/action-config-form/notebase-connection-field.tsx",
      "NotebaseConnectionField",
    ],
  ])("omits %s without mounting account or promotional queries", async (modulePath, exportName) => {
    const adapter = await loadPureAdapter(modulePath)
    const Component = adapter[exportName]
    // The adapters must render without mounting the original components or requiring query providers.
    const { container } = render(<Component plan="pro" upgradeTooltip="Upgrade to Pro" />)
    expect(container).toBeEmptyDOMElement()
  })

  it("blocks account and billing actions instead of generating official links", async () => {
    const adapter = await loadPureAdapter("/src/utils/error-action.ts")
    for (const name of [
      "pricingUrl",
      "billingUrl",
      "logInUrl",
      "upgradeAction",
      "billingAction",
      "logInAction",
    ]) {
      expect(() => adapter[name]()).toThrow("unavailable in the pure distribution")
    }
  })
})
