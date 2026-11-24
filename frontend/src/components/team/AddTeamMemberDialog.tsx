import { useEffect, useRef, useState } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Check, Copy, Loader2, Plus, UserPlus } from "lucide-react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import * as teamService from "@/services/team.service"
import { useAuth } from "@/context/AuthContext"
import { useActiveBusiness } from "@/hooks/useActiveBusiness"
import { countryNameToIso } from "@/lib/countries"
import { copyTextToClipboard } from "@/lib/clipboard"
import { ApiError } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PhoneInput, isValidPhoneNumber } from "@/components/ui/phone-input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const schema = z.object({
  fullName: z.string().trim().min(1, "Full name is required"),
  username: z.string().trim().min(3, "Username must be at least 3 characters"),
  phone: z.string().refine(isValidPhoneNumber, "Enter a valid phone number"),
  email: z.string().email("Invalid email address").optional().or(z.literal("")),
  role: z.enum(["ADMIN", "EMPLOYEE"], { message: "Select a role" }),
})

type FormValues = z.infer<typeof schema>

/**
 * Dialog for adding a new team member to the active business, with a role picker
 * (Employee/Admin). Follows the app's "reveal-once credentials" pattern also used by
 * ResetPasswordDialog:
 * - On success, if the backend generated a `defaultPassword` (i.e. this created a
 *   brand-new user rather than attaching an existing username to the business), the
 *   dialog switches from the form view to a "credentials" view showing the username
 *   and temporary password exactly once, with a copy-to-clipboard button
 *   (`copyPassword`, which briefly flips a check icon via `copied` state). These
 *   values are only ever held in local component state — refreshing or reopening the
 *   dialog loses them, matching the "won't be shown again" warning in the UI.
 * - If no `defaultPassword` came back (existing user attached directly), it just
 *   shows a toast and closes.
 * - Closing the dialog (`handleOpenChange`) clears the revealed-credentials state so
 *   reopening it always starts fresh on the form.
 */
export function AddTeamMemberDialog() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const copyTimeoutRef = useRef<number | null>(null)
  const { activeBusinessId } = useAuth()
  const activeBusiness = useActiveBusiness()
  const queryClient = useQueryClient()

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current)
      }
    }
  }, [])

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: "", username: "", phone: "", email: "", role: "EMPLOYEE" },
  })

  const mutation = useMutation({
    mutationFn: (values: FormValues) => teamService.addTeamMember(activeBusinessId!, values),
    onSuccess: (member) => {
      queryClient.invalidateQueries({ queryKey: ["team", activeBusinessId] })
      queryClient.invalidateQueries({ queryKey: ["business", activeBusinessId] })
      reset()
      if (member.defaultPassword) {
        setCreated({ username: member.user.username, password: member.defaultPassword })
      } else {
        toast.success(t("{{name}} added to the business", { name: member.user.fullName }))
        setOpen(false)
      }
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : t("Could not add team member"))
    },
  })

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current)
        copyTimeoutRef.current = null
      }
      setCreated(null)
      setCopied(false)
    }
  }

  // Copies the one-time temporary password to the clipboard and briefly shows a
  // checkmark (reverts to the copy icon after 2s) as feedback.
  const copyPassword = async (trigger?: HTMLElement) => {
    if (!created) return
    const dialog = trigger?.closest<HTMLElement>('[role="dialog"], [data-slot="dialog-content"]')
    const ok = await copyTextToClipboard(created.password, dialog)
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
        <Button>
          <Plus className="size-4" />
          {t("Add team member")}
        </Button>
      </DialogTrigger>
      <DialogContent onInteractOutside={(e) => { if (created) e.preventDefault() }}>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <UserPlus className="size-5 text-success" />
                {t("Team member added")}
              </DialogTitle>
              <DialogDescription>
                {t("Share these sign-in details with them now — this password won't be shown again. They'll be asked to set a new one on first login.")}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 rounded-lg border border-border bg-muted/50 p-4">
              <div>
                <p className="text-xs text-muted-foreground">{t("Username")}</p>
                <p className="font-mono text-sm font-medium select-all">{created.username}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("Temporary password")}</p>
                <div className="flex items-center gap-2">
                  <p className="font-mono text-sm font-medium select-all break-all">{created.password}</p>
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
              <DialogTitle>{t("Add a team member")}</DialogTitle>
              <DialogDescription>
                {t("They'll get a temporary password to log in with. Existing users can be added directly by username.")}
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="member-name">{t("Full name")}</Label>
                <Input id="member-name" autoFocus {...register("fullName")} />
                {errors.fullName && <p className="text-xs text-destructive">{t(errors.fullName.message ?? "")}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="member-username">{t("Username")}</Label>
                <Input id="member-username" {...register("username")} />
                {errors.username && <p className="text-xs text-destructive">{t(errors.username.message ?? "")}</p>}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="member-phone">{t("Phone number")}</Label>
                  <Controller
                    name="phone"
                    control={control}
                    render={({ field }) => (
                      <PhoneInput
                        id="member-phone"
                        value={field.value}
                        onChange={field.onChange}
                        defaultCountry={countryNameToIso(activeBusiness?.country)}
                        aria-invalid={!!errors.phone}
                      />
                    )}
                  />
                  {errors.phone && <p className="text-xs text-destructive">{t(errors.phone.message ?? "")}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="member-role">{t("Role")}</Label>
                  <Controller
                    control={control}
                    name="role"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="member-role" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="EMPLOYEE">{t("Employee")}</SelectItem>
                          <SelectItem value="ADMIN">{t("Admin")}</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="member-email">{t("Email (optional)")}</Label>
                <Input id="member-email" type="email" {...register("email")} />
                {errors.email && <p className="text-xs text-destructive">{t(errors.email.message ?? "")}</p>}
              </div>

              <DialogFooter>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="size-4 animate-spin" />}
                  {t("Add member")}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
