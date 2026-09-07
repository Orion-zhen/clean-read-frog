// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { browser } from "wxt/browser"
import { getLocalConfigAndMeta, setLocalConfigAndMeta } from "@/utils/config/storage"
import { CONFIG_SCHEMA_VERSION, DEFAULT_CONFIG } from "@/utils/constants/config"
import { getWebDavSettings } from "@/utils/webdav/settings"
import { WebDavSyncConfigItem } from ".."

const fetchMock = vi.fn<typeof fetch>()
const key = "options.preference.config.webdav."

beforeEach(async () => {
  await browser.storage.local.clear()
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockReset()
  await setLocalConfigAndMeta(structuredClone(DEFAULT_CONFIG), {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    lastModifiedAt: 1000,
  })
})
afterEach(() => vi.unstubAllGlobals())

it("saves a connection and requires confirmation before replacing local config on first sync", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <WebDavSyncConfigItem />
    </QueryClientProvider>,
  )
  const configure = screen.getByRole("button", { name: `${key}configure` })
  await waitFor(() => expect(configure).toBeEnabled())
  expect(screen.getByRole("button", { name: `${key}sync` })).toBeDisabled()
  fireEvent.click(configure)
  fireEvent.change(screen.getByLabelText(`${key}directoryUrl`), {
    target: { value: "https://dav.example/config/" },
  })
  fireEvent.change(screen.getByLabelText(`${key}username`), { target: { value: "user" } })
  fireEvent.change(screen.getByLabelText(`${key}password`), { target: { value: "app-secret" } })
  expect(screen.getByLabelText(`${key}password`)).toHaveAttribute("type", "password")
  fireEvent.click(screen.getByRole("button", { name: `${key}save` }))
  await waitFor(async () => expect(await getWebDavSettings()).toMatchObject({ username: "user" }))

  const sync = screen.getByRole("button", { name: `${key}sync` })
  await waitFor(() => expect(sync).toBeEnabled())
  fireEvent.click(sync)
  await screen.findByText(`${key}firstSyncTitle`)
  expect(fetchMock).not.toHaveBeenCalled()
  fireEvent.click(
    screen.getByRole("button", { name: "options.preference.config.googleDrive.unresolved.cancel" }),
  )
  expect(fetchMock).not.toHaveBeenCalled()

  const remote = { ...structuredClone(DEFAULT_CONFIG), uiLanguage: "zh-CN" }
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        value: remote,
        meta: { schemaVersion: CONFIG_SCHEMA_VERSION, lastModifiedAt: 2000 },
      }),
    ),
  )
  await waitFor(() => expect(sync).toBeEnabled())
  fireEvent.click(sync)
  await screen.findByText(`${key}firstSyncTitle`)
  fireEvent.click(
    screen.getByRole("button", {
      name: "options.preference.config.googleDrive.unresolved.confirm",
    }),
  )
  await waitFor(async () => expect((await getLocalConfigAndMeta()).value).toEqual(remote))
  expect(fetchMock).toHaveBeenCalledTimes(1)
  view.unmount()
  queryClient.clear()
})
