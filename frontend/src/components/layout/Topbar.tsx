import { useState } from "react"
import { Bell, ChevronDown, LogOut, KeyRound, Menu } from "lucide-react"
import { useLocation, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/context/AuthContext"
import { useActiveBusiness } from "@/hooks/useActiveBusiness"
import { SidebarBrand, SidebarNav, NAV_ITEMS } from "@/components/layout/Sidebar"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/ThemeToggle"
import { LanguageSwitcher } from "@/components/LanguageSwitcher"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"

// Derives up to two uppercase initials from a full name, for the avatar
// fallback (e.g. "Jane Doe" -> "JD").
function initials(fullName: string) {
  return fullName
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

/**
 * Top app bar shown above the page content in `AppLayout`. Shows: a mobile
 * hamburger button that opens the nav as a slide-in `Sheet` (reusing
 * `SidebarBrand`/`SidebarNav` so mobile and desktop nav stay in sync), the
 * active business name plus the current page label (looked up from
 * `NAV_ITEMS` by matching the current pathname), a theme toggle, a
 * notifications button (UI only, no backend wiring yet), and a user menu
 * with "change password" and "log out" actions. Returns `null` if there's
 * no authenticated user, since callers only render this behind
 * `ProtectedRoute`.
 */
export function Topbar() {
  const { user, logout } = useAuth()
  const { t } = useTranslation()
  const activeBusiness = useActiveBusiness()
  const location = useLocation()
  const navigate = useNavigate()
  const [navOpen, setNavOpen] = useState(false) // controls the mobile nav Sheet

  if (!user) return null

  // Look up the label for whichever nav item matches the current route, to
  // show alongside the active business name (e.g. "Acme Store · Dashboard").
  // Matches on prefix (not just exact equality) so nested routes like
  // /settings/profile still resolve to the "Settings" nav item.
  const pageLabel = NAV_ITEMS.find(
    (item) => location.pathname === item.to || location.pathname.startsWith(item.to + "/")
  )?.label

  // Logs the user out, then imperatively redirects to /login. Note this
  // happens independently of ProtectedRoute's own redirect-on-logout logic;
  // see the comment in ProtectedRoute.tsx about the `state.from` quirk that
  // can result from the two racing.
  const handleLogout = async () => {
    await logout()
    navigate("/login", { replace: true })
  }

  return (
    <header className="workspace-topbar flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-card/60 px-4 backdrop-blur-xl sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("Open navigation")}
            className="lg:hidden"
            onClick={() => setNavOpen(true)}
          >
            <Menu className="size-5" />
          </Button>
          <SheetContent
            side="left"
            showCloseButton={false}
            className="workspace-sidebar flex w-64 flex-col gap-0 border-r border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
          >
            <SheetTitle className="sr-only">{t("Navigation")}</SheetTitle>
            <SidebarBrand />
            <SidebarNav onNavigate={() => setNavOpen(false)} />
          </SheetContent>
        </Sheet>

        {activeBusiness ? (
          <p className="min-w-0 truncate text-sm font-semibold">
            {activeBusiness.name}
            {pageLabel && <span className="font-normal text-muted-foreground"> · {t(pageLabel)}</span>}
          </p>
        ) : (
          <span className="text-sm text-muted-foreground">{t("No business selected")}</span>
        )}
      </div>

      <div className="flex items-center gap-1.5 sm:gap-3">
        <LanguageSwitcher />
        <ThemeToggle />

        <Button variant="ghost" size="icon" aria-label={t("Notifications")} className="hidden sm:inline-flex">
          <Bell className="size-4.5" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted">
              <Avatar className="size-8">
                <AvatarFallback>{initials(user.fullName)}</AvatarFallback>
              </Avatar>
              <div className="hidden text-left sm:block">
                <p className="text-sm font-medium leading-none">{user.fullName}</p>
                <p className="text-xs text-muted-foreground">{activeBusiness?.roleInBusiness ?? user.role}</p>
              </div>
              <ChevronDown className="hidden size-4 text-muted-foreground sm:block" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>{user.username}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/change-password")}>
              <KeyRound className="size-4" />
              {t("Change password")}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={handleLogout}>
              <LogOut className="size-4" />
              {t("Log out")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
