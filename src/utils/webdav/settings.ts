import { z } from "zod"
import { storage } from "#imports"
import { WebDavError } from "./errors"

export const WEBDAV_SETTINGS_KEY = "local:webdavSettings" as const
export const WEBDAV_BASELINE_KEY = "local:webdavSyncBaseline" as const
const WEBDAV_CONFIG_FILENAME = "read-frog-config.json"

const settingsSchema = z.object({
  directoryUrl: z.string().trim().url(),
  username: z
    .string()
    .min(1)
    .refine((value) => !value.includes(":")),
  password: z.string().min(1),
})

export type WebDavSettings = z.infer<typeof settingsSchema>

export function parseWebDavSettings(input: unknown): WebDavSettings {
  const result = settingsSchema.safeParse(input)
  if (!result.success) throw new WebDavError("invalidSettings")
  const url = new URL(result.data.directoryUrl)
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new WebDavError("invalidSettings")
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/"
  return { ...result.data, directoryUrl: url.href }
}

export function webDavFileUrl(settings: WebDavSettings): string {
  return new URL(WEBDAV_CONFIG_FILENAME, settings.directoryUrl).href
}

export function webDavTargetId(settings: WebDavSettings): string {
  return JSON.stringify([webDavFileUrl(settings), settings.username])
}

export async function getWebDavSettings(): Promise<WebDavSettings | null> {
  const value = await storage.getItem<unknown>(WEBDAV_SETTINGS_KEY)
  return value === null ? null : parseWebDavSettings(value)
}

export async function saveWebDavSettings(input: WebDavSettings): Promise<void> {
  await storage.setItem(WEBDAV_SETTINGS_KEY, parseWebDavSettings(input))
}

export async function clearWebDavSettings(): Promise<void> {
  await Promise.all([
    storage.removeItem(WEBDAV_SETTINGS_KEY),
    storage.removeItem(WEBDAV_BASELINE_KEY),
  ])
}
