import { useAtomValue } from "jotai"
import { useState } from "react"
import { toastManager } from "@/components/ui/base-ui/toast"
import { resolvedConfigResultAtom, unresolvedConfigsAtom } from "@/utils/atoms/config-sync"
import { GoogleAccountChangedError } from "@/utils/google-drive/auth"
import { syncMergedConfig } from "@/utils/google-drive/sync"
import { i18n } from "@/utils/i18n"
import { logger } from "@/utils/logger"
import { UnresolvedDialog as ConfigSyncUnresolvedDialog } from "../../config-sync/unresolved-dialog"

interface UnresolvedDialogProps {
  open: boolean
  email: string | undefined
  onResolved: () => void
  onCancelled: () => void
}

export function UnresolvedDialog({ open, email, onResolved, onCancelled }: UnresolvedDialogProps) {
  const [isConfirming, setIsConfirming] = useState(false)
  const unresolvedConfigs = useAtomValue(unresolvedConfigsAtom)
  const resolvedConfigResult = useAtomValue(resolvedConfigResultAtom)

  const handleConfirm = async () => {
    if (!resolvedConfigResult?.config || !unresolvedConfigs) {
      return
    }
    if (!email) {
      toastManager.add({ type: "error", title: "Email is not available" })
      return
    }
    setIsConfirming(true)
    try {
      await syncMergedConfig(resolvedConfigResult.config, email)
      onResolved()
    } catch (error) {
      logger.error("Failed to sync merged config", error)
      // Worth naming: "sync failed, try again" would send the user round the
      // same loop, when what they need to know is which account they are on.
      if (error instanceof GoogleAccountChangedError) {
        toastManager.add({
          type: "error",
          title: i18n.t("options.preference.config.googleDrive.accountChangedError"),
        })
      }
      onCancelled()
    } finally {
      setIsConfirming(false)
    }
  }

  const handleCancel = () => {
    logger.info("Conflict resolution cancelled")
    onCancelled()
  }

  return (
    <ConfigSyncUnresolvedDialog
      open={open}
      isConfirming={isConfirming}
      onConfirm={() => void handleConfirm()}
      onCancelled={handleCancel}
    />
  )
}
