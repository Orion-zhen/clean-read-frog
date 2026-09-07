import type { Config } from "@/types/config/config"
import type { ConfigValueAndMeta } from "@/types/config/meta"
import type { SyncBaseline, SyncBaselineMeta } from "@/utils/config-sync/types"
import { z } from "zod"
import { storage } from "#imports"
import { ConfigVersionTooNewError } from "@/utils/config/errors"
import { migrateConfig } from "@/utils/config/migration"
import { CONFIG_SCHEMA_VERSION } from "@/utils/constants/config"
import { WebDavError } from "./errors"
import { WEBDAV_BASELINE_KEY } from "./settings"

const metaSchema = z.object({
  schemaVersion: z.number().int().positive(),
  lastModifiedAt: z.number().int().nonnegative(),
})
const envelopeSchema = z.object({ value: z.unknown(), meta: metaSchema })
const baselineSchema = envelopeSchema.extend({
  meta: metaSchema.extend({ targetId: z.string(), lastSyncedAt: z.number().nonnegative() }),
})

export async function parseRemoteConfig(content: string): Promise<ConfigValueAndMeta> {
  try {
    const data = envelopeSchema.parse(JSON.parse(content))
    const value = await migrateConfig(data.value, data.meta.schemaVersion)
    return { value, meta: { ...data.meta, schemaVersion: CONFIG_SCHEMA_VERSION } }
  } catch (error) {
    if (error instanceof ConfigVersionTooNewError) throw error
    throw new WebDavError("invalidConfig")
  }
}

export async function getWebDavBaseline(): Promise<SyncBaseline | null> {
  const raw = await storage.getItem<unknown>(WEBDAV_BASELINE_KEY)
  if (raw === null) return null
  try {
    const data = baselineSchema.parse(raw)
    const value = await migrateConfig(data.value, data.meta.schemaVersion)
    return { value, meta: { ...data.meta, schemaVersion: CONFIG_SCHEMA_VERSION } }
  } catch (error) {
    if (error instanceof ConfigVersionTooNewError) throw error
    throw new WebDavError("invalidBaseline")
  }
}

export async function saveWebDavBaseline(value: Config, meta: SyncBaselineMeta): Promise<void> {
  await storage.setItem(WEBDAV_BASELINE_KEY, { value, meta })
}
