// Thin wrappers around the /auth/* backend endpoints. Every function returns
// a promise that resolves with the unwrapped `data` payload (see
// `apiRequest` in lib/api-client.ts) or rejects with an `ApiError`.
import { apiClient, apiRequest } from "@/lib/api-client"
import type { AuthUser } from "@/types"

// Credentials submitted on the login form.
export interface LoginInput {
  username: string
  password: string
  rememberMe?: boolean
}

// Fields required to create a new account. `email` is required here (unlike
// `UpdateProfileInput`/team members) - it's the SuperAdmin's only self-service
// password-recovery path, since there's nobody above them in the business.
export interface RegisterInput {
  fullName: string
  username: string
  phone: string
  email: string
  password: string
}

// Payload for the "change my password while logged in" flow.
export interface ChangePasswordInput {
  currentPassword: string
  newPassword: string
}

// Partial profile fields a logged-in user can update about themselves.
export interface UpdateProfileInput {
  fullName?: string
  phone?: string
  email?: string
  /** UI-language preference (e.g. "en"/"fr"); saved instantly by the language switcher. */
  language?: string
}

/**
 * Discriminated union describing what `login()` can resolve to:
 * - `{ user }` — credentials were valid and 2FA is not enabled; the session
 *   cookie is already set and the caller can treat the user as logged in.
 * - `{ requires2FA: true, tempToken }` — credentials were valid but the
 *   account has 2FA enabled, so no session was created yet. The caller must
 *   collect a 6-digit code from the user and call `verifyLoginTwoFactor`
 *   with the `tempToken` to actually complete login.
 * Consumers should narrow on the `requires2FA` field to decide which UI step
 * to show next.
 */
export type LoginResult = { user: AuthUser } | { requires2FA: true; tempToken: string }

// Data needed to render the 2FA enrollment QR code: `secret` is the raw
// TOTP secret (shown as a fallback for manual entry) and `qrCodeDataUrl` is
// a ready-to-render `data:image/...` URI for an `<img>` tag.
export interface TwoFactorSetup {
  secret: string
  qrCodeDataUrl: string
}

/** Attempts login with username/password. See `LoginResult` for the two possible outcomes. */
export const login = (input: LoginInput) =>
  apiRequest<LoginResult>(apiClient.post("/auth/login", input))

/** Completes a 2FA-gated login by exchanging the temp token + TOTP code for a real session. */
export const verifyLoginTwoFactor = (tempToken: string, code: string) =>
  apiRequest<{ user: AuthUser }>(apiClient.post("/auth/login/2fa", { tempToken, code }))

/** Starts 2FA enrollment for the current user; returns the secret/QR code to scan. */
export const setupTwoFactor = () =>
  apiRequest<TwoFactorSetup>(apiClient.post("/auth/2fa/setup"))

/** Confirms enrollment by submitting a code generated from the newly scanned secret, enabling 2FA. */
export const verifyTwoFactorSetup = (code: string) =>
  apiRequest<null>(apiClient.post("/auth/2fa/verify", { code }))

/** Turns off 2FA for the current user; requires re-entering the account password. */
export const disableTwoFactor = (password: string) =>
  apiRequest<null>(apiClient.post("/auth/2fa/disable", { password }))

/** Creates a new user account. */
export const register = (input: RegisterInput) =>
  apiRequest<AuthUser>(apiClient.post("/auth/register", input))

/** Ends the current session (clears the server-side session cookie). */
export const logout = () => apiRequest<null>(apiClient.post("/auth/logout"))

/** Fetches the currently authenticated user (including their businesses). Used to hydrate/restore session state on app load. */
export const getMe = () => apiRequest<AuthUser>(apiClient.get("/auth/me"))

/** Changes the current user's password, requiring the current password for verification. */
export const changePassword = (input: ChangePasswordInput) =>
  apiRequest<null>(apiClient.post("/auth/change-password", input))

/** Updates the current user's profile fields. */
export const updateProfile = (input: UpdateProfileInput) =>
  apiRequest<AuthUser>(apiClient.patch("/auth/me", input))

/**
 * Requests a password-reset email. Always resolves successfully regardless
 * of whether the email matched an account - the backend never reveals that
 * distinction, so there's nothing to branch on here.
 */
export const forgotPassword = (email: string) =>
  apiRequest<null>(apiClient.post("/auth/forgot-password", { email }))

/** Completes a password reset using the token from the emailed link. */
export const resetPassword = (token: string, newPassword: string) =>
  apiRequest<null>(apiClient.post("/auth/reset-password", { token, newPassword }))
