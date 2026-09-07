import type { ConfigSyncAdapter, SyncBaseline } from "../types"
import type { Config } from "@/types/config/config"
import type { ConfigValueAndMeta } from "@/types/config/meta"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { getLocalConfigAndMeta, setLocalConfigAndMeta } from "@/utils/config/storage"
import { CONFIG_SCHEMA_VERSION, DEFAULT_CONFIG } from "@/utils/constants/config"
import { createConfigSync } from "../engine"

vi.mock("@/utils/config/storage", () => ({
  getLocalConfigAndMeta: vi.fn<typeof getLocalConfigAndMeta>(),
  setLocalConfigAndMeta: vi.fn<typeof setLocalConfigAndMeta>(),
}))

function snapshot(
  uiLanguage: Config["uiLanguage"] = "en",
  lastModifiedAt = 1000,
): ConfigValueAndMeta {
  return {
    value: { ...structuredClone(DEFAULT_CONFIG), uiLanguage },
    meta: { schemaVersion: CONFIG_SCHEMA_VERSION, lastModifiedAt },
  }
}

function createTarget(targetId: string, initialRemote: ConfigValueAndMeta | null = null) {
  let remote = initialRemote
  let baseline: SyncBaseline | null = null
  const adapter: ConfigSyncAdapter = {
    readRemote: async () => ({ targetId, configValueAndMeta: remote }),
    writeRemote: vi.fn<ConfigSyncAdapter["writeRemote"]>(async (config) => {
      remote = config
    }),
    readBaseline: async () => baseline,
    writeBaseline: vi.fn<ConfigSyncAdapter["writeBaseline"]>(async (value, meta) => {
      baseline = { value, meta }
    }),
  }
  return { adapter, sync: createConfigSync(adapter) }
}

describe("provider-independent config sync", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getLocalConfigAndMeta).mockResolvedValue(snapshot())
    vi.mocked(setLocalConfigAndMeta).mockResolvedValue(undefined)
  })

  it("keeps independent targets' remote files and baselines separate", async () => {
    const first = createTarget("target-a")
    const secondRemote = snapshot("zh-CN", 2000)
    const second = createTarget("target-b", secondRemote)

    expect(await first.sync.syncConfig()).toEqual({ status: "success", action: "uploaded" })
    const firstBaseline = await first.adapter.readBaseline()
    expect(firstBaseline?.meta.targetId).toBe("target-a")
    expect(await second.adapter.readBaseline()).toBeNull()

    expect(await second.sync.syncConfig()).toEqual({ status: "success", action: "downloaded" })
    expect(await second.adapter.readBaseline()).toMatchObject({
      value: secondRemote.value,
      meta: { targetId: "target-b" },
    })
    expect(await first.adapter.readBaseline()).toEqual(firstBaseline)
    expect((await first.adapter.readRemote()).configValueAndMeta).toEqual(snapshot())
    expect(second.adapter.writeRemote).not.toHaveBeenCalled()
  })

  it("treats a different target identity as a first sync", async () => {
    const target = createTarget("old-target")
    await target.sync.syncConfig()
    const nextRemote = snapshot("zh-CN", 500)
    const nextSync = createConfigSync({
      ...target.adapter,
      readRemote: async () => ({ targetId: "new-target", configValueAndMeta: nextRemote }),
    })

    expect(await nextSync.syncConfig()).toEqual({ status: "success", action: "downloaded" })
    expect(setLocalConfigAndMeta).toHaveBeenCalledWith(nextRemote.value, nextRemote.meta)
    expect(await target.adapter.readBaseline()).toMatchObject({ meta: { targetId: "new-target" } })
  })

  it("returns a three-way conflict without changing the remote or baseline", async () => {
    const target = createTarget("target")
    await target.sync.syncConfig()
    const base = await target.adapter.readBaseline()
    const remote = snapshot("zh-CN", 2000)
    await target.adapter.writeRemote(remote)
    const local = snapshot("ja", 3000)
    vi.mocked(getLocalConfigAndMeta).mockResolvedValue(local)
    vi.mocked(target.adapter.writeRemote).mockClear()
    vi.mocked(target.adapter.writeBaseline).mockClear()

    expect(await target.sync.syncConfig()).toEqual({
      status: "unresolved",
      data: { base: base?.value, local: local.value, remote: remote.value },
    })
    expect(target.adapter.writeRemote).not.toHaveBeenCalled()
    expect(target.adapter.writeBaseline).not.toHaveBeenCalled()
    expect(setLocalConfigAndMeta).not.toHaveBeenCalled()
  })

  it("does not advance the baseline when an upload fails", async () => {
    const target = createTarget("target")
    const error = new Error("Upload failed")
    vi.mocked(target.adapter.writeRemote).mockRejectedValueOnce(error)

    expect(await target.sync.syncConfig()).toEqual({ status: "error", error })
    expect(await target.adapter.readBaseline()).toBeNull()
  })

  it("returns a baseline persistence failure instead of reporting success", async () => {
    const target = createTarget("target")
    const error = new Error("Storage failed")
    vi.mocked(target.adapter.writeBaseline).mockRejectedValueOnce(error)

    expect(await target.sync.syncConfig()).toEqual({ status: "error", error })
    expect(await target.adapter.readBaseline()).toBeNull()
  })

  it("validates and saves a resolved config using the supplied target identity", async () => {
    const target = createTarget("target")
    const merged = snapshot("zh-CN").value

    await target.sync.syncMergedConfig(merged, "target")

    const remote = (await target.adapter.readRemote()).configValueAndMeta
    const baseline = await target.adapter.readBaseline()
    expect(remote?.value).toEqual(merged)
    expect(remote?.meta.schemaVersion).toBe(CONFIG_SCHEMA_VERSION)
    expect(setLocalConfigAndMeta).toHaveBeenCalledWith(merged, remote?.meta)
    expect(baseline).toEqual({
      value: merged,
      meta: { ...remote?.meta, targetId: "target", lastSyncedAt: expect.any(Number) },
    })
  })

  it("rejects an invalid merged config before any writes", async () => {
    const target = createTarget("target")
    const invalidConfig = snapshot().value
    invalidConfig.selectionToolbar.noteSuggestion.actionId = "missing-action"

    await expect(target.sync.syncMergedConfig(invalidConfig, "target")).rejects.toThrow(
      "Merged config is invalid for syncing",
    )
    expect(setLocalConfigAndMeta).not.toHaveBeenCalled()
    expect(target.adapter.writeRemote).not.toHaveBeenCalled()
    expect(await target.adapter.readBaseline()).toBeNull()
  })

  it("stops before uploading a merged config if the local write fails", async () => {
    const target = createTarget("target")
    const error = new Error("Local write failed")
    vi.mocked(setLocalConfigAndMeta).mockRejectedValueOnce(error)

    await expect(target.sync.syncMergedConfig(snapshot().value, "target")).rejects.toBe(error)
    expect(target.adapter.writeRemote).not.toHaveBeenCalled()
    expect(await target.adapter.readBaseline()).toBeNull()
  })

  it("preserves local-first merged writes but does not advance the baseline on upload failure", async () => {
    const target = createTarget("target")
    const error = new Error("Upload failed")
    vi.mocked(target.adapter.writeRemote).mockRejectedValueOnce(error)
    const merged = snapshot().value

    await expect(target.sync.syncMergedConfig(merged, "target")).rejects.toBe(error)
    expect(setLocalConfigAndMeta).toHaveBeenCalledWith(merged, expect.any(Object))
    expect(await target.adapter.readBaseline()).toBeNull()
  })
})
