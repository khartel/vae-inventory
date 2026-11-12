import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { Building2, KeyRound, LogOut, Plus } from "lucide-react"
import { useTranslation } from "react-i18next"
import * as businessService from "@/services/business.service"
import { useAuth } from "@/context/AuthContext"
import { AuthBackground } from "@/components/auth/AuthBackground"
import { ThemeToggle } from "@/components/ThemeToggle"
import { BusinessCard } from "@/components/businesses/BusinessCard"
import { CreateBusinessDialog } from "@/components/businesses/CreateBusinessDialog"
import { EditBusinessDialog } from "@/components/businesses/EditBusinessDialog"
import { EmptyState } from "@/components/EmptyState"
import { ErrorState } from "@/components/ErrorState"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// Derives up-to-two-letter initials from a full name, for avatar fallbacks.
function initials(fullName: string) {
  return fullName
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

/**
 * SelectBusiness page — the post-login landing screen where a user picks
 * which business to work in (or, for the owner, creates a new one). Also
 * hosts the account menu (change password, log out).
 *
 * Data: for SUPERADMIN users, `["businesses"]` via
 * `businessService.getMyBusinesses` (their owned businesses, with stats).
 * Non-owner users instead use `user.businesses` already present on the
 * auth session (the businesses they've been added to as staff) — no extra
 * fetch needed.
 *
 * Interactions: selecting a business card calls `setActiveBusinessId` and
 * navigates to `/pos`; SUPERADMINs additionally get a "New business" tile
 * that opens `CreateBusinessDialog`. `handleLogout` clears the session and
 * redirects to `/login`.
 */
export default function SelectBusiness() {
  const { t } = useTranslation()
  const { user, activeBusinessId, setActiveBusinessId, logout } = useAuth()
  const navigate = useNavigate()
  const isSuperAdmin = user?.role === "SUPERADMIN"

  const businessesQuery = useQuery({
    queryKey: ["businesses"],
    queryFn: businessService.getMyBusinesses,
    enabled: isSuperAdmin,
  })

  const enterBusiness = (id: string) => {
    setActiveBusinessId(id)
    navigate("/pos")
  }

  const handleLogout = async () => {
    await logout()
    navigate("/login", { replace: true })
  }

  if (!user) return null

  const businesses = isSuperAdmin ? (businessesQuery.data ?? []) : user.businesses

  return (
    <div className="relative min-h-svh">
      <AuthBackground />

      <header className="relative flex items-center justify-between px-6 py-5 sm:px-10">
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-success text-primary-foreground shadow-[0_0_16px_var(--glow-primary)]">
            <Building2 className="size-5" />
          </div>
          <span className="font-heading text-lg font-semibold">VAE Inventory</span>
        </div>

        <div className="flex items-center gap-3">
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 transition-colors hover:bg-foreground/5">
                <Avatar className="size-8">
                  <AvatarFallback>{initials(user.fullName)}</AvatarFallback>
                </Avatar>
                <span className="hidden text-sm font-medium sm:inline">{user.fullName}</span>
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

      <main className="relative mx-auto max-w-6xl px-6 pb-16 pt-6 sm:px-10">
        <div className="mb-10">
          <h1 className="font-heading text-3xl font-semibold sm:text-4xl">
            {t("Welcome back, {{name}}", { name: user.fullName.split(" ")[0] })}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {isSuperAdmin
              ? t("Choose a business to manage, or set up a new one.")
              : t("Choose a business to get to work.")}
          </p>
        </div>

        {isSuperAdmin && businessesQuery.isLoading ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-56 rounded-3xl" />
            ))}
          </div>
        ) : isSuperAdmin && businessesQuery.isError ? (
          <ErrorState onRetry={() => businessesQuery.refetch()} />
        ) : businesses.length === 0 ? (
          isSuperAdmin ? (
            <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-border py-20 text-center">
              <EmptyState
                icon={<Building2 className="size-6" />}
                title="No businesses yet"
                description="Create your first business to start tracking inventory and sales."
              />
              <CreateBusinessDialog onCreated={(id) => enterBusiness(id)} />
            </div>
          ) : (
            <EmptyState
              icon={<Building2 className="size-6" />}
              title="No businesses yet"
              description="You haven't been added to a business yet. Ask your admin to add you."
            />
          )
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {isSuperAdmin
              ? businessesQuery.data!.map((business) => (
                  <BusinessCard
                    key={business.id}
                    name={business.name}
                    location={business.location}
                    country={business.country}
                    currency={business.currency}
                    isActive={business.id === activeBusinessId}
                    onSelect={() => enterBusiness(business.id)}
                    stats={{
                      products: business._count.products,
                      warehouses: business._count.warehouses,
                      team: business._count.businessUsers,
                      sales: business._count.transactions,
                    }}
                    actions={<EditBusinessDialog business={business} />}
                  />
                ))
              : user.businesses.map((business) => (
                  <BusinessCard
                    key={business.id}
                    name={business.name}
                    location={business.location}
                    country={business.country}
                    currency={business.currency}
                    isActive={business.id === activeBusinessId}
                    onSelect={() => enterBusiness(business.id)}
                  />
                ))}

            {isSuperAdmin && (
              <CreateBusinessDialog
                onCreated={(id) => enterBusiness(id)}
                trigger={
                  <button className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-success/50 hover:text-success">
                    <div className="flex size-12 items-center justify-center rounded-2xl bg-muted">
                      <Plus className="size-6" />
                    </div>
                    <span className="text-sm font-medium">{t("New business")}</span>
                  </button>
                }
              />
            )}
          </div>
        )}
      </main>
    </div>
  )
}
