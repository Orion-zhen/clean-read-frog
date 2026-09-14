import type { Config } from "@/types/config/config"
import { createConfigSync } from "../config-sync/engine"
import { getLastSyncedConfigAndMeta, setLastSyncConfigAndMeta } from "../config/sync"
import { GoogleAccountChangedError, getGoogleUserInfo, getValidAccessToken } from "./auth"
import { getRemoteConfigAndMetaWithUserEmail, setRemoteConfigAndMeta } from "./storage"

export type { SyncAction, SyncResult } from "../config-sync/types"

function createGoogleDriveSync(token?: string) {
  return createConfigSync({
    async readRemote() {
      const { configValueAndMeta, email } = await getRemoteConfigAndMetaWithUserEmail(token)
      return { configValueAndMeta, targetId: email }
    },
    writeRemote: (value) => setRemoteConfigAndMeta(value, token),
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
}

export function syncConfig(token?: string) {
  return createGoogleDriveSync(token).syncConfig()
}

export async function syncMergedConfig(mergedConfig: Config, email: string): Promise<void> {
  const accessToken = await getValidAccessToken()
  const current = await getGoogleUserInfo(accessToken)
  if (current.email !== email) {
    throw new GoogleAccountChangedError(email, current.email)
  }
  await createGoogleDriveSync(accessToken).syncMergedConfig(mergedConfig, email)
}
