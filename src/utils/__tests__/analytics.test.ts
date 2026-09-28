import { beforeEach, describe, expect, it, vi } from "vitest"
import { ANALYTICS_FEATURE, ANALYTICS_SURFACE } from "@/types/analytics"

const { sendMessageMock, loggerWarnMock } = vi.hoisted(() => ({
  sendMessageMock: vi.fn<(...args: any[]) => any>(),
  loggerWarnMock: vi.fn<(...args: any[]) => any>(),
}))

vi.mock("@/utils/message", () => ({
  sendMessage: sendMessageMock,
}))

vi.mock("@/utils/logger", () => ({
  logger: {
    warn: loggerWarnMock,
  },
}))

const {
  buildFeatureUsedEventProperties,
  createFeatureUsageContext,
  getLatencyMs,
  trackFeatureAttempt,
  trackFeatureUsed,
} = await import("@/utils/analytics")

describe.skipIf(__PURE_BUILD__)("analytics helpers", () => {
  beforeEach(() => {
    sendMessageMock.mockReset()
    loggerWarnMock.mockReset()
  })

  it("derives latency in milliseconds and clamps negative durations", () => {
    expect(getLatencyMs(0, 999)).toBe(999)
    expect(getLatencyMs(0, 1_500)).toBe(1_500)
    expect(getLatencyMs(10, 0)).toBe(0)
  })

  it("builds a feature_used payload with only the expected fields", () => {
    expect(
      buildFeatureUsedEventProperties({
        feature: ANALYTICS_FEATURE.PAGE_TRANSLATION,
        surface: ANALYTICS_SURFACE.POPUP,
        outcome: "success",
        startedAt: 0,
        finishedAt: 1_500,
        provider: "openai",
        backend_kind: "llm",
        translation_mode: "bilingual",
        target_language: "cmn",
        source_language: "jpn",
      }),
    ).toEqual({
      feature: ANALYTICS_FEATURE.PAGE_TRANSLATION,
      surface: ANALYTICS_SURFACE.POPUP,
      outcome: "success",
      latency_ms: 1_500,
      provider: "openai",
      backend_kind: "llm",
      translation_mode: "bilingual",
      target_language: "cmn",
      source_language: "jpn",
    })
  })

  it("includes optional custom action metadata when provided", () => {
    expect(
      buildFeatureUsedEventProperties({
        feature: ANALYTICS_FEATURE.CUSTOM_AI_ACTION,
        surface: ANALYTICS_SURFACE.CONTEXT_MENU,
        outcome: "success",
        startedAt: 100,
        finishedAt: 600,
        action_id: "dictionary",
        action_name: "Dictionary",
        provider: "read-frog-built-in-ai",
        backend_kind: "llm",
      }),
    ).toEqual({
      feature: ANALYTICS_FEATURE.CUSTOM_AI_ACTION,
      surface: ANALYTICS_SURFACE.CONTEXT_MENU,
      outcome: "success",
      latency_ms: 500,
      action_id: "dictionary",
      action_name: "Dictionary",
      provider: "read-frog-built-in-ai",
      backend_kind: "llm",
    })
  })

  it("reports char_count from the tracked use, not from the usage context", async () => {
    sendMessageMock.mockResolvedValue(undefined)
    const context = createFeatureUsageContext(
      ANALYTICS_FEATURE.TRANSLATION_HUB,
      ANALYTICS_SURFACE.TRANSLATION_HUB,
      0,
    )

    expect(context).not.toHaveProperty("char_count")

    await trackFeatureAttempt(
      {
        ...context,
        provider: "openai",
        backend_kind: "llm",
        char_count: 42,
        target_language: "cmn",
      },
      async () => "translated",
    )

    expect(sendMessageMock).toHaveBeenCalledWith(
      "trackFeatureUsedEvent",
      expect.objectContaining({
        feature: ANALYTICS_FEATURE.TRANSLATION_HUB,
        outcome: "success",
        char_count: 42,
      }),
    )
  })

  it("tracks feature usage with the expected event payload", async () => {
    sendMessageMock.mockResolvedValue(undefined)

    const input = {
      feature: ANALYTICS_FEATURE.PAGE_TRANSLATION,
      surface: ANALYTICS_SURFACE.POPUP,
      outcome: "success" as const,
      startedAt: 0,
      finishedAt: 1_500,
      provider: "openai" as const,
      backend_kind: "llm" as const,
      translation_mode: "bilingual" as const,
      target_language: "cmn" as const,
    }

    await expect(trackFeatureUsed(input)).resolves.toBeUndefined()

    expect(sendMessageMock).toHaveBeenCalledOnce()
    expect(sendMessageMock).toHaveBeenCalledWith(
      "trackFeatureUsedEvent",
      buildFeatureUsedEventProperties(input),
    )
  })

  it("swallows analytics upload failures", async () => {
    sendMessageMock.mockRejectedValueOnce(new Error("upload failed"))

    await expect(
      trackFeatureUsed({
        feature: ANALYTICS_FEATURE.PAGE_TRANSLATION,
        surface: ANALYTICS_SURFACE.POPUP,
        outcome: "failure",
        startedAt: 0,
        finishedAt: 1_500,
        provider: "openai",
        backend_kind: "llm",
        translation_mode: "bilingual",
        target_language: "cmn",
      }),
    ).resolves.toBeUndefined()

    expect(loggerWarnMock).toHaveBeenCalledOnce()
  })
})

describe.skipIf(!__PURE_BUILD__)("pure analytics boundary", () => {
  beforeEach(() => {
    sendMessageMock.mockReset()
    loggerWarnMock.mockReset()
  })

  const context = {
    ...createFeatureUsageContext(
      ANALYTICS_FEATURE.TRANSLATION_HUB,
      ANALYTICS_SURFACE.TRANSLATION_HUB,
    ),
    provider: "openai" as const,
    backend_kind: "llm" as const,
    char_count: 42,
    target_language: "cmn" as const,
  }

  it("does not send feature metadata to the background", async () => {
    await trackFeatureUsed({ ...context, outcome: "success" })
    expect(sendMessageMock).not.toHaveBeenCalled()
  })

  it("preserves successful actions without tracking", async () => {
    const run = vi.fn<() => Promise<string>>(async () => "translated")
    await expect(trackFeatureAttempt(context, run)).resolves.toBe("translated")
    expect(run).toHaveBeenCalledOnce()
    expect(sendMessageMock).not.toHaveBeenCalled()
  })

  it("preserves action failures without tracking", async () => {
    const error = new Error("provider failed")
    await expect(
      trackFeatureAttempt(context, async () => {
        throw error
      }),
    ).rejects.toBe(error)
    expect(sendMessageMock).not.toHaveBeenCalled()
    expect(loggerWarnMock).not.toHaveBeenCalled()
  })
})
