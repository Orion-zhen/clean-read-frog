import type { WebDavSettings } from "./settings"
import type { Config } from "@/types/config/config"
import type { SyncResult } from "@/utils/config-sync/types"
import { createConfigSync } from "@/utils/config-sync/engine"
import { createWebDavClient } from "./client"
import { parseWebDavSettings, webDavTargetId } from "./settings"
import { getWebDavBaseline, parseRemoteConfig, saveWebDavBaseline } from "./storage"

export type WebDavSyncResult =
  | Exclude<SyncResult, { status: "unresolved" }>
  | (Extract<SyncResult, { status: "unresolved" }> & {
      complete: (config: Config) => Promise<void>
    })

export async function syncWebDavConfig(input: WebDavSettings): Promise<WebDavSyncResult> {
  try {
    const settings = parseWebDavSettings(input)
    const targetId = webDavTargetId(settings)
    const remote = await createWebDavClient(settings).readFile()
    const configValueAndMeta =
      remote.content === null ? null : await parseRemoteConfig(remote.content)
    const sync = createConfigSync({
      readRemote: async () => ({ configValueAndMeta, targetId }),
      writeRemote: (config) => remote.write(JSON.stringify(config, null, 2)),
      readBaseline: getWebDavBaseline,
      writeBaseline: saveWebDavBaseline,
    })
    const result = await sync.syncConfig()
    if (result.status !== "unresolved") return result
    // Keep the original destination, credentials and ETag while the dialog is open.
    return { ...result, complete: (config) => sync.syncMergedConfig(config, targetId) }
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error : new Error("WebDAV sync failed"),
    }
  }
}
