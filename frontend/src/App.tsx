import { lazy, Suspense } from "react"
import { Navigate, Route, Routes } from "react-router-dom"
import { Loader2 } from "lucide-react"
import { AppLayout } from "@/components/layout/AppLayout"
import { ProtectedRoute } from "@/components/ProtectedRoute"
import Login from "@/pages/auth/Login"
import Register from "@/pages/auth/Register"
import ForgotPassword from "@/pages/auth/ForgotPassword"
import ResetPassword from "@/pages/auth/ResetPassword"
import ChangePassword from "@/pages/ChangePassword"
import SelectBusiness from "@/pages/SelectBusiness"

// Everything behind the app shell is route-level code-split: each page only
// downloads when a user actually navigates to it, instead of all of them
// bloating the initial bundle (see the "chunks larger than 500kB" build
// warning this was added to address). Auth/landing pages above stay
// eagerly-loaded since they're on the critical path for every session.
const Pos = lazy(() => import("@/pages/Pos"))
const Customers = lazy(() => import("@/pages/Customers"))
const Dashboard = lazy(() => import("@/pages/Dashboard"))
const Warehouses = lazy(() => import("@/pages/Warehouses"))
const Products = lazy(() => import("@/pages/Products"))
const Team = lazy(() => import("@/pages/Team"))
const StockMovements = lazy(() => import("@/pages/StockMovements"))
const Reports = lazy(() => import("@/pages/Reports"))
const Businesses = lazy(() => import("@/pages/Businesses"))
const SettingsLayout = lazy(() => import("@/pages/settings/SettingsLayout"))
const SettingsHub = lazy(() => import("@/pages/settings/SettingsHub"))
const SettingsProfile = lazy(() => import("@/pages/settings/SettingsProfile"))
const SettingsTwoFactor = lazy(() => import("@/pages/settings/SettingsTwoFactor"))
const SettingsReceipt = lazy(() => import("@/pages/settings/SettingsReceipt"))
const SettingsStockAlerts = lazy(() => import("@/pages/settings/SettingsStockAlerts"))
const SettingsAppearance = lazy(() => import("@/pages/settings/SettingsAppearance"))
const SettingsActivity = lazy(() => import("@/pages/settings/SettingsActivity"))
const SettingsTrash = lazy(() => import("@/pages/settings/SettingsTrash"))
const PlatformAdmin = lazy(() => import("@/pages/PlatformAdmin"))

/** Full-screen spinner shown while a lazy-loaded route's chunk downloads. Mirrors ProtectedRoute's auth-loading spinner. */
function RouteFallback() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  )
}

/**
 * Top-level route tree for the app.
 *
 * - `/login`, `/register`, `/forgot-password`, `/reset-password`, and
 *   `/platform-admin` are public — no auth required.
 *   `/platform-admin` is the separate master-key-gated screen for managing
 *   SuperAdmin accounts (see services/platform.service.ts), not part of the
 *   normal per-business role system.
 * - Everything else is nested under `<ProtectedRoute />`, a layout route
 *   (components/ProtectedRoute.tsx) that redirects unauthenticated users to
 *   `/login` and forces users with `mustChangePassword` set to
 *   `/change-password` before they can reach anything else. Note this only
 *   gates on "is logged in", not on business role — per-role UI is instead
 *   controlled within individual pages/components via
 *   `lib/permissions.ts` (`canManage`) and each page's own checks.
 * - `/` (SelectBusiness) lets a user pick which of their businesses to
 *   operate in (see hooks/useActiveBusiness.ts) before reaching business
 *   data screens.
 * - The remaining business-scoped pages (POS, customers, dashboard,
 *   products, warehouses, stock, team, reports, businesses, settings) are
 *   further nested under `<AppLayout />`, which renders the shared
 *   sidebar/topbar chrome around each page's content. `/settings` is
 *   itself a small nested route tree (`SettingsLayout` + a card-grid
 *   index page plus one route per section) rather than a single flat
 *   page — see `pages/settings/`.
 * - Any unmatched path falls back to redirecting to `/`.
 * - Every business-scoped page and Settings sub-page is `React.lazy`-loaded
 *   (see the imports above) and rendered inside a single `<Suspense>` around
 *   the whole tree, showing `RouteFallback` while a chunk downloads —
 *   `/login`/`/register`/`/platform-admin` etc. stay eager since they're
 *   on the critical path for every session regardless.
 */
function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/platform-admin" element={<PlatformAdmin />} />

        <Route element={<ProtectedRoute />}>
          <Route path="/change-password" element={<ChangePassword />} />
          <Route path="/" element={<SelectBusiness />} />

          <Route element={<AppLayout />}>
            <Route path="/pos" element={<Pos />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/products" element={<Products />} />
            <Route path="/warehouses" element={<Warehouses />} />
            <Route path="/stock" element={<StockMovements />} />
            <Route path="/team" element={<Team />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/businesses" element={<Businesses />} />
            <Route path="/settings" element={<SettingsLayout />}>
              <Route index element={<SettingsHub />} />
              <Route path="profile" element={<SettingsProfile />} />
              <Route path="2fa" element={<SettingsTwoFactor />} />
              <Route path="receipt" element={<SettingsReceipt />} />
              <Route path="stock-alerts" element={<SettingsStockAlerts />} />
              <Route path="appearance" element={<SettingsAppearance />} />
              <Route path="activity" element={<SettingsActivity />} />
              <Route path="trash" element={<SettingsTrash />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

export default App
