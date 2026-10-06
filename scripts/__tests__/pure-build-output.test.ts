import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { assertHtmlAssetReferences, createPureServiceBoundaryPlugin } from "../pure-build-output"

async function withOutputDir(run: (outputDir: string) => Promise<void>) {
  const outputDir = await mkdtemp(path.join(tmpdir(), "read-frog-pure-build-"))
  try {
    await run(outputDir)
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
}

function auditModules(modules: Record<string, { importers?: string[]; renderedLength?: number }>) {
  const plugin = createPureServiceBoundaryPlugin("/repo")
  const hook = plugin.generateBundle
  if (typeof hook !== "function") throw new Error("Expected the Pure bundle audit hook")
  const result = hook.call(
    {
      getModuleIds: () => Object.keys(modules),
      getModuleInfo: (id: string) => ({
        importers: modules[id]?.importers ?? [],
        dynamicImporters: [],
      }),
    } as any,
    {} as any,
    { main: { type: "chunk", modules } } as any,
    false,
  )
  expect(result).toBeUndefined()
}

describe("pure service boundary", () => {
  it("accepts only the reviewed relocated Notebase gateway callers", () => {
    expect(() =>
      auditModules({
        "/repo/src/utils/auth/auth-client.ts": {
          importers: [
            "/repo/src/components/custom-action/save-to-notebase-button.tsx",
            "/repo/src/components/custom-action/save-to-notebase-dialog-host.tsx",
            "/repo/src/components/custom-action/use-save-to-notebase.ts",
          ],
        },
        "/repo/src/utils/orpc/client.ts": {
          importers: ["/repo/src/components/custom-action/use-save-to-notebase.ts"],
        },
      }),
    ).not.toThrow()
  })

  it("rejects a new account caller even inside the custom-action directory", () => {
    expect(() =>
      auditModules({
        "/repo/src/utils/auth/auth-client.ts": {
          importers: ["/repo/src/components/custom-action/new-account-feature.tsx"],
        },
      }),
    ).toThrow("new account/cloud gateway importers")
  })

  it("rejects a new billing action caller", () => {
    expect(() =>
      auditModules({
        "/repo/src/utils/error-action.ts": {
          importers: ["/repo/src/components/new-upgrade-button.tsx"],
        },
      }),
    ).toThrow("new account/cloud gateway importers")
  })

  it.each([
    "/repo/src/utils/blog.ts",
    "/repo/src/utils/orpc/client-context.ts",
    "/repo/node_modules/posthog-js/dist/module.js",
  ])("rejects rendered official code from %s", (id) => {
    expect(() => auditModules({ [id]: { renderedLength: 1 } })).toThrow(
      "rendered official service modules",
    )
    expect(() => auditModules({ [id]: { renderedLength: 0 } })).not.toThrow()
  })
})

describe("pure build output", () => {
  it("accepts HTML whose local assets exist", async () => {
    await withOutputDir(async (outputDir) => {
      await mkdir(path.join(outputDir, "assets"))
      await mkdir(path.join(outputDir, "pages"))
      await writeFile(path.join(outputDir, "assets/theme.css"), "body {}")
      await writeFile(path.join(outputDir, "pages/app.js"), "")
      await writeFile(
        path.join(outputDir, "pages/options.html"),
        [
          '<link rel="stylesheet" href="/assets/theme.css">',
          '<script src="./app.js?version=1"></script>',
          '<a href="https://example.com/help">Help</a>',
        ].join("\n"),
      )

      await expect(assertHtmlAssetReferences(outputDir)).resolves.toBeUndefined()
    })
  })

  it("rejects HTML that references a missing local asset", async () => {
    await withOutputDir(async (outputDir) => {
      await writeFile(
        path.join(outputDir, "options.html"),
        '<link rel="stylesheet" href="/assets/missing-theme.css">',
      )

      await expect(assertHtmlAssetReferences(outputDir)).rejects.toThrow(
        "options.html -> /assets/missing-theme.css",
      )
    })
  })
})
