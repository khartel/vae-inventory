import { useState } from "react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, test, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { PhoneInput } from "./phone-input"
import { SupplierForm } from "@/components/purchases/PurchaseForms"
import { saveSupplier } from "@/services/purchase.service"
import { countryNameToIso } from "@/lib/countries"
import i18n from "@/i18n"

vi.mock("@/services/purchase.service", async (original) => ({ ...await original<typeof import("@/services/purchase.service")>(), saveSupplier: vi.fn() }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
afterEach(async () => { await i18n.changeLanguage("en"); vi.clearAllMocks() })

function Field({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return <><label htmlFor="test-phone">Phone number</label><PhoneInput id="test-phone" value={value} onChange={setValue} /><output aria-label="Stored phone">{value}</output></>
}

test("finds India by name, ISO code and calling code, then stores an Indian E.164 number", async () => {
  const user = userEvent.setup()
  render(<Field />)
  for (const search of ["India", "IN", "+91"]) {
    await user.click(screen.getByRole("combobox", { name: /Phone country/ }))
    await user.type(screen.getByRole("searchbox", { name: "Search countries" }), search)
    const india = screen.getByRole("button", { name: "India +91" })
    expect(india).toBeInTheDocument()
    await user.click(india)
  }
  expect(screen.getByRole("combobox", { name: "Phone country: India" })).toHaveTextContent("+91")
  await user.type(screen.getByRole("textbox", { name: "Phone number" }), "9876543210")
  expect(screen.getByLabelText("Stored phone")).toHaveTextContent("+919876543210")
})

test("matches English names in French and leaves an existing phone unchanged when search is cancelled", async () => {
  await act(async () => { await i18n.changeLanguage("fr") })
  const user = userEvent.setup()
  render(<Field initial="+919876543210" />)
  await user.click(screen.getByRole("combobox", { name: /Pays du numéro/ }))
  await user.type(screen.getByRole("searchbox", { name: "Rechercher des pays" }), "India")
  expect(screen.getByRole("button", { name: "Inde +91" })).toBeInTheDocument()
  await user.clear(screen.getByRole("searchbox", { name: "Rechercher des pays" }))
  await user.type(screen.getByRole("searchbox", { name: "Rechercher des pays" }), "zzzz-no-country")
  expect(screen.getByText("Aucun pays trouvé")).toHaveAttribute("role", "status")
  await user.keyboard("{Escape}")
  expect(screen.queryByRole("dialog", { name: "Choisir un pays" })).not.toBeInTheDocument()
  expect(screen.getByLabelText("Stored phone")).toHaveTextContent("+919876543210")
})

test("supports new country defaults and legacy business names", () => {
  expect(countryNameToIso("India")).toBe("IN")
  expect(countryNameToIso("Nepal")).toBe("NP")
  expect(countryNameToIso("Sri Lanka")).toBe("LK")
  expect(countryNameToIso("United Arab Emirates")).toBe("AE")
  expect(countryNameToIso("UAE")).toBe("AE")
  expect(countryNameToIso("Ivory Coast")).toBe("CI")
  expect(countryNameToIso("Côte d’Ivoire")).toBe("CI")
  expect(countryNameToIso("IN")).toBe("IN")
  expect(countryNameToIso("not a country")).toBeUndefined()
})

test("saves an Indian supplier through the actual supplier form", async () => {
  vi.mocked(saveSupplier).mockResolvedValue({ id: "supplier-a" } as Awaited<ReturnType<typeof saveSupplier>>)
  const closed = vi.fn()
  const user = userEvent.setup()
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SupplierForm businessId="business-a" onClose={closed} /></QueryClientProvider>)
  fireEvent.change(screen.getByRole("textbox", { name: "Supplier name" }), { target: { value: "India supplier" } })
  await user.click(screen.getByRole("combobox", { name: /Phone country/ }))
  await user.type(screen.getByRole("searchbox", { name: "Search countries" }), "India")
  await user.keyboard("{Enter}")
  expect(saveSupplier).not.toHaveBeenCalled()
  await user.type(screen.getByRole("textbox", { name: "Phone number" }), "9876543210")
  fireEvent.change(screen.getByRole("textbox", { name: "Address" }), { target: { value: "Mumbai, India" } })
  await user.click(screen.getByRole("button", { name: "Save supplier" }))
  await waitFor(() => expect(saveSupplier).toHaveBeenCalledWith("business-a", expect.objectContaining({ name: "India supplier", phone: "+919876543210", address: "Mumbai, India" }), undefined))
  expect(closed).toHaveBeenCalledTimes(1)
})
