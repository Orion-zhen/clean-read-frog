import { ConfigVersionTooNewError } from "@/utils/config/errors"
import { i18n } from "@/utils/i18n"

export type WebDavErrorCode =
  | "invalidSettings"
  | "unauthorized"
  | "forbidden"
  | "notFound"
  | "notCollection"
  | "unsupported"
  | "remoteChanged"
  | "invalidConfig"
  | "invalidBaseline"
  | "tooLarge"
  | "timeout"
  | "network"
  | "http"

export class WebDavError extends Error {
  constructor(
    readonly code: WebDavErrorCode,
    readonly status?: number,
  ) {
    super(`WebDAV: ${code}${status === undefined ? "" : ` (HTTP ${status})`}`)
    this.name = "WebDavError"
  }
}

export function webDavErrorMessage(error: unknown): string {
  if (error instanceof ConfigVersionTooNewError) return error.message
  if (error instanceof WebDavError) {
    const message = i18n.t(`options.preference.config.webdav.errors.${error.code}`)
    return error.status === undefined ? message : `${message} (HTTP ${error.status})`
  }
  return i18n.t("options.preference.config.webdav.errors.operation")
}
