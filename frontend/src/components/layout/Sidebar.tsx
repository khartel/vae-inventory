import { Link, NavLink } from "react-router-dom"
import { useTranslation } from "react-i18next"
import {
  Store,
  LayoutDashboard,
  Package,
  Warehouse,
  ArrowLeftRight,
  Users,
  Contact,
  BarChart3,
  Boxes,
  Building2,
  Settings,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/context/AuthContext"
import type { Role } from "@/types"

interface NavItem {
  to: string
  label: string
  icon: typeof LayoutDashboard
  roles?: Role[]
}

// Master list of nav destinations for the app. Items with a `roles` array
// are restricted to users whose role is included in that list (see
// `SidebarNav`'s filtering below); items without `roles` are visible to
// everyone. Also re-exported and reused by `Topbar` (for the mobile nav
// sheet and for looking up the current page's label).
export const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/pos", label: "Register", icon: Store },
  { to: "/customers", label: "Customers", icon: Contact },
  { to: "/products", label: "Products", icon: Package },
  { to: "/warehouses", label: "Warehouses", icon: Warehouse },
  { to: "/stock", label: "Stock Movements", icon: ArrowLeftRight },
  { to: "/team", label: "Team", icon: Users },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/businesses", label: "Businesses", icon: Building2, roles: ["SUPERADMIN"] },
  { to: "/settings", label: "Settings", icon: Settings, roles: ["SUPERADMIN"] },
]

/** Logo + app name, linking back to `/`. Shared by the desktop sidebar and the mobile nav sheet. */
export function SidebarBrand() {
  return (
    <Link to="/" className="flex h-16 items-center gap-2 px-6 transition-opacity hover:opacity-80">
      <div className="flex size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-[0_0_16px_var(--glow-primary)]">
        <Boxes className="size-5" />
      </div>
      <span className="font-heading text-lg font-semibold text-white">VAE Inventory</span>
    </Link>
  )
}

/**
 * Renders the vertical list of nav links, highlighting the active route.
 * `onNavigate` is called whenever a link is clicked — used by `Topbar` to
 * close the mobile nav sheet after navigating; the desktop `Sidebar` omits
 * it since there's nothing to close.
 */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth()
  const { t } = useTranslation()
  // Role-based filtering: an item is shown if it has no `roles` restriction,
  // or if the current user's role is in that restriction list (e.g. the
  // "Businesses" and "Settings" links are SUPERADMIN-only).
  const items = NAV_ITEMS.filter((item) => !item.roles || (user && item.roles.includes(user.role)))

  return (
    <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
              isActive
                ? "bg-gradient-to-r from-sidebar-primary to-emerald-400 text-sidebar-primary-foreground shadow-[0_0_20px_var(--glow-primary)]"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
            )
          }
        >
          <item.icon className="size-4.5 shrink-0" />
          {t(item.label)}
        </NavLink>
      ))}
    </nav>
  )
}

/**
 * Fixed desktop sidebar (hidden below the `lg` breakpoint, where `Topbar`'s
 * sheet-based nav takes over instead). Composes `SidebarBrand` + `SidebarNav`
 * plus a small copyright footer.
 */
export function Sidebar() {
  return (
    <aside className="hidden h-svh w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar/85 text-sidebar-foreground backdrop-blur-2xl lg:flex">
      <SidebarBrand />
      <SidebarNav />
      <div className="border-t border-sidebar-border p-4 text-xs text-sidebar-foreground/40">
        VAE Inventory &copy; {new Date().getFullYear()}
      </div>
    </aside>
  )
}
