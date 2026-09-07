import type { WebDavSettings } from "@/utils/webdav/settings"
import type { WebDavSyncResult } from "@/utils/webdav/sync"
import { Icon } from "@iconify/react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { storage } from "#imports"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/base-ui/alert-dialog"
import { Button } from "@/components/ui/base-ui/button"
import { toastManager } from "@/components/ui/base-ui/toast"
import { i18n } from "@/utils/i18n"
import { webDavErrorMessage } from "@/utils/webdav/errors"
import {
  clearWebDavSettings,
  getWebDavSettings,
  WEBDAV_BASELINE_KEY,
  WEBDAV_SETTINGS_KEY,
  webDavTargetId,
} from "@/utils/webdav/settings"
import { getWebDavBaseline } from "@/utils/webdav/storage"
import { syncWebDavConfig } from "@/utils/webdav/sync"
import { ConfigItem } from "../../../../components/config-item"
import { WebDavConflictDialog } from "./conflict-dialog"
import { WebDavSettingsDialog } from "./settings-dialog"

const queryKey = ["webdav"] as const

export function WebDavSyncConfigItem() {
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({
    queryKey: [...queryKey, "settings"],
    queryFn: getWebDavSettings,
  })
  const baselineQuery = useQuery({
    queryKey: [...queryKey, "baseline"],
    queryFn: getWebDavBaseline,
  })
  const settings = settingsQuery.data
  const [editing, setEditing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [firstSync, setFirstSync] = useState<WebDavSettings | null>(null)
  const [conflict, setConflict] = useState<Extract<
    WebDavSyncResult,
    { status: "unresolved" }
  > | null>(null)
  const busy = syncing || firstSync !== null || conflict !== null

  useEffect(() => {
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey })
    }
    const unwatchSettings = storage.watch(WEBDAV_SETTINGS_KEY, invalidate)
    const unwatchBaseline = storage.watch(WEBDAV_BASELINE_KEY, invalidate)
    return () => {
      unwatchSettings()
      unwatchBaseline()
    }
  }, [queryClient])

  async function runSync(connection: WebDavSettings) {
    setSyncing(true)
    try {
      const result = await syncWebDavConfig(connection)
      if (result.status === "unresolved") {
        setConflict(result)
      } else if (result.status === "error") {
        toastManager.add({ type: "error", title: webDavErrorMessage(result.error) })
      } else {
        const messages = {
          uploaded: i18n.t("options.preference.config.googleDrive.syncSuccess.uploaded"),
          downloaded: i18n.t("options.preference.config.googleDrive.syncSuccess.downloaded"),
          "same-changes": i18n.t("options.preference.config.googleDrive.syncSuccess.sameChanges"),
          "no-change": i18n.t("options.preference.config.googleDrive.syncSuccess.noChange"),
        }
        toastManager.add({ type: "success", title: messages[result.action] })
      }
    } finally {
      setSyncing(false)
    }
  }

  async function startSync() {
    if (!settings) return
    setSyncing(true)
    try {
      const baseline = await getWebDavBaseline()
      if (baseline?.meta.targetId !== webDavTargetId(settings)) {
        setFirstSync(settings)
      } else {
        await runSync(settings)
      }
    } catch (error) {
      toastManager.add({ type: "error", title: webDavErrorMessage(error) })
    } finally {
      setSyncing(false)
    }
  }

  async function disconnect() {
    setSyncing(true)
    try {
      await clearWebDavSettings()
    } catch (error) {
      toastManager.add({ type: "error", title: webDavErrorMessage(error) })
    } finally {
      setSyncing(false)
    }
  }

  const baseline = baselineQuery.data
  const lastSyncedAt =
    settings && baseline?.meta.targetId === webDavTargetId(settings)
      ? baseline.meta.lastSyncedAt
      : null
  const queryError = settingsQuery.error ?? baselineQuery.error

  return (
    <>
      <ConfigItem
        id="webdav-sync"
        title={i18n.t("options.preference.config.webdav.title")}
        description={
          <div className="flex flex-col gap-2">
            <span>{i18n.t("options.preference.config.webdav.description")}</span>
            <span className="text-xs">
              {i18n.t("options.preference.config.webdav.concurrencyNotice")}
            </span>
            {queryError && (
              <span role="alert" className="text-destructive">
                {webDavErrorMessage(queryError)}
              </span>
            )}
          </div>
        }
      >
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy || settingsQuery.isPending}
              onClick={() => setEditing(true)}
            >
              {i18n.t("options.preference.config.webdav.configure")}
            </Button>
            {(settings || queryError) && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void disconnect()}>
                {i18n.t("options.preference.config.webdav.disconnect")}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !settings}
              onClick={() => void startSync()}
            >
              <Icon icon="mdi:cloud-sync-outline" />
              {syncing
                ? i18n.t("options.preference.config.googleDrive.syncing")
                : i18n.t("options.preference.config.webdav.sync")}
            </Button>
          </div>
          {lastSyncedAt !== null && (
            <span className="text-xs text-muted-foreground">
              {i18n.t("options.preference.config.googleDrive.lastSyncTime")}:{" "}
              {new Date(lastSyncedAt).toLocaleString()}
            </span>
          )}
        </div>
      </ConfigItem>
      {editing && (
        <WebDavSettingsDialog settings={settings ?? null} onClose={() => setEditing(false)} />
      )}
      {conflict && <WebDavConflictDialog conflict={conflict} onClose={() => setConflict(null)} />}
      {firstSync && (
        <AlertDialog open>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {i18n.t("options.preference.config.webdav.firstSyncTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {i18n.t("options.preference.config.webdav.firstSyncDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setFirstSync(null)}>
                {i18n.t("options.preference.config.googleDrive.unresolved.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const connection = firstSync
                  setFirstSync(null)
                  void runSync(connection)
                }}
              >
                {i18n.t("options.preference.config.googleDrive.unresolved.confirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  )
}
