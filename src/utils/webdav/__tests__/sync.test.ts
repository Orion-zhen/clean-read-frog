// @vitest-environment jsdom
import type { ConfigValueAndMeta } from "@/types/config/meta"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { browser } from "wxt/browser"
import { storage } from "#imports"
import { ConfigVersionTooNewError } from "@/utils/config/errors"
import { getLocalConfigAndMeta, setLocalConfigAndMeta } from "@/utils/config/storage"
import {
  CONFIG_SCHEMA_VERSION,
  DEFAULT_CONFIG,
  LAST_SYNCED_CONFIG_STORAGE_KEY,
} from "@/utils/constants/config"
import { createWebDavClient } from "../client"
import {
  clearWebDavSettings,
  getWebDavSettings,
  parseWebDavSettings,
  saveWebDavSettings,
  webDavTargetId,
} from "../settings"
import { getWebDavBaseline, saveWebDavBaseline } from "../storage"
import { syncWebDavConfig } from "../sync"

const settings = parseWebDavSettings({
  directoryUrl: "https://dav.example/config",
  username: "user",
  password: "app-secret",
})
const fetchMock = vi.fn<typeof fetch>()
const directoryXml =
  '<d:multistatus xmlns:d="DAV:"><d:response><d:href>/config/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>'

function config(
  language: ConfigValueAndMeta["value"]["uiLanguage"] = "en",
  time = 1000,
): ConfigValueAndMeta {
  return {
    value: { ...structuredClone(DEFAULT_CONFIG), uiLanguage: language },
    meta: { schemaVersion: CONFIG_SCHEMA_VERSION, lastModifiedAt: time },
  }
}
function remote(value: ConfigValueAndMeta, etag = '"v1"') {
  return new Response(JSON.stringify(value), { headers: etag ? { ETag: etag } : {} })
}
function directory() {
  return new Response(directoryXml, { status: 207 })
}
function uploaded() {
  return new Response(null, { status: 204 })
}
async function baseline(value = config()) {
  await saveWebDavBaseline(value.value, {
    ...value.meta,
    targetId: webDavTargetId(settings),
    lastSyncedAt: 1000,
  })
}
function lastRequestHeaders() {
  return new Headers(fetchMock.mock.lastCall?.[1]?.headers)
}

beforeEach(async () => {
  await browser.storage.local.clear()
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  const local = config()
  await setLocalConfigAndMeta(local.value, local.meta)
})
afterEach(() => vi.unstubAllGlobals())

