import type { Plugin } from "vite"
import type { BuildOutput } from "wxt"
import { access, readFile, readdir } from "node:fs/promises"
import path from "node:path"

const FORBIDDEN_SOURCE_MODULE_PATTERNS = [
  "/src/utils/auth/",
  "/src/utils/orpc/",
  "/src/entrypoints/background/hosted-ai-status.ts",
  "/src/entrypoints/background/notebase-pending-save.ts",
  "/src/utils/subtitles/ai/",
  "/src/utils/config/migration-scripts/v097-to-v098.ts",
] as const

const PURE_GATEWAY_REPLACEMENTS = {
  "/src/utils/auth/auth-client.ts": `
    const guest = { data: null, isPending: false, error: null };
    export const authClient = {
      useSession: () => guest,
      getSession: async () => ({ data: null, error: null }),
      signOut: async () => ({ data: null, error: null }),
    };
  `,
  "/src/utils/orpc/client.ts": `
    const unavailable = (path) => new Proxy(
      () => { throw new Error(path + " is unavailable in the pure distribution"); },
      { get: (_target, property) => unavailable(path + "." + String(property)) },
    );
    export const orpcClient = unavailable("orpcClient");
    export const orpc = unavailable("orpc");
  `,
  "/src/utils/orpc/background-client.ts": `
    const unavailable = (path) => new Proxy(
      () => { throw new Error(path + " is unavailable in the pure distribution"); },
      { get: (_target, property) => unavailable(path + "." + String(property)) },
    );
    export const backgroundOrpcClient = unavailable("backgroundOrpcClient");
  `,
  "/src/utils/subtitles/ai/access-guard.ts": `
    export const ensureSignedIn = async () => false;
    export const ensureAiSubtitlesEntitled = async () => false;
    export const ensureAiSubtitlesAccess = async () => false;
  `,
  "/src/utils/subtitles/ai/request-ai-subtitles.ts": `
    export async function requestAiSubtitles() {
      throw new Error("AI subtitles are unavailable in the pure distribution");
    }
  `,
  "/src/utils/config/migration-scripts/v097-to-v098.ts": `
    export const migrate = (oldConfig) => oldConfig;
  `,
  "/src/utils/subtitles/ai/entitlement.ts": `
    const unavailableUrl = () => "about:blank";
    const unavailableAction = () => ({ label: "", run: () => {} });
    export const LAUNCH_BONUS_CUTOFF_AT = "";
    export const pricingUrl = unavailableUrl;
    export const billingUrl = unavailableUrl;
    export const logInUrl = unavailableUrl;
    export const upgradeAction = unavailableAction;
    export const billingAction = unavailableAction;
    export const logInAction = unavailableAction;
    export const quotaResetAt = () => null;
    export const launchBonusCutoffLabel = () => null;
    export const formatQuotaDate = () => null;
  `,
} as const

const PURE_GATEWAY_ALLOWED_IMPORTER_PATTERNS: Record<
  keyof typeof PURE_GATEWAY_REPLACEMENTS,
  readonly string[]
> = {
  "/src/utils/auth/auth-client.ts": [
    "/src/components/llm-providers/use-hosted-ai-status.ts",
    "/src/components/user-account-menu/",
    "/src/utils/subtitles/ai/",
    "/src/entrypoints/options/pages/custom-actions/action-config-form/notebase-connection-field.tsx",
    "/src/entrypoints/options/pages/video-subtitles/ai-quota/",
    "/src/entrypoints/selection.content/selection-toolbar/custom-action-button/",
  ],
  "/src/utils/orpc/client.ts": [
    "/src/components/llm-providers/use-hosted-ai-status.ts",
    "/src/components/user-account-menu/",
    "/src/utils/subtitles/ai/",
    "/src/entrypoints/options/pages/custom-actions/action-config-form/notebase-connection-field.tsx",
    "/src/entrypoints/options/pages/video-subtitles/ai-quota/",
    "/src/entrypoints/selection.content/selection-toolbar/custom-action-button/",
  ],
  "/src/utils/orpc/background-client.ts": ["/src/entrypoints/background/background-stream.ts"],
  "/src/utils/config/migration-scripts/v097-to-v098.ts": ["/src/utils/config/migration.ts"],
  "/src/utils/subtitles/ai/access-guard.ts": [
    "/src/entrypoints/subtitles.content/ui/subtitles-settings-panel/components/request-ai-subtitles-item.tsx",
  ],
  "/src/utils/subtitles/ai/request-ai-subtitles.ts": ["/src/utils/subtitles/fetchers/ai/"],
  "/src/utils/subtitles/ai/entitlement.ts": [
    "/src/entrypoints/options/pages/video-subtitles/ai-quota/",
  ],
}

function normalizeModuleId(moduleId: string): string {
  return moduleId.replaceAll("\\", "/")
}

function getGatewayEntry(
  moduleId: string,
): [keyof typeof PURE_GATEWAY_REPLACEMENTS, string] | undefined {
  const normalizedModuleId = normalizeModuleId(moduleId)
  return Object.entries(PURE_GATEWAY_REPLACEMENTS).find(([suffix]) =>
    normalizedModuleId.endsWith(suffix),
  ) as [keyof typeof PURE_GATEWAY_REPLACEMENTS, string] | undefined
}

function getGatewayReplacement(moduleId: string): string | undefined {
  return getGatewayEntry(moduleId)?.[1]
}

function isUnreplacedOfficialServiceModule(moduleId: string): boolean {
  const normalizedModuleId = normalizeModuleId(moduleId)
  return (
    getGatewayReplacement(normalizedModuleId) === undefined &&
    FORBIDDEN_SOURCE_MODULE_PATTERNS.some((pattern) => normalizedModuleId.includes(pattern))
  )
}

