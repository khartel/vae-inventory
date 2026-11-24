import { afterEach, describe, expect, it, vi } from "vitest"
import { copyTextToClipboard } from "./clipboard"

describe("copyTextToClipboard", () => {
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
    document.body.innerHTML = ""
    vi.restoreAllMocks()
  })

  it("uses navigator.clipboard.writeText in a secure context", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true })
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })

    const ok = await copyTextToClipboard("TempPass123")

    expect(ok).toBe(true)
    expect(writeText).toHaveBeenCalledWith("TempPass123")
  })

  it("falls back to execCommand inside the active dialog when navigator.clipboard is unavailable", async () => {
    Object.defineProperty(window, "isSecureContext", { value: false, configurable: true })
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    })

    const dialog = document.createElement("div")
    dialog.setAttribute("role", "dialog")
    document.body.appendChild(dialog)

    let copiedValue = ""
    let mountedInsideDialog = false
    document.execCommand = vi.fn((command: string) => {
      if (command !== "copy") return false
      const textarea = dialog.querySelector("textarea")
      mountedInsideDialog = textarea !== null
      copiedValue = textarea?.value ?? ""
      return mountedInsideDialog
    })

    const ok = await copyTextToClipboard("Biz@jane1234", dialog)

    expect(ok).toBe(true)
    expect(mountedInsideDialog).toBe(true)
    expect(copiedValue).toBe("Biz@jane1234")
    expect(dialog.querySelector("textarea")).toBeNull()
  })

  it("falls back to execCommand when navigator.clipboard.writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException("Not allowed", "NotAllowedError"))
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true })
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })

    let copiedValue = ""
    document.execCommand = vi.fn((command: string) => {
      if (command !== "copy") return false
      const textarea = document.querySelector("textarea")
      copiedValue = textarea?.value ?? ""
      return true
    })

    const ok = await copyTextToClipboard("ResetPass99")

    expect(writeText).toHaveBeenCalledWith("ResetPass99")
    expect(ok).toBe(true)
    expect(copiedValue).toBe("ResetPass99")
    expect(document.querySelector("textarea")).toBeNull()
  })

  it("returns false when both Clipboard API and execCommand fail", async () => {
    Object.defineProperty(window, "isSecureContext", { value: false, configurable: true })
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    })
    document.execCommand = vi.fn(() => false)

    const ok = await copyTextToClipboard("TempPass123")

    expect(ok).toBe(false)
  })
})
