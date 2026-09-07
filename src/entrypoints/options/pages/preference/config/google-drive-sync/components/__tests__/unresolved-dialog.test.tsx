// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createStore, Provider } from "jotai"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { toastManager } from "@/components/ui/base-ui/toast"
import { useGoogleDriveAuth } from "@/hooks/use-google-drive-auth"
import { selectAllRemoteAtom, unresolvedConfigsAtom } from "@/utils/atoms/config-sync"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { syncMergedConfig } from "@/utils/google-drive/sync"
import { UnresolvedDialog } from "../unresolved-dialog"

vi.mock("@/hooks/use-google-drive-auth", () => ({
  useGoogleDriveAuth: vi.fn<() => { query: { data?: { userInfo?: { email: string } } } }>(),
}))
vi.mock("@/utils/google-drive/sync", () => ({
  syncMergedConfig: vi.fn<typeof syncMergedConfig>(),
}))
vi.mock("@/components/ui/base-ui/toast", () => ({
  toastManager: { add: vi.fn<() => void>() },
}))

function mountDialog() {
  const store = createStore()
  const base = structuredClone(DEFAULT_CONFIG)
  const remote = { ...base, uiLanguage: "zh-CN" as const }
  store.set(unresolvedConfigsAtom, { base, local: { ...base, uiLanguage: "en" }, remote })
  store.set(selectAllRemoteAtom)
  const onResolved = vi.fn<() => void>()
  const onCancelled = vi.fn<() => void>()
  render(
    <Provider store={store}>
      <UnresolvedDialog open onResolved={onResolved} onCancelled={onCancelled} />
    </Provider>,
  )
  return { remote, onResolved, onCancelled }
}

function confirm() {
  fireEvent.click(
    screen.getByRole("button", {
      name: "options.preference.config.googleDrive.unresolved.confirm",
    }),
  )
}

describe("Google Drive conflict submission", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(useGoogleDriveAuth).mockReturnValue({
      query: { data: { userInfo: { email: "user@example.com" } } },
    } as ReturnType<typeof useGoogleDriveAuth>)
    vi.mocked(syncMergedConfig).mockResolvedValue(undefined)
  })

  it("submits the selected config with the Google account email", async () => {
    const { remote, onResolved, onCancelled } = mountDialog()
    confirm()
    await waitFor(() => expect(onResolved).toHaveBeenCalledOnce())
    expect(syncMergedConfig).toHaveBeenCalledWith(remote, "user@example.com")
    expect(onCancelled).not.toHaveBeenCalled()
  })

  it("keeps the dialog open when the email is unavailable", () => {
    vi.mocked(useGoogleDriveAuth).mockReturnValue({ query: { data: undefined } } as ReturnType<
      typeof useGoogleDriveAuth
    >)
    const { onResolved, onCancelled } = mountDialog()
    confirm()
    expect(toastManager.add).toHaveBeenCalledWith({
      type: "error",
      title: "Email is not available",
    })
    expect(syncMergedConfig).not.toHaveBeenCalled()
    expect(onResolved).not.toHaveBeenCalled()
    expect(onCancelled).not.toHaveBeenCalled()
  })

  it("delegates upload errors to the existing cancellation path", async () => {
    vi.mocked(syncMergedConfig).mockRejectedValueOnce(new Error("Upload failed"))
    const { onResolved, onCancelled } = mountDialog()
    confirm()
    await waitFor(() => expect(onCancelled).toHaveBeenCalledOnce())
    expect(onResolved).not.toHaveBeenCalled()
  })

  it("does not upload when cancelled", () => {
    const { onCancelled } = mountDialog()
    fireEvent.click(
      screen.getByRole("button", {
        name: "options.preference.config.googleDrive.unresolved.cancel",
      }),
    )
    expect(onCancelled).toHaveBeenCalledOnce()
    expect(syncMergedConfig).not.toHaveBeenCalled()
  })
})
