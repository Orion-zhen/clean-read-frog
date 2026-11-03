import type { BuildOutput } from "wxt"
import assert from "node:assert/strict"
import path from "node:path"
import { runInNewContext } from "node:vm"
import { build } from "vite"
import { describe, expect, it } from "vitest"
import { assertPureBuildOutput, createPureServiceBoundaryPlugin } from "../pure-build-output"

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

  it("removes the Notebase quota promotion without loading pricing or messaging code", async () => {
    const importer = "/src/components/custom-action/use-save-to-notebase.ts"
    const gateway = "/src/components/custom-action/notebase-limit-toast.ts"
    const chunk = await buildGateway(importer, gateway, "showNotebaseLimitExceededToast")
    const context = { PureGateway: {} as Record<string, () => unknown> }
    runInNewContext(chunk.code, context)
    expect(context.PureGateway.showNotebaseLimitExceededToast!()).toBeUndefined()
    expect(Object.keys(chunk.modules).sort()).toEqual([root + importer, root + gateway].sort())
  })

  it("rejects an unreviewed quota promotion caller", async () => {
    await expect(
      buildGateway(
        "/src/entrypoints/popup/app.tsx",
        "/src/components/custom-action/notebase-limit-toast.ts",
        "showNotebaseLimitExceededToast",
      ),
    ).rejects.toThrow("new account/cloud gateway importers")
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

function buildOutput(scripts: string[], permissions: string[] = []): BuildOutput {
  return {
    manifest: {
      manifest_version: 3,
      name: "Pure test",
      version: "1.0.0",
      permissions,
      content_scripts: [{ matches: ["<all_urls>"], js: scripts }],
    },
  } as BuildOutput
}

describe("Pure manifest audit", () => {
  it.each(["guide", "partner-bridge", "ebook-section"])(
    "rejects the official-only %s content script",
    (name) => {
      expect(() => assertPureBuildOutput(buildOutput([`content-scripts/${name}.js`]))).toThrow(
        "official-only content script",
      )
    },
  )

  it("keeps ordinary page and subtitle translation scripts", () => {
    expect(() =>
      assertPureBuildOutput(
        buildOutput(["content-scripts/loader.js", "content-scripts/subtitles.js"]),
      ),
    ).not.toThrow()
  })

  it("rejects the account cookie permission", () => {
    expect(() => assertPureBuildOutput(buildOutput([], ["cookies"]))).toThrow("cookies permission")
  })
})
