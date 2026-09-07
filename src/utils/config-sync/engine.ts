import type { ConfigSyncAdapter, SyncResult } from "./types"
import type { Config } from "@/types/config/config"
import { dequal } from "dequal"
import { configSchema } from "@/types/config/config"
import { getLocalConfigAndMeta, setLocalConfigAndMeta } from "../config/storage"
import { CONFIG_SCHEMA_VERSION } from "../constants/config"
import { logger } from "../logger"

export function createConfigSync(adapter: ConfigSyncAdapter) {
  /** Save the resolved config locally, upload it, then advance this target's baseline. */
  async function syncMergedConfig(mergedConfig: Config, targetId: string): Promise<void> {
    try {
      const now = Date.now()

      // Validate merged config
      const validatedConfigResult = configSchema.safeParse(mergedConfig)
      if (!validatedConfigResult.success) {
        logger.error("Merged config is invalid, cannot sync merged config")
        throw new Error("Merged config is invalid for syncing")
      }

      const validatedConfig = validatedConfigResult.data

      // Save to local storage
      await setLocalConfigAndMeta(validatedConfig, {
        schemaVersion: CONFIG_SCHEMA_VERSION,
        lastModifiedAt: now,
      })

      await adapter.writeRemote({
        value: validatedConfig,
        meta: { schemaVersion: CONFIG_SCHEMA_VERSION, lastModifiedAt: now },
      })

      // Update sync metadata
      await adapter.writeBaseline(validatedConfig, {
        schemaVersion: CONFIG_SCHEMA_VERSION,
        lastModifiedAt: now,
        targetId,
        lastSyncedAt: Date.now(),
      })

      logger.info("Synced config successfully")
    } catch (error) {
      logger.error("Failed to sync config", error)
      throw error
    }
  }

  async function syncConfig(): Promise<SyncResult> {
    try {
      const localConfigValueAndMeta = await getLocalConfigAndMeta()
      const lastSyncedConfigValueAndMeta = await adapter.readBaseline()
      const { configValueAndMeta: remoteConfigValueAndMeta, targetId } = await adapter.readRemote()

      const now = Date.now()

      if (
        !lastSyncedConfigValueAndMeta ||
        targetId !== lastSyncedConfigValueAndMeta.meta.targetId
      ) {
        if (remoteConfigValueAndMeta) {
          logger.info("Remote config found, saving remote config")
          await setLocalConfigAndMeta(remoteConfigValueAndMeta.value, remoteConfigValueAndMeta.meta)
          await adapter.writeBaseline(remoteConfigValueAndMeta.value, {
            ...remoteConfigValueAndMeta.meta,
            targetId,
            lastSyncedAt: now,
          })
          return { status: "success", action: "downloaded" }
        }
        logger.info("No remote config found, uploading local config")
        await adapter.writeRemote(localConfigValueAndMeta)
        await adapter.writeBaseline(localConfigValueAndMeta.value, {
          ...localConfigValueAndMeta.meta,
          targetId,
          lastSyncedAt: now,
        })
        return { status: "success", action: "uploaded" }
      }

      // Check if both local and remote changed since last sync
      const localChangedSinceSync =
        localConfigValueAndMeta.meta.lastModifiedAt >
        lastSyncedConfigValueAndMeta.meta.lastModifiedAt
      const remoteChangedSinceSync =
        remoteConfigValueAndMeta &&
        remoteConfigValueAndMeta.meta.lastModifiedAt >
          lastSyncedConfigValueAndMeta.meta.lastModifiedAt

      if (localChangedSinceSync && remoteChangedSinceSync) {
        logger.info("Both local and remote changed since last sync, checking for conflicts")

        const sameLocalAndRemote = dequal(
          localConfigValueAndMeta.value,
          remoteConfigValueAndMeta.value,
        )

        if (sameLocalAndRemote) {
          logger.info("Local and remote configurations are the same, no conflicts detected")
          const syncedAt = Date.now()

          // if the schemaVersion is different, use local config's schemaVersion
          const mergedConfigValueAndMeta = {
            value: localConfigValueAndMeta.value,
            meta: { schemaVersion: CONFIG_SCHEMA_VERSION, lastModifiedAt: syncedAt },
          }

          await setLocalConfigAndMeta(mergedConfigValueAndMeta.value, mergedConfigValueAndMeta.meta)
          await adapter.writeRemote(mergedConfigValueAndMeta)
          await adapter.writeBaseline(mergedConfigValueAndMeta.value, {
            ...mergedConfigValueAndMeta.meta,
            targetId,
            lastSyncedAt: now,
          })

          return { status: "success", action: "same-changes" }
        }

        return {
          status: "unresolved",
          data: {
            base: lastSyncedConfigValueAndMeta.value,
            local: localConfigValueAndMeta.value,
            remote: remoteConfigValueAndMeta.value,
          },
        }
      } else if (localChangedSinceSync) {
        logger.info("Local config is newer, uploading local config")
        await adapter.writeRemote(localConfigValueAndMeta)
        await adapter.writeBaseline(localConfigValueAndMeta.value, {
          ...localConfigValueAndMeta.meta,
          targetId,
          lastSyncedAt: now,
        })
        return { status: "success", action: "uploaded" }
      } else if (remoteChangedSinceSync) {
        logger.info("Remote config is newer, downloading remote config")
        await setLocalConfigAndMeta(remoteConfigValueAndMeta.value, remoteConfigValueAndMeta.meta)
        await adapter.writeBaseline(remoteConfigValueAndMeta.value, {
          ...remoteConfigValueAndMeta.meta,
          targetId,
          lastSyncedAt: now,
        })
        return { status: "success", action: "downloaded" }
      }
      logger.info("No changes, skipping sync")
      await adapter.writeBaseline(localConfigValueAndMeta.value, {
        ...localConfigValueAndMeta.meta,
        targetId,
        lastSyncedAt: now,
      })
      return { status: "success", action: "no-change" }
    } catch (error) {
      logger.error("Config sync failed", error)
      return {
        status: "error",
        error: error instanceof Error ? error : new Error(String(error)),
      }
    }
  }

  return { syncConfig, syncMergedConfig }
}
