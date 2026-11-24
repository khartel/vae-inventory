function resolveCopyHost(container?: HTMLElement | null): HTMLElement | null {
  if (container && container.isConnected) return container
  if (typeof document === "undefined") return null

  const activeDialog =
    document.activeElement instanceof Element
      ? document.activeElement.closest<HTMLElement>('[role="dialog"], [data-slot="dialog-content"]')
      : null
  if (activeDialog) return activeDialog

  // Safari and Firefox on macOS do not always focus a <button> on click, so
  // fall back to the topmost open dialog in the DOM if one is mounted.
  const openDialogs = document.querySelectorAll<HTMLElement>(
    '[data-slot="dialog-content"], [role="dialog"]'
  )
  if (openDialogs.length > 0) {
    return openDialogs[openDialogs.length - 1]
  }

  return document.body
}

function copyWithExecCommand(text: string, container?: HTMLElement | null): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    return false
  }

  const host = resolveCopyHost(container)
  if (!host) return false

  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const selection = document.getSelection()
  const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null

  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.setAttribute("aria-hidden", "true")
  textarea.style.position = "fixed"
  textarea.style.top = "0"
  textarea.style.left = "0"
  textarea.style.width = "1px"
  textarea.style.height = "1px"
  textarea.style.padding = "0"
  textarea.style.border = "0"
  textarea.style.opacity = "0"
  textarea.style.fontSize = "16px"

  host.appendChild(textarea)

  try {
    textarea.focus({ preventScroll: true })
    textarea.select()
    // Explicit range is required on iOS Safari where .select() alone can be ignored.
    textarea.setSelectionRange(0, text.length)
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    textarea.remove()
    if (selection) {
      selection.removeAllRanges()
      if (previousRange) {
        try {
          selection.addRange(previousRange)
        } catch {
          // Ignore if the previous range is no longer valid.
        }
      }
    }
    previousFocus?.focus({ preventScroll: true })
  }
}

/**
 * Copies plain text to the system clipboard with a dialog-safe fallback.
 *
 * Uses the Async Clipboard API when available in a secure context, and falls
 * back to a temporary readonly `<textarea>` + `document.execCommand("copy")`
 * when running over HTTP (e.g. LAN/mobile dev), in webviews, or when the
 * Clipboard API rejects.
 *
 * Mounting the temporary `<textarea>` inside the active Radix Dialog (when one
 * is open) prevents Radix's focus trap from stealing focus back before
 * `execCommand("copy")` runs.
 */
export async function copyTextToClipboard(
  text: string,
  container?: HTMLElement | null
): Promise<boolean> {
  if (
    typeof navigator !== "undefined" &&
    typeof window !== "undefined" &&
    window.isSecureContext !== false &&
    typeof navigator.clipboard?.writeText === "function"
  ) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to legacy execCommand copy below.
    }
  }

  return copyWithExecCommand(text, container)
}
