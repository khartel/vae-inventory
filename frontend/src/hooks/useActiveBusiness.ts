import { useAuth } from "@/context/AuthContext"

/**
 * Returns the currently "active" business — the one whose data (products,
 * transactions, customers, etc.) the UI is currently scoped to. A single
 * user account can belong to multiple businesses (e.g. a SUPERADMIN who
 * owns several stores, or an employee added to more than one team), so the
 * app needs to track which one is "in focus" at any given time.
 *
 * The active business id itself lives in `AuthContext` (`activeBusinessId`),
 * persisted to localStorage under `d-inventory:active-business-id` so the
 * selection survives page reloads, and defaulted/reset there whenever the
 * user's business list changes (e.g. falls back to the first business if
 * the previously-selected one is no longer accessible).
 *
 * This hook just looks up the full business summary (id, name, currency,
 * country, location, role) for that id out of `user.businesses` — it
 * returns null if no business is selected or the user hasn't loaded yet.
 */
export function useActiveBusiness() {
  const { user, activeBusinessId } = useAuth()
  return user?.businesses.find((b) => b.id === activeBusinessId) ?? null
}

/**
 * Returns the user's effective role for the active business (`roleInBusiness`
 * on their membership row, falling back to their global account role for
 * SUPERADMIN owners or before a business is picked). Always use this rather
 * than `user?.role` when gating business-scoped UI — promoting/demoting a
 * staff member updates `BusinessUser.role`, not `User.role`.
 */
export function useActiveBusinessRole() {
  const { user } = useAuth()
  const activeBusiness = useActiveBusiness()
  return activeBusiness?.roleInBusiness ?? user?.role
}
