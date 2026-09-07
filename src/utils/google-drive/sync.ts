import { createConfigSync } from "../config-sync/engine"
import { getLastSyncedConfigAndMeta, setLastSyncConfigAndMeta } from "../config/sync"
import { getRemoteConfigAndMetaWithUserEmail, setRemoteConfigAndMeta } from "./storage"

export type { SyncAction, SyncResult } from "../config-sync/types"

const googleDriveSync = createConfigSync({
  async readRemote() {
    const { configValueAndMeta, email } = await getRemoteConfigAndMetaWithUserEmail()
    return { configValueAndMeta, targetId: email }
  },
  writeRemote: setRemoteConfigAndMeta,
  async readBaseline() {
    const baseline = await getLastSyncedConfigAndMeta()
    if (!baseline) return null
    const { email, ...meta } = baseline.meta
    return { value: baseline.value, meta: { ...meta, targetId: email } }
  },
  async writeBaseline(value, { targetId, ...meta }) {
    await setLastSyncConfigAndMeta(value, { ...meta, email: targetId })
  },
})

export const { syncConfig, syncMergedConfig } = googleDriveSync
