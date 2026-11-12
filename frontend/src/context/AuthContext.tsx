// Global authentication context. Wraps the app and exposes the current user,
// session status, the active-business selection, and auth actions
// (login/2FA verification/logout) that keep both localStorage and the
// TanStack Query cache in sync with server session state.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as authService from "@/services/auth.service"
import type { AuthUser } from "@/types"
import i18n, { consumePendingLanguageSync } from "@/i18n"

// localStorage key used to persist which business the user last had selected,
// so the choice survives page reloads.
const ACTIVE_BUSINESS_KEY = "d-inventory:active-business-id"

// Public shape of the auth context consumed via `useAuth()`.
interface AuthContextValue {
  /** Currently logged-in user (with their business memberships), or null if not authenticated. */
  user: AuthUser | null
  /** True while the initial "who am I" (/auth/me) request is in flight. */
  isLoading: boolean
  /** Convenience flag: true once `user` has resolved to a non-null value. */
  isAuthenticated: boolean
  /** id of the business currently "in focus" (see hooks/useActiveBusiness.ts). */
  activeBusinessId: string | null
  /** Selects a new active business and persists the choice to localStorage. */
  setActiveBusinessId: (id: string | null) => void
  /** Submits login credentials; see `authService.LoginResult` for the two possible outcomes. */
  login: (input: authService.LoginInput) => Promise<authService.LoginResult>
  /** Completes a 2FA-gated login given the temp token and TOTP code. */
  verifyTwoFactor: (tempToken: string, code: string) => Promise<AuthUser>
  /** Logs the user out and resets all cached client-side state. */
  logout: () => Promise<void>
  /** Manually re-fetches the current user (e.g. after profile changes elsewhere). */
  refetchMe: () => Promise<unknown>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

/**
 * Provides `AuthContextValue` to the component tree. Session state is
 * derived from a TanStack Query for `/auth/me` (queryKey `["auth", "me"]`)
 * rather than a separate piece of local state — logging in/out works by
 * writing directly into that query's cache via `queryClient.setQueryData`,
 * which keeps every consumer of `useAuth()`/the query in sync without an
 * extra refetch round-trip.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [activeBusinessId, setActiveBusinessIdState] = useState<string | null>(() =>
    localStorage.getItem(ACTIVE_BUSINESS_KEY)
  )

  const meQuery = useQuery({
    queryKey: ["auth", "me"],
    queryFn: authService.getMe,
    retry: false,
    staleTime: 5 * 60 * 1000,
  })

  const user = meQuery.data ?? null

  const setActiveBusinessId = (id: string | null) => {
    setActiveBusinessIdState(id)
    if (id) {
      localStorage.setItem(ACTIVE_BUSINESS_KEY, id)
    } else {
      localStorage.removeItem(ACTIVE_BUSINESS_KEY)
    }
  }

  // Keep the active business valid: default to the first one, and clear it
  // if the user no longer belongs to the previously-selected business.
  useEffect(() => {
    if (!user) return
    const stillValid = user.businesses.some((b) => b.id === activeBusinessId)
    if (!stillValid) {
      setActiveBusinessId(user.businesses[0]?.id ?? null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // Once the account's own language preference is known, it takes over from
  // whatever pre-login/local choice i18next was using (see i18n.ts's
  // localStorage-backed default) — the account preference travels with the
  // user across devices, so it should win once available.
  //
  // Exception: if the language was changed explicitly on the Login/Register
  // screen right before this login (flagged via `markLanguagePendingSync`),
  // that choice wins instead — it gets pushed to the account rather than
  // being silently discarded in favor of whatever the account had saved.
  useEffect(() => {
    if (!user?.language) return

    if (consumePendingLanguageSync()) {
      if (user.language !== i18n.language) {
        const chosenLanguage = i18n.language
        authService
          .updateProfile({ language: chosenLanguage })
          .then(() => {
            queryClient.setQueryData(["auth", "me"], (current: AuthUser | null | undefined) =>
              current ? { ...current, language: chosenLanguage } : current
            )
          })
          .catch(() => {
            // Non-critical: the UI already reflects the chosen language;
            // a failed save just means it may not follow to another device.
          })
      }
      return
    }

    if (user.language !== i18n.language) {
      i18n.changeLanguage(user.language)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.language])

  // On success, only seed the query cache with the user if login didn't stop
  // at the 2FA challenge — the `requires2FA` branch leaves the user
  // unauthenticated until `verifyTwoFactorMutation` succeeds.
  const loginMutation = useMutation({
    mutationFn: authService.login,
    onSuccess: (result) => {
      if ("user" in result) {
        queryClient.setQueryData(["auth", "me"], result.user)
      }
    },
  })

  // Completes the 2FA challenge; writing the returned user into the
  // `["auth", "me"]` cache is what actually flips `isAuthenticated` to true.
  const verifyTwoFactorMutation = useMutation({
    mutationFn: ({ tempToken, code }: { tempToken: string; code: string }) =>
      authService.verifyLoginTwoFactor(tempToken, code),
    onSuccess: ({ user: loggedInUser }) => {
      queryClient.setQueryData(["auth", "me"], loggedInUser)
    },
  })

  // On logout, null out the cached user, clear the active-business selection,
  // and wipe the entire query cache so no stale data from the previous
  // session (transactions, products, etc.) leaks into the next login.
  const logoutMutation = useMutation({
    mutationFn: authService.logout,
    onSuccess: () => {
      queryClient.setQueryData(["auth", "me"], null)
      setActiveBusinessId(null)
      queryClient.clear()
    },
  })

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading: meQuery.isLoading,
      isAuthenticated: !!user,
      activeBusinessId,
      setActiveBusinessId,
      login: (input) => loginMutation.mutateAsync(input),
      verifyTwoFactor: async (tempToken, code) =>
        (await verifyTwoFactorMutation.mutateAsync({ tempToken, code })).user,
      logout: async () => {
        try {
          await logoutMutation.mutateAsync()
        } catch {
          // Best-effort: the server call now requires a still-valid session
          // (it revokes it), so it can fail if the session was already
          // invalid (e.g. a double-click race, or it expired/was already
          // revoked elsewhere). Either way, clear local state so the user
          // still ends up logged out instead of getting stuck.
          queryClient.setQueryData(["auth", "me"], null)
          setActiveBusinessId(null)
          queryClient.clear()
        }
      },
      refetchMe: meQuery.refetch,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, meQuery.isLoading, activeBusinessId]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/** Accesses the auth context. Throws if called outside an `AuthProvider`. */
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return ctx
}
