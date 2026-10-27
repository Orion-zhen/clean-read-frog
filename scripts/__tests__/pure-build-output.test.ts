import assert from "node:assert/strict"
import path from "node:path"
import { runInNewContext } from "node:vm"
import { build } from "vite"
import { describe, expect, it } from "vitest"
import { createPureServiceBoundaryPlugin } from "../pure-build-output"

const root = path.resolve(import.meta.dirname, "../..")
const customActionPanel = "/src/components/custom-action/custom-action-panel.tsx"
const translationProvider =
  "/src/entrypoints/content-runtime/selection/selection-toolbar/translate-button/provider.tsx"
const customActionProvider =
  "/src/entrypoints/content-runtime/selection/selection-toolbar/custom-action-button/provider.tsx"
const wordLookupCard = "/src/entrypoints/subtitles.content/learning/word-lookup-card.tsx"

async function buildGateway(importer: string, gateway: string, exportName: string) {
  const entry = root + importer
  const result = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [
      createPureServiceBoundaryPlugin(root),
      {
        name: "pure-gateway-test-entry",
        load(id) {
          if (id === entry) {
            return `export { ${exportName} } from ${JSON.stringify(root + gateway)}`
          }
          return undefined
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      lib: { entry, name: "PureGateway", formats: ["iife"] },
    },
  })
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((output) => {
    assert("output" in output)
    return output.output
  })
  const chunk = outputs.find((output) => output.type === "chunk" && output.isEntry)
  assert(chunk?.type === "chunk", "Missing gateway test bundle")
  return chunk
}

describe("Pure account UI build boundaries", () => {
  it.each([
    [
      customActionPanel,
      "/src/components/custom-action/save-to-notebase-button.tsx",
      "SaveToNotebaseButton",
    ],
    [
      customActionProvider,
      "/src/components/custom-action/save-to-notebase-dialog-host.tsx",
      "SaveToNotebaseDialogHost",
    ],
    [
      wordLookupCard,
      "/src/components/custom-action/save-to-notebase-dialog-host.tsx",
      "SaveToNotebaseDialogHost",
    ],
    [customActionPanel, "/src/components/ui/selection-popover/review-due-tab.tsx", "ReviewDueTab"],
    [
      translationProvider,
      "/src/components/ui/selection-popover/review-due-tab.tsx",
      "ReviewDueTab",
    ],
    [
      "/src/components/badges/upgrade-plan-badge.tsx",
      "/src/components/badges/plan-badge.tsx",
      "PlanBadge",
    ],
  ])("removes %s -> %s without loading account services", async (importer, gateway, exportName) => {
    const chunk = await buildGateway(importer, gateway, exportName)
    const context = { PureGateway: {} as Record<string, () => unknown> }
    runInNewContext(chunk.code, context)
    expect(context.PureGateway[exportName]!()).toBeNull()
    expect(
      Object.keys(chunk.modules)
        .filter((id) => id.includes("/src/"))
        .sort(),
    ).toEqual([root + importer, root + gateway].sort())
  })

  it("rejects an unreviewed caller instead of expanding the account gateway allowlist", async () => {
    await expect(
      buildGateway(
        "/src/entrypoints/popup/app.tsx",
        "/src/components/custom-action/save-to-notebase-dialog-host.tsx",
        "SaveToNotebaseDialogHost",
      ),
    ).rejects.toThrow("new account/cloud gateway importers")
  })
})
