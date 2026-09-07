import type { WebDavSyncResult } from "@/utils/webdav/sync"
import { createStore, Provider } from "jotai"
import { useState } from "react"
import { toastManager } from "@/components/ui/base-ui/toast"
import { resolvedConfigResultAtom, unresolvedConfigsAtom } from "@/utils/atoms/config-sync"
import { i18n } from "@/utils/i18n"
import { webDavErrorMessage } from "@/utils/webdav/errors"
import { UnresolvedDialog } from "../config-sync/unresolved-dialog"

export function WebDavConflictDialog({
  conflict,
  onClose,
}: {
  conflict: Extract<WebDavSyncResult, { status: "unresolved" }>
  onClose: () => void
}) {
  const [store] = useState(() => {
    const next = createStore()
    next.set(unresolvedConfigsAtom, conflict.data)
    return next
  })
  const [pending, setPending] = useState(false)

  async function confirm() {
    const config = store.get(resolvedConfigResultAtom)?.config
    if (!config) return
    setPending(true)
    try {
      await conflict.complete(config)
      toastManager.add({
        type: "success",
        title: i18n.t("options.preference.config.googleDrive.syncSuccess.unresolved"),
      })
    } catch (error) {
      toastManager.add({ type: "error", title: webDavErrorMessage(error) })
    } finally {
      // A failed conditional upload needs a fresh read, not a retry with the old ETag.
      onClose()
    }
  }

  return (
    <Provider store={store}>
      <UnresolvedDialog
        open
        isConfirming={pending}
        onConfirm={() => void confirm()}
        onCancelled={onClose}
      />
    </Provider>
  )
}
