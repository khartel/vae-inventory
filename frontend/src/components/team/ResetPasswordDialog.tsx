import { useEffect, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Check, Copy, KeyRound, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import * as teamService from "@/services/team.service"
import { useAuth } from "@/context/AuthContext"
import { copyTextToClipboard } from "@/lib/clipboard"
import { ApiError } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

/**
 * Icon-button-triggered dialog for resetting a team member's password. Two-step flow:
 * 1. Confirmation view — "Reset {name}'s password?" with Cancel/Confirm.
 * 2. Result view — same "reveal-once credentials" pattern as AddTeamMemberDialog:
 *    after the mutation succeeds, shows the username and new temporary password
 *    exactly once (never persisted beyond this dialog's local state), with a
 *    copy-to-clipboard button that briefly swaps to a checkmark for feedback.
 *
 * Props:
 * - businessUserId: the membership record whose password is being reset (not the
 *   bare user id — reset is scoped to this business's membership).
 * - memberName: display name shown in the confirmation/result copy.
 *
 * Closing the dialog clears the result state so reopening always starts at step 1.
 */
export function ResetPasswordDialog({
  businessUserId,
  memberName,
}: {
  businessUserId: string
  memberName: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<{ username: string; newPassword: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const copyTimeoutRef = useRef<number | null>(null)
  const { activeBusinessId } = useAuth()
  const queryClient = useQueryClient()

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current)
      }
    }
  }, [])

  const mutation = useMutation({
    mutationFn: () => teamService.resetTeamMemberPassword(activeBusinessId!, businessUserId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["team", activeBusinessId] })
      setResult(data)
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : t("Could not reset password"))
    },
  })

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current)
        copyTimeoutRef.current = null
      }
      setResult(null)
      setCopied(false)
    }
  }

  // Copies the one-time new password to the clipboard and briefly shows a checkmark
  // (reverts to the copy icon after 2s) as feedback.
  const copyPassword = async (trigger?: HTMLElement) => {
    if (!result) return
    const dialog = trigger?.closest<HTMLElement>('[role="dialog"], [data-slot="dialog-content"]')
    const ok = await copyTextToClipboard(result.newPassword, dialog)
    if (!ok) {
      toast.error(t("Could not copy password"))
      return
    }
    if (copyTimeoutRef.current !== null) {
      window.clearTimeout(copyTimeoutRef.current)
    }
    setCopied(true)
    toast.success(t("Password copied"))
    copyTimeoutRef.current = window.setTimeout(() => {
      setCopied(false)
      copyTimeoutRef.current = null
    }, 2000)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label={t("Reset password")}>
          <KeyRound className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent onInteractOutside={(e) => { if (result) e.preventDefault() }}>
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("Password reset")}</DialogTitle>
              <DialogDescription>
                {t(
                  "Share these sign-in details with {{name}} now — this password won't be shown again. They'll be asked to set a new one on their next login.",
                  { name: memberName }
                )}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 rounded-lg border border-border bg-muted/50 p-4">
              <div>
                <p className="text-xs text-muted-foreground">{t("Username")}</p>
                <p className="font-mono text-sm font-medium select-all">{result.username}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("New temporary password")}</p>
                <div className="flex items-center gap-2">
                  <p className="font-mono text-sm font-medium select-all break-all">{result.newPassword}</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={(e) => copyPassword(e.currentTarget)}
                    aria-label={t("Copy password")}
                  >
                    {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
                  </Button>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>{t("Done")}</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t("Reset {{name}}'s password?", { name: memberName })}</DialogTitle>
              <DialogDescription>
                {t("They'll need to sign in with a new temporary password and will be asked to set their own immediately after.")}
              </DialogDescription>
            </DialogHeader>

            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                {t("Cancel")}
              </Button>
              <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
                {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
                {t("Reset password")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
