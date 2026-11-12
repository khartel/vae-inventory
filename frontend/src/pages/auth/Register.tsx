import { useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Link, useNavigate } from "react-router-dom"
import { UserRound, AtSign, Phone, Mail, Lock, Loader2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import * as authService from "@/services/auth.service"
import { ApiError } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { PhoneInput, isValidPhoneNumber } from "@/components/ui/phone-input"
import { AuthShell } from "@/components/auth/AuthShell"
import { AuthField } from "@/components/auth/AuthField"
import { cn } from "@/lib/utils"

const registerSchema = z
  .object({
    fullName: z.string().min(1, "Full name is required"),
    username: z.string().min(3, "Username must be at least 3 characters"),
    phone: z.string().refine(isValidPhoneNumber, "Enter a valid phone number"),
    email: z.string().trim().min(1, "Email is required").email("Invalid email address"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })

type RegisterValues = z.infer<typeof registerSchema>

/**
 * Register page — sign-up form for creating a new SUPERADMIN (business
 * owner) account: full name, username, phone, email, and a password with
 * confirmation (validated via `registerSchema`, including a password-match
 * refinement). Email is required (unlike a team member added via the Team
 * page) since it's this account's only self-service password-recovery path
 * — see ForgotPassword.tsx.
 *
 * Data: no queries; submits via `authService.register` (stripping
 * `confirmPassword` from the payload first), then redirects to `/login`
 * with `state: { registered: true }` so the login page can show a
 * "registered successfully" acknowledgment if it chooses to.
 */
export default function Register() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { fullName: "", username: "", phone: "", email: "", password: "", confirmPassword: "" },
  })

  const onSubmit = async (values: RegisterValues) => {
    setServerError(null)
    try {
      const { confirmPassword: _confirmPassword, ...payload } = values
      await authService.register(payload)
      navigate("/login", { replace: true, state: { registered: true } })
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : t("Registration failed"))
    }
  }

  return (
    <AuthShell
      title="Create your account"
      description="Set up your business on VAE Inventory"
      footer={
        <>
          {t("Already have an account?")}{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            {t("Sign in")}
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <AuthField
          icon={UserRound}
          label="Full name"
          placeholder="Full name"
          autoFocus
          error={errors.fullName?.message}
          {...register("fullName")}
        />
        <AuthField
          icon={AtSign}
          label="Username"
          placeholder="Username"
          autoComplete="username"
          error={errors.username?.message}
          {...register("username")}
        />
        {/* Matches AuthField's pill chrome by hand, since PhoneInput needs a
            controlled value/onChange (via Controller) rather than a plain
            forwarded <input> ref that register() expects. */}
        <div className="space-y-1.5">
          <label htmlFor="register-phone" className="sr-only">
            {t("Phone number")}
          </label>
          <div
            className={cn(
              "flex items-center gap-3 rounded-full border bg-white/50 px-2 py-1.5 backdrop-blur-sm transition-colors",
              "border-border/60 focus-within:border-primary focus-within:bg-white/70",
              "dark:border-white/15 dark:bg-white/5 dark:focus-within:border-primary dark:focus-within:bg-white/10",
              errors.phone && "border-destructive/60 dark:border-destructive/60"
            )}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-black/5 text-foreground/60 dark:bg-white/10 dark:text-foreground/70">
              <Phone className="size-4" />
            </span>
            <Controller
              name="phone"
              control={control}
              render={({ field }) => (
                <PhoneInput
                  id="register-phone"
                  value={field.value}
                  onChange={field.onChange}
                  placeholder={t("Phone number")}
                  aria-invalid={!!errors.phone}
                  className="!h-auto !w-full !border-0 !bg-transparent !p-0 text-sm"
                />
              )}
            />
          </div>
          {errors.phone?.message && <p className="pl-4 text-xs text-destructive">{t(errors.phone.message)}</p>}
        </div>
        <AuthField
          icon={Mail}
          label="Email"
          type="email"
          placeholder="Email"
          autoComplete="email"
          error={errors.email?.message}
          {...register("email")}
        />
        <AuthField
          icon={Lock}
          label="Password"
          type="password"
          placeholder="Password"
          autoComplete="new-password"
          error={errors.password?.message}
          {...register("password")}
        />
        <AuthField
          icon={Lock}
          label="Confirm password"
          type="password"
          placeholder="Confirm password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register("confirmPassword")}
        />

        {serverError && <p className="text-sm text-destructive">{serverError}</p>}

        <Button
          type="submit"
          className="w-full rounded-full bg-gradient-to-r from-primary to-success text-primary-foreground hover:opacity-90"
          disabled={isSubmitting}
        >
          {isSubmitting && <Loader2 className="size-4 animate-spin" />}
          {t("Create account")}
        </Button>
      </form>
    </AuthShell>
  )
}
