import type { WebDavSettings } from "./settings"
import { WebDavError } from "./errors"
import { webDavFileUrl } from "./settings"

const WEBDAV_TIMEOUT_MS = 30_000
const WEBDAV_MAX_FILE_BYTES = 10 * 1024 * 1024
const DAV_NAMESPACE = "DAV:"

function transportError(error: unknown): WebDavError {
  if (error instanceof WebDavError) return error
  const timedOut =
    error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
  return new WebDavError(timedOut ? "timeout" : "network")
}

async function assertSuccess(response: Response): Promise<void> {
  if (response.ok) return
  await response.body?.cancel()
  const codes = {
    401: "unauthorized",
    403: "forbidden",
    404: "notFound",
    405: "unsupported",
    409: "notFound",
    412: "remoteChanged",
  } as const
  throw new WebDavError(codes[response.status as keyof typeof codes] ?? "http", response.status)
}

async function readText(response: Response): Promise<string> {
  if (!response.body) return ""
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > WEBDAV_MAX_FILE_BYTES) {
        await reader.cancel()
        throw new WebDavError("tooLarge")
      }
      chunks.push(decoder.decode(value, { stream: true }))
    }
    chunks.push(decoder.decode())
    return chunks.join("")
  } catch (error) {
    throw transportError(error)
  } finally {
    reader.releaseLock()
  }
}

/** Runs in the options page, where DOMParser and extension host permissions are available. */
export function createWebDavClient(settings: WebDavSettings) {
  const directoryUrl = settings.directoryUrl
  const fileUrl = webDavFileUrl(settings)
  const credentials = new TextEncoder().encode(`${settings.username}:${settings.password}`)
  const authorization = `Basic ${btoa(Array.from(credentials, (byte) => String.fromCharCode(byte)).join(""))}`

  async function request(url: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set("Authorization", authorization)
    try {
      return await fetch(url, {
        ...init,
        headers,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(WEBDAV_TIMEOUT_MS),
      })
    } catch (error) {
      // Fetch errors can contain the URL. Never propagate them or response bodies to logs/UI.
      throw transportError(error)
    }
  }

  async function checkDirectory(): Promise<void> {
    const response = await request(directoryUrl, {
      method: "PROPFIND",
      headers: { Depth: "0", "Content-Type": "application/xml; charset=utf-8" },
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
    })
    await assertSuccess(response)
    const document = new DOMParser().parseFromString(await readText(response), "application/xml")
    if (document.querySelector("parsererror")) throw new WebDavError("notCollection")
    for (const entry of document.getElementsByTagNameNS(DAV_NAMESPACE, "response")) {
      const href = entry.getElementsByTagNameNS(DAV_NAMESPACE, "href")[0]?.textContent?.trim()
      if (!href) continue
      let target: URL
      try {
        target = new URL(href, directoryUrl)
      } catch {
        throw new WebDavError("notCollection")
      }
      if (!target.pathname.endsWith("/")) target.pathname += "/"
      if (target.href !== directoryUrl) continue
      for (const propstat of entry.getElementsByTagNameNS(DAV_NAMESPACE, "propstat")) {
        const status = propstat.getElementsByTagNameNS(DAV_NAMESPACE, "status")[0]?.textContent
        if (
          status &&
          /^HTTP\/\S+ 200(?:\s|$)/.test(status.trim()) &&
          propstat.getElementsByTagNameNS(DAV_NAMESPACE, "collection").length > 0
        ) {
          return
        }
      }
    }
    throw new WebDavError("notCollection")
  }

  async function readFile(): Promise<{
    content: string | null
    write: (content: string) => Promise<void>
  }> {
    const response = await request(fileUrl, { method: "GET" })
    let content: string | null
    let condition: Record<string, string>
    if (response.status === 404) {
      await response.body?.cancel()
      // A missing parent must not be mistaken for a new config file.
      await checkDirectory()
      content = null
      condition = { "If-None-Match": "*" }
    } else {
      await assertSuccess(response)
      content = await readText(response)
      const etag = response.headers.get("ETag")
      condition = etag && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag) ? { "If-Match": etag } : {}
    }

    return {
      content,
      async write(nextContent) {
        const upload = await request(fileUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/json; charset=utf-8", ...condition },
          body: nextContent,
        })
        await assertSuccess(upload)
        await upload.body?.cancel()
      },
    }
  }

  return { checkDirectory, readFile }
}
