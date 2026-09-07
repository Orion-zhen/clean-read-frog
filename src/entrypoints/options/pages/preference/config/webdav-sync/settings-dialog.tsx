import type { WebDavSettings } from "@/utils/webdav/settings"
import { useState } from "react"
import { Button } from "@/components/ui/base-ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/base-ui/dialog"
import { Input } from "@/components/ui/base-ui/input"
import { Label } from "@/components/ui/base-ui/label"
import { toastManager } from "@/components/ui/base-ui/toast"
import { i18n } from "@/utils/i18n"
import { createWebDavClient } from "@/utils/webdav/client"
import { webDavErrorMessage } from "@/utils/webdav/errors"
import { parseWebDavSettings, saveWebDavSettings } from "@/utils/webdav/settings"

export function WebDavSettingsDialog({
  settings,
  onClose,
}: {
  settings: WebDavSettings | null
  onClose: () => void
}) {
  const [draft, setDraft] = useState<WebDavSettings>(
    () => settings ?? { directoryUrl: "", username: "", password: "" },
  )
  const [pending, setPending] = useState(false)

  async function submit(testOnly: boolean) {
    setPending(true)
    try {
      const parsed = parseWebDavSettings(draft)
      if (testOnly) {
        await createWebDavClient(parsed).checkDirectory()
        toastManager.add({
          type: "success",
          title: i18n.t("options.preference.config.webdav.testSuccess"),
        })
      } else {
        await saveWebDavSettings(parsed)
        onClose()
      }
    } catch (error) {
      toastManager.add({ type: "error", title: webDavErrorMessage(error) })
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent className="sm:max-w-lg" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>{i18n.t("options.preference.config.webdav.title")}</DialogTitle>
          <DialogDescription>
            {i18n.t("options.preference.config.webdav.setupDescription")}
          </DialogDescription>
        </DialogHeader>
        <form
          id="webdav-settings"
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit(false)
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="webdav-url">
              {i18n.t("options.preference.config.webdav.directoryUrl")}
            </Label>
            <Input
              id="webdav-url"
              type="url"
              required
              disabled={pending}
              placeholder="https://example.com/dav/read-frog/"
              value={draft.directoryUrl}
              onChange={(event) => setDraft({ ...draft, directoryUrl: event.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="webdav-username">
              {i18n.t("options.preference.config.webdav.username")}
            </Label>
            <Input
              id="webdav-username"
              autoComplete="username"
              required
              disabled={pending}
              value={draft.username}
              onChange={(event) => setDraft({ ...draft, username: event.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="webdav-password">
              {i18n.t("options.preference.config.webdav.password")}
            </Label>
            <Input
              id="webdav-password"
              type="password"
              autoComplete="current-password"
              required
              disabled={pending}
              value={draft.password}
              onChange={(event) => setDraft({ ...draft, password: event.target.value })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {i18n.t("options.preference.config.webdav.securityNotice")}
          </p>
        </form>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => void submit(true)}>
            {i18n.t("options.preference.config.webdav.test")}
          </Button>
          <Button type="submit" form="webdav-settings" disabled={pending}>
            {i18n.t("options.preference.config.webdav.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