/**
 * Replace background services that have unavoidable shared imports, then fail the build if any
 * account/cloud gateway contributes rendered code. A newly added member feature therefore either
 * tree-shakes automatically or stops the pure build instead of silently shipping.
 */
export function createPureServiceBoundaryPlugin(projectRoot: string): Plugin {
  const backgroundServices = path.resolve(projectRoot, "src/pure/background-services.ts")

  return {
    name: "pure-service-boundary",
    enforce: "pre",
    load(moduleId) {
      if (
        normalizeModuleId(moduleId).includes(
          "/src/assets/providers/read-frog-provider.png?url&no-inline",
        )
      ) {
        return 'export default "";'
      }
      return getGatewayReplacement(moduleId)
    },
    resolveId(source, importer) {
      if (
        importer?.replaceAll("\\", "/").includes("/src/entrypoints/background/") &&
        (source === "./hosted-ai-status" || source === "./notebase-pending-save")
      ) {
        return backgroundServices
      }
      return undefined
    },
    generateBundle(_options, bundle) {
      const unexpectedGatewayImporters = [...this.getModuleIds()].flatMap((moduleId) => {
        const gatewayEntry = getGatewayEntry(moduleId)
        if (!gatewayEntry) return []

        const [gatewaySuffix] = gatewayEntry
        const allowedPatterns = PURE_GATEWAY_ALLOWED_IMPORTER_PATTERNS[gatewaySuffix]
        const moduleInfo = this.getModuleInfo(moduleId)
        const importers = [
          ...(moduleInfo?.importers ?? []),
          ...(moduleInfo?.dynamicImporters ?? []),
        ]
        return importers
          .map(normalizeModuleId)
          .filter((importer) => !allowedPatterns.some((pattern) => importer.includes(pattern)))
          .map((importer) => `${importer} -> ${gatewaySuffix}`)
      })

      if (unexpectedGatewayImporters.length > 0) {
        throw new Error(
          `Pure build found new account/cloud gateway importers that need an explicit pure adapter:\n${[
            ...new Set(unexpectedGatewayImporters),
          ].join("\n")}`,
        )
      }

      const renderedOfficialModules = Object.values(bundle).flatMap((output) => {
        if (output.type !== "chunk") return []
        return Object.entries(output.modules)
          .filter(
            ([moduleId, rendered]) =>
              isUnreplacedOfficialServiceModule(moduleId) && rendered.renderedLength > 0,
          )
          .map(([moduleId]) => moduleId)
      })

      if (renderedOfficialModules.length > 0) {
        throw new Error(
          `Pure build rendered official service modules:\n${[
            ...new Set(renderedOfficialModules),
          ].join("\n")}`,
        )
      }
    },
  }
}

/**
 * Vite resolves URL imports before tree-shaking and otherwise emits orphaned provider logos.
 * Prune unreferenced image assets without touching styles, fonts, or other build artifacts.
 */
export function createPureUnusedAssetPruner(): Plugin {
  return {
    name: "pure-unused-asset-pruner",
    apply: "build",
    generateBundle(_options, bundle) {
      const emittedText = Object.values(bundle)
        .map((output) => {
          if (output.type === "chunk") return output.code
          return typeof output.source === "string" ? output.source : ""
        })
        .join("\n")

      for (const [fileName, output] of Object.entries(bundle)) {
        if (
          output.type === "asset" &&
          fileName.startsWith("assets/") &&
          /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(fileName) &&
          !emittedText.includes(path.posix.basename(fileName))
        ) {
          delete bundle[fileName]
        }
      }
    },
  }
}

export async function assertHtmlAssetReferences(outputDir: string): Promise<void> {
  const htmlFiles = (await readdir(outputDir, { recursive: true })).filter((fileName) =>
    fileName.endsWith(".html"),
  )
  const missingReferences: string[] = []

  await Promise.all(
    htmlFiles.map(async (htmlFile) => {
      const htmlPath = path.resolve(outputDir, htmlFile)
      const html = await readFile(htmlPath, "utf8")
      const references = [...html.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)].flatMap((match) =>
        match[1] ? [match[1]] : [],
      )

      await Promise.all(
        references.map(async (reference) => {
          if (/^(?:[a-z]+:|\/\/|#)/i.test(reference)) return

          const cleanReference = reference.split(/[?#]/, 1)[0]
          if (!cleanReference) return

          const referencedPath = reference.startsWith("/")
            ? path.resolve(outputDir, `.${cleanReference}`)
            : path.resolve(path.dirname(htmlPath), cleanReference)

          try {
            await access(referencedPath)
          } catch {
            missingReferences.push(`${htmlFile} -> ${reference}`)
          }
        }),
      )
    }),
  )

  if (missingReferences.length > 0) {
    throw new Error(
      `Build output contains missing HTML asset references:\n${missingReferences.sort().join("\n")}`,
    )
  }
}

export function assertPureBuildOutput(output: BuildOutput): void {
  const permissions = output.manifest.permissions ?? []
  if (permissions.includes("cookies")) {
    throw new Error("Pure build unexpectedly contains the cookies permission")
  }

  const contentScriptFiles = (output.manifest.content_scripts ?? []).flatMap(
    (contentScript) => contentScript.js ?? [],
  )
  if (contentScriptFiles.some((file) => /(?:guide|partner-bridge)/i.test(file))) {
    throw new Error("Pure build unexpectedly contains an official-only content script")
  }
}