describe("WebDAV sync", () => {
  it("stores credentials locally and keeps Google Drive history separate", async () => {
    await storage.setItem(`local:${LAST_SYNCED_CONFIG_STORAGE_KEY}`, { google: "unchanged" })
    await saveWebDavSettings(settings)
    expect(await getWebDavSettings()).toEqual(settings)
    expect(webDavTargetId({ ...settings, password: "new-password" })).toBe(webDavTargetId(settings))
    expect(webDavTargetId({ ...settings, username: "other" })).not.toBe(webDavTargetId(settings))
    expect(settings.directoryUrl).toBe("https://dav.example/config/")

    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(directory())
      .mockResolvedValueOnce(uploaded())
    expect(await syncWebDavConfig(settings)).toEqual({ status: "success", action: "uploaded" })
    expect(lastRequestHeaders().get("If-None-Match")).toBe("*")
    expect(lastRequestHeaders().get("Authorization")).toBe(`Basic ${btoa("user:app-secret")}`)
    expect(JSON.stringify(await getWebDavBaseline())).not.toContain(settings.password)
    expect(fetchMock.mock.lastCall?.[1]?.body).not.toContain(settings.password)
    await clearWebDavSettings()
    expect(await getWebDavSettings()).toBeNull()
    expect(await getWebDavBaseline()).toBeNull()
    expect(await storage.getItem(`local:${LAST_SYNCED_CONFIG_STORAGE_KEY}`)).toEqual({
      google: "unchanged",
    })
    expect((await getLocalConfigAndMeta()).value).toEqual(config().value)
  })

  it("downloads on first sync, then syncs subsequent local and remote changes", async () => {
    const initial = config("zh-CN", 2000)
    fetchMock.mockResolvedValueOnce(remote(initial))
    expect(await syncWebDavConfig(settings)).toEqual({ status: "success", action: "downloaded" })
    expect((await getLocalConfigAndMeta()).value).toEqual(initial.value)

    const local = config("en", 3000)
    await setLocalConfigAndMeta(local.value, local.meta)
    fetchMock.mockResolvedValueOnce(remote(initial)).mockResolvedValueOnce(uploaded())
    expect(await syncWebDavConfig(settings)).toEqual({ status: "success", action: "uploaded" })
    expect(lastRequestHeaders().get("If-Match")).toBe('"v1"')

    const latest = config("zh-CN", 4000)
    fetchMock.mockResolvedValueOnce(remote(latest))
    expect(await syncWebDavConfig(settings)).toEqual({ status: "success", action: "downloaded" })
    expect((await getLocalConfigAndMeta()).value).toEqual(latest.value)
    fetchMock.mockResolvedValueOnce(remote(latest))
    expect(await syncWebDavConfig(settings)).toEqual({ status: "success", action: "no-change" })
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1)
  })

  it("resolves conflicts against the original destination and revision", async () => {
    await baseline()
    const local = config("ja", 2000)
    await setLocalConfigAndMeta(local.value, local.meta)
    fetchMock
      .mockResolvedValueOnce(remote(config("zh-CN", 3000), '"original"'))
      .mockResolvedValueOnce(uploaded())
    const connection = { ...settings }
    const result = await syncWebDavConfig(connection)
    expect(result.status).toBe("unresolved")
    if (result.status !== "unresolved") throw new Error("Expected a conflict")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    connection.directoryUrl = "https://other.example/"
    connection.password = "changed"
    await result.complete(result.data.remote)
    expect(fetchMock.mock.lastCall?.[0]).toBe("https://dav.example/config/read-frog-config.json")
    expect(lastRequestHeaders().get("If-Match")).toBe('"original"')
    expect(lastRequestHeaders().get("Authorization")).toBe(`Basic ${btoa("user:app-secret")}`)
    expect((await getWebDavBaseline())?.value).toEqual(result.data.remote)
  })

  it("does not advance the baseline when another device wins the upload race", async () => {
    await baseline()
    const local = config("ja", 2000)
    await setLocalConfigAndMeta(local.value, local.meta)
    fetchMock
      .mockResolvedValueOnce(remote(config("zh-CN", 3000)))
      .mockResolvedValueOnce(new Response(null, { status: 412 }))
    const result = await syncWebDavConfig(settings)
    if (result.status !== "unresolved") throw new Error("Expected a conflict")
    await expect(result.complete(result.data.remote)).rejects.toMatchObject({
      code: "remoteChanged",
    })
    expect((await getWebDavBaseline())?.value).toEqual(config().value)
  })

  it.each([401, 403])("does not upload or change local config after HTTP %s", async (status) => {
    fetchMock.mockResolvedValueOnce(new Response("Private server error", { status }))
    expect(await syncWebDavConfig(settings)).toMatchObject({ status: "error" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((await getLocalConfigAndMeta()).value).toEqual(config().value)
    expect(await getWebDavBaseline()).toBeNull()
  })

  it("does not replace a corrupted or newer-version remote config", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not JSON"))
    expect(await syncWebDavConfig(settings)).toMatchObject({
      status: "error",
      error: { code: "invalidConfig" },
    })
    fetchMock.mockResolvedValueOnce(
      remote({
        ...config(),
        meta: { schemaVersion: CONFIG_SCHEMA_VERSION + 1, lastModifiedAt: 1000 },
      }),
    )
    expect(await syncWebDavConfig(settings)).toMatchObject({
      status: "error",
      error: expect.any(ConfigVersionTooNewError),
    })
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true)
    expect((await getLocalConfigAndMeta()).value).toEqual(config().value)
  })

  it("requires an existing directory before creating a config file", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
    expect(await syncWebDavConfig(settings)).toMatchObject({
      status: "error",
      error: { code: "notFound" },
    })
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(["GET", "PROPFIND"])
    expect(await getWebDavBaseline()).toBeNull()
  })

  it("supports servers without an ETag without pretending to use conditional writes", async () => {
    await baseline()
    const local = config("zh-CN", 2000)
    await setLocalConfigAndMeta(local.value, local.meta)
    fetchMock.mockResolvedValueOnce(remote(config(), "")).mockResolvedValueOnce(uploaded())
    expect(await syncWebDavConfig(settings)).toEqual({ status: "success", action: "uploaded" })
    expect(lastRequestHeaders().has("If-Match")).toBe(false)
  })

  it("tests directory access without uploading a probe file", async () => {
    fetchMock.mockResolvedValueOnce(directory())
    await createWebDavClient(settings).checkDirectory()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.lastCall?.[1]).toMatchObject({
      method: "PROPFIND",
      credentials: "omit",
      redirect: "error",
    })
  })
})
