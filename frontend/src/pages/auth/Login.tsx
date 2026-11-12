import { useState } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { ArrowRight, User, Lock, Loader2, ShieldCheck } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/context/AuthContext"
import { ApiError } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { LoginShell } from "@/components/auth/LoginShell"
import { AuthField } from "@/components/auth/AuthField"

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean(),
})

type LoginValues = z.infer<typeof loginSchema>

/**
 * Login page — a two-step sign-in flow rendered as a single component:
 *
 * 1. Credentials step: username + password form (react-hook-form + zod via
 *    `loginSchema`), submitted through `login()` from AuthContext.
 * 2. Two-factor step: if `login()` resolves with `requires2FA` (i.e. the
 *    account has 2FA enabled), `tempToken` is stored and the component
 *    renders a second, separate form asking for the 6-digit authenticator
 *    code, submitted through `verifyTwoFactor()`.
 *
 * Both steps reuse the same `LoginShell` wrapper but are given different
 * `key` props ("credentials" vs "two-factor"). This is deliberate, not
 * decorative: without distinct keys, React would reconcile the two forms
 * as "the same" component across the state transition (since they render
 * from the same call site) and could carry over stale internal state
 * (e.g. focus/animation/mounted-input state) from one step into the next.
 * The `key` change forces a clean remount when switching steps.
 *
 * On success, both steps navigate to `location.state.from` (the page the
 * user was redirected from) or "/" by default.
 */
export default function Login() {
  const { t } = useTranslation()
  const { login, verifyTwoFactor } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [serverError, setServerError] = useState<string | null>(null)
  const [tempToken, setTempToken] = useState<string | null>(null)
  const [code, setCode] = useState("")
  const [verifying, setVerifying] = useState(false)

  const from = (location.state as { from?: Location })?.from?.pathname ?? "/"

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "", rememberMe: false },
  })

  // Step 1 submit: attempts username/password login. If the account
  // requires 2FA, stashes the temp token and lets the component re-render
  // into the code-entry step instead of navigating away.
  const onSubmit = async (values: LoginValues) => {
    setServerError(null)
    try {
      const result = await login(values)
      if ("requires2FA" in result) {
        setTempToken(result.tempToken)
        return
      }
      navigate(from, { replace: true })
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : t("Login failed"))
    }
  }

  // Step 2 submit: verifies the 6-digit code against the temp token from
  // step 1 and completes the login.
  const handleVerifyTwoFactor = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!tempToken) return
    setServerError(null)
    setVerifying(true)
    try {
      await verifyTwoFactor(tempToken, code)
      navigate(from, { replace: true })
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : t("Invalid code"))
    } finally {
      setVerifying(false)
    }
  }

  if (tempToken) {
    return (
      <LoginShell
        key="two-factor"
        title="Two-factor authentication"
        description="Enter the 6-digit code from your authenticator app"
      >
        <form onSubmit={handleVerifyTwoFactor} className="space-y-4">
          <AuthField
            icon={ShieldCheck}
            label="Authentication code"
            placeholder="6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />

          {serverError && <p className="text-sm text-destructive">{serverError}</p>}

          <Button
            type="submit"
            className="login-submit hover:opacity-90"
            disabled={verifying || code.length !== 6}
          >
            {verifying && <Loader2 className="size-4 animate-spin" />}
            {t("Verify")}
          </Button>
          <button
            type="button"
            onClick={() => {
              setTempToken(null)
              setCode("")
              setServerError(null)
            }}
            className="w-full text-center text-sm text-muted-foreground hover:underline"
          >
            {t("Back to sign in")}
          </button>
        </form>
      </LoginShell>
    )
  }

  return (
    <LoginShell
      key="credentials"
      title="Welcome back"
      description="Sign in to manage your business"
      showRegistration
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <AuthField
          icon={User}
          label="Username"
          placeholder="Username"
          autoComplete="username"
          autoFocus
          error={errors.username?.message}
          {...register("username")}
        />
        <AuthField
          icon={Lock}
          label="Password"
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register("password")}
        />

        <div className="login-options flex items-center justify-between px-1">
          <Controller
            control={control}
            name="rememberMe"
            render={({ field }) => (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                {t("Remember me")}
              </label>
            )}
          />
          <Link to="/forgot-password" className="text-sm text-primary hover:underline">
            {t("Forgot password?")}
          </Link>
        </div>

        {serverError && <p className="text-sm text-destructive">{serverError}</p>}

        <Button
          type="submit"
          className="login-submit hover:opacity-90"
          disabled={isSubmitting}
        >
          {isSubmitting && <Loader2 className="size-4 animate-spin" />}
          {t("Sign in")}
          <ArrowRight className="size-5" aria-hidden="true" />
        </Button>
      </form>
    </LoginShell>
  )
}
