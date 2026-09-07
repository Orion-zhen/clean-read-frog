import type { Config } from "@/types/config/config"
import type { ConfigMeta, ConfigValueAndMeta } from "@/types/config/meta"

export interface UnresolvedConfigs {
  base: Config
  local: Config
  remote: Config
}

export type SyncAction = "uploaded" | "downloaded" | "same-changes" | "no-change"

export type SyncResult =
  | { status: "success"; action: SyncAction }
  | { status: "unresolved"; data: UnresolvedConfigs }
  | { status: "error"; error: Error }

export interface SyncBaselineMeta extends ConfigMeta {
  targetId: string
  lastSyncedAt: number
}

export interface SyncBaseline {
  value: Config
  meta: SyncBaselineMeta
}

/** Each adapter owns its baseline storage and remote target identity. */
export interface ConfigSyncAdapter {
  readRemote: () => Promise<{
    configValueAndMeta: ConfigValueAndMeta | null
    targetId: string
  }>
  writeRemote: (config: ConfigValueAndMeta) => Promise<void>
  readBaseline: () => Promise<SyncBaseline | null>
  writeBaseline: (value: Config, meta: SyncBaselineMeta) => Promise<void>
}
