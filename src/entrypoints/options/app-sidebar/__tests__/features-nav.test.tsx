// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { beforeAll, describe, expect, it } from "vitest"
import { SidebarProvider } from "@/components/ui/base-ui/sidebar"
import { TooltipProvider } from "@/components/ui/base-ui/tooltip"
import { env } from "@/env"
import { FeaturesNav } from "../features-nav"

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  })
})

function renderNavigation() {
  return render(
    <MemoryRouter initialEntries={["/page-translation"]}>
      <SidebarProvider>
        <TooltipProvider>
          <FeaturesNav />
        </TooltipProvider>
      </SidebarProvider>
    </MemoryRouter>,
  )
}

describe("translation navigation", () => {
  it("keeps the in-extension translation pages available", () => {
    renderNavigation()
    for (const route of ["page-translation", "video-subtitles", "input-translation"]) {
      expect(
        screen.getAllByRole("link").some((link) => link.getAttribute("href") === `/${route}`),
      ).toBe(true)
    }
    expect(screen.getByRole("link", { name: "options.tools.translationHub" })).toBeInTheDocument()
  })

  it.skipIf(!__PURE_BUILD__)("removes the official PDF service link from Pure", () => {
    renderNavigation()
    expect(screen.queryByText("options.tools.pdfTranslation")).not.toBeInTheDocument()
    expect(
      screen
        .getAllByRole("link")
        .some((link) => link.getAttribute("href")?.includes("/pdf-translation")),
    ).toBe(false)
  })

  it.skipIf(__PURE_BUILD__)("preserves the PDF service link in the official distribution", () => {
    renderNavigation()
    expect(screen.getByRole("link", { name: /options.tools.pdfTranslation/ })).toHaveAttribute(
      "href",
      `${env.WXT_WEBSITE_URL}/pdf-translation`,
    )
  })
})
