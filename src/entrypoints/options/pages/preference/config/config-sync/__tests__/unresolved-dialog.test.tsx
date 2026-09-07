// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { createStore, Provider } from "jotai"
import { describe, expect, it, vi } from "vitest"
import {
  resolutionsAtom,
  resolvedConfigResultAtom,
  unresolvedConfigsAtom,
} from "@/utils/atoms/config-sync"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { UnresolvedDialog } from "../unresolved-dialog"

function createConflictStore() {
  const store = createStore()
  const base = structuredClone(DEFAULT_CONFIG)
  store.set(unresolvedConfigsAtom, {
    base,
    local: { ...base, uiLanguage: "en" },
    remote: { ...base, uiLanguage: "zh-CN" },
  })
  return store
}

const key = "options.preference.config.googleDrive.unresolved."

describe("shared conflict dialog", () => {
  it("requires resolutions and calls the injected confirmation handler", () => {
    const store = createConflictStore()
    const otherStore = createConflictStore()
    const onConfirm = vi.fn<() => void>()
    render(
      <Provider store={store}>
        <UnresolvedDialog
          open
          isConfirming={false}
          onConfirm={onConfirm}
          onCancelled={vi.fn<() => void>()}
        />
      </Provider>,
    )

    const confirm = screen.getByRole("button", { name: `${key}confirm` })
    expect(confirm).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: `${key}useAllRemote` }))
    expect(confirm).toBeEnabled()
    expect(store.get(resolvedConfigResultAtom)?.config?.uiLanguage).toBe("zh-CN")
    expect(otherStore.get(resolutionsAtom)).toEqual({})
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it("delegates cancellation without submitting", () => {
    const onConfirm = vi.fn<() => void>()
    const onCancelled = vi.fn<() => void>()
    render(
      <Provider store={createConflictStore()}>
        <UnresolvedDialog
          open
          isConfirming={false}
          onConfirm={onConfirm}
          onCancelled={onCancelled}
        />
      </Provider>,
    )
    fireEvent.click(screen.getByRole("button", { name: `${key}cancel` }))
    expect(onCancelled).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it("disables confirmation, cancellation and bulk selection during submission", () => {
    render(
      <Provider store={createConflictStore()}>
        <UnresolvedDialog
          open
          isConfirming
          onConfirm={vi.fn<() => void>()}
          onCancelled={vi.fn<() => void>()}
        />
      </Provider>,
    )
    for (const name of [
      "options.preference.config.googleDrive.syncing",
      `${key}cancel`,
      `${key}useAllLocal`,
      `${key}useAllRemote`,
    ]) {
      expect(screen.getByRole("button", { name })).toBeDisabled()
    }
  })
})
