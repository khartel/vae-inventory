import { afterEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { toast } from "sonner"
import * as teamService from "@/services/team.service"
import { AddTeamMemberDialog } from "./AddTeamMemberDialog"
import { ResetPasswordDialog } from "./ResetPasswordDialog"

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ activeBusinessId: "biz-1" }),
}))

vi.mock("@/hooks/useActiveBusiness", () => ({
  useActiveBusiness: () => ({ country: "United States" }),
}))

vi.mock("@/services/team.service", () => ({
  addTeamMember: vi.fn(),
  resetTeamMemberPassword: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe("Team password copy dialogs", () => {
  const originalClipboard = navigator.clipboard
  const originalIsSecureContext = Object.getOwnPropertyDescriptor(window, "isSecureContext")
  const originalExecCommand = document.execCommand

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      configurable: true,
    })
    if (originalIsSecureContext) {
      Object.defineProperty(window, "isSecureContext", originalIsSecureContext)
    } else {
      delete (window as { isSecureContext?: boolean }).isSecureContext
    }
    document.execCommand = originalExecCommand
    vi.clearAllMocks()
  })

  it("copies the reset temporary password via dialog-scoped fallback when Clipboard API is unavailable", async () => {
    Object.defineProperty(window, "isSecureContext", { value: false, configurable: true })
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true })

    let copiedText = ""
    let insideDialog = false
    document.execCommand = vi.fn((cmd: string) => {
      if (cmd !== "copy") return false
      const textarea = document.querySelector("textarea")
      copiedText = textarea?.value ?? ""
      insideDialog = Boolean(textarea?.closest('[role="dialog"]'))
      return true
    })

    vi.mocked(teamService.resetTeamMemberPassword).mockResolvedValue({
      username: "alex",
      newPassword: "NewTempPassword1",
    })

    renderWithQuery(<ResetPasswordDialog businessUserId="bu-1" memberName="Alex" />)

    fireEvent.click(screen.getByRole("button", { name: "Reset password" }))
    fireEvent.click(await screen.findByRole("button", { name: "Reset password" }))

    expect(await screen.findByText("NewTempPassword1")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Copy password" }))

    await waitFor(() => {
      expect(copiedText).toBe("NewTempPassword1")
      expect(insideDialog).toBe(true)
      expect(toast.success).toHaveBeenCalledWith("Password copied")
    })
  })

  it("copies a newly created member's temporary password when Clipboard API rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Clipboard denied"))
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true })
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })

    let copiedText = ""
    document.execCommand = vi.fn((cmd: string) => {
      if (cmd !== "copy") return false
      const textarea = document.querySelector("textarea")
      copiedText = textarea?.value ?? ""
      return true
    })

    vi.mocked(teamService.addTeamMember).mockResolvedValue({
      id: "bu-2",
      businessId: "biz-1",
      userId: "user-2",
      role: "EMPLOYEE",
      createdAt: "2026-11-23T08:00:00Z",
      defaultPassword: "Biz@sam4567",
      user: {
        id: "user-2",
        fullName: "Sam Doe",
        username: "sam",
        phone: "+12025554567",
        email: null,
        role: "EMPLOYEE",
      },
    })

    renderWithQuery(<AddTeamMemberDialog />)

    fireEvent.click(screen.getByRole("button", { name: "Add team member" }))
    fireEvent.change(await screen.findByLabelText("Full name"), { target: { value: "Sam Doe" } })
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "sam" } })
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "+12025554567" } })
    fireEvent.click(screen.getByRole("button", { name: "Add member" }))

    expect(await screen.findByText("Biz@sam4567")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Copy password" }))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("Biz@sam4567")
      expect(copiedText).toBe("Biz@sam4567")
      expect(toast.success).toHaveBeenCalledWith("Password copied")
    })
  })
})
