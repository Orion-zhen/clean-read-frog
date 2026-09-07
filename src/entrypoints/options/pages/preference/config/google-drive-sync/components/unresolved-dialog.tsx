import { useAtomValue } from "jotai"
import { useState } from "react"
import { toastManager } from "@/components/ui/base-ui/toast"
import { useGoogleDriveAuth } from "@/hooks/use-google-drive-auth"
import { resolvedConfigResultAtom, unresolvedConfigsAtom } from "@/utils/atoms/config-sync"
import { syncMergedConfig } from "@/utils/google-drive/sync"
import { logger } from "@/utils/logger"
import { UnresolvedDialog as ConfigSyncUnresolvedDialog } from "../../config-sync/unresolved-dialog"

interface UnresolvedDialogProps {
  open: boolean
  onResolved: () => void
  onCancelled: () => void
}

export function UnresolvedDialog({ open, onResolved, onCancelled }: UnresolvedDialogProps) {
  const [isConfirming, setIsConfirming] = useState(false)
  const unresolvedConfigs = useAtomValue(unresolvedConfigsAtom)
  const resolvedConfigResult = useAtomValue(resolvedConfigResultAtom)
  const {
    query: { data: authData },
  } = useGoogleDriveAuth()
  const email = authData?.userInfo?.email

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
