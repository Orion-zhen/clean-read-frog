import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { assertHtmlAssetReferences } from "../pure-build-output"

async function withOutputDir(run: (outputDir: string) => Promise<void>) {
  const outputDir = await mkdtemp(path.join(tmpdir(), "read-frog-pure-build-"))
  try {
    await run(outputDir)
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
}

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
