import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Check, Copy, History, KeyRound, Loader2, Search, ShieldAlert, Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import * as platformService from "@/services/platform.service"
import type { AuditLogEntry } from "@/services/auditLog.service"
import { copyTextToClipboard } from "@/lib/clipboard"
import { ApiError } from "@/lib/api-client"
import { formatDate, formatDateTime } from "@/lib/format"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { ThemeToggle } from "@/components/ThemeToggle"
import { AuthShell } from "@/components/auth/AuthShell"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { EmptyState } from "@/components/EmptyState"
import { ErrorState } from "@/components/ErrorState"

// Human-readable label + one-line detail for each platform-level audit
// action. Deliberately separate from Settings > Activity Log's `describe()`
// (frontend/src/pages/settings/SettingsActivity.tsx) - that one covers
// per-business actions, this covers the fixed, much smaller set of
// platform-level ones (see `listPlatformAuditLog` on the backend).
function describePlatformEvent(entry: AuditLogEntry): { label: string; detail: string } {
  const m = entry.metadata ?? {}
  switch (entry.action) {
    case "business.deleted":
      return { label: "Deleted business", detail: String(m.name ?? "") }
    case "superadmin.registered":
      return { label: "New SuperAdmin registered", detail: String(m.username ?? "") }
    case "superadmin.removed":
      return { label: "SuperAdmin removed", detail: String(m.fullName ?? m.username ?? "") }
    default:
      return { label: entry.action, detail: "" }
  }
}

/**
 * UnlockGate — the entry screen for the platform admin console. Prompts for
 * a master key and verifies it by attempting `platformService.getSuperAdmins`
 * with that key; a successful call both validates the key and (via
 * `onUnlock`) hands it up to be reused as the auth token for the rest of
 * the console's requests. This screen has no persistent session — the key
 * only lives in React state for as long as the page is open.
 */
function UnlockGate({ onUnlock }: { onUnlock: (key: string) => void }) {
  const { t } = useTranslation()
  const [key, setKey] = useState("")
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setChecking(true)
    setError(null)
    try {
      await platformService.getSuperAdmins(key)
      onUnlock(key)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("Could not verify master key"))
    } finally {
      setChecking(false)
    }
  }

  return (
    <AuthShell title="Platform admin" description="Enter the master key to continue.">
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="master-key">{t("Master key")}</Label>
          <Input
            id="master-key"
            type="password"
            autoFocus
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="••••••••••••"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          type="submit"
          className="w-full rounded-full bg-gradient-to-r from-primary to-success text-primary-foreground hover:opacity-90"
          disabled={checking || !key}
        >
          {checking && <Loader2 className="size-4 animate-spin" />}
          {t("Unlock")}
        </Button>
      </form>
    </AuthShell>
  )
}

/**
 * ResetPasswordAction — button that resets a given SuperAdmin's password via
 * `platformService.resetSuperAdminPassword`. On success, swaps itself out
 * for a one-time display of the newly generated password with a
 * copy-to-clipboard button (the "copied" checkmark auto-reverts after 2s).
 */
function ResetPasswordAction({ masterKey, userId }: { masterKey: string; userId: string }) {
  const { t } = useTranslation()
  const [result, setResult] = useState<{ username: string; newPassword: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const copyTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current)
      }
    }
  }, [])

  const mutation = useMutation({
    mutationFn: () => platformService.resetSuperAdminPassword(masterKey, userId),
    onSuccess: (data) => setResult(data),
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t("Could not reset password")),
  })

  const copy = async (trigger?: HTMLElement) => {
    if (!result) return
    const dialog = trigger?.closest<HTMLElement>('[role="dialog"], [data-slot="dialog-content"]')
    const ok = await copyTextToClipboard(result.newPassword, dialog)
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

  if (result) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs">
        <span className="font-mono select-all">{result.newPassword}</span>
        <Button type="button" variant="ghost" size="icon-sm" onClick={(e) => copy(e.currentTarget)} aria-label={t("Copy password")}>
          {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
    )
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      aria-label={t("Reset password")}
      disabled={mutation.isPending}
      onClick={() => mutation.mutate()}
    >
      {mutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
    </Button>
  )
}

/**
 * ActivityTab — platform-level audit trail: a business being deleted, or a
 * SuperAdmin account being registered/removed. These can never show up on
 * any per-business Activity Log page (Settings > Activity Log) - a deleted
 * business is gone by the time you'd look there, and account
 * registration/removal isn't tied to a business at all.
 */
function ActivityTab({ masterKey }: { masterKey: string }) {
  const { t } = useTranslation()

  const query = useQuery({
    queryKey: ["platform-activity"],
    queryFn: () => platformService.getPlatformActivity(masterKey),
  })

  const entries = query.data ?? []

  if (query.isLoading) return <Skeleton className="h-64 rounded-xl" />
  if (query.isError) return <ErrorState onRetry={() => query.refetch()} />
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<History className="size-6" />}
        title="No activity yet"
        description="Business deletions and SuperAdmin registrations/removals will show up here."
      />
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("When")}</TableHead>
            <TableHead>{t("Action")}</TableHead>
            <TableHead>{t("Detail")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => {
            const { label, detail } = describePlatformEvent(entry)
            return (
              <TableRow key={entry.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDateTime(entry.createdAt)}
                </TableCell>
                <TableCell className="font-medium">{t(label)}</TableCell>
                <TableCell className="text-muted-foreground">{detail}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

/**
 * AdminConsole — the unlocked platform admin view. Lists every SuperAdmin
 * account on the platform (each account "owns" its own set of businesses)
 * and lets the operator reset a SuperAdmin's password or delete the
 * account entirely (which cascades to their businesses/products/sales).
 *
 * Data: `["platform-superadmins"]` via `platformService.getSuperAdmins(masterKey)`.
 * All requests are authenticated with the master key passed down from
 * `UnlockGate` rather than a normal user session.
 */
function AdminConsole({ masterKey }: { masterKey: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")

  const query = useQuery({
    queryKey: ["platform-superadmins"],
    queryFn: () => platformService.getSuperAdmins(masterKey),
  })

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => platformService.deleteSuperAdmin(masterKey, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-superadmins"] })
      toast.success(t("SuperAdmin deleted"))
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t("Could not delete SuperAdmin")),
  })

  const superAdmins = useMemo(() => query.data ?? [], [query.data])
  // Client-side filter over the fetched SuperAdmin list, matching on name
  // or username (case-insensitive).
  const filteredSuperAdmins = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return superAdmins
    return superAdmins.filter(
      (a) => a.fullName.toLowerCase().includes(q) || a.username.toLowerCase().includes(q)
    )
  }, [superAdmins, search])

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">{t("Platform admin")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("Manage SuperAdmin accounts across the platform.")}</p>
        </div>
        <ThemeToggle />
      </div>

      <Tabs defaultValue="superadmins">
        <TabsList>
          <TabsTrigger value="superadmins">{t("SuperAdmins")}</TabsTrigger>
          <TabsTrigger value="activity">{t("Activity")}</TabsTrigger>
        </TabsList>
        <TabsContent value="superadmins" className="space-y-6">
      {query.isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : query.isError ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : superAdmins.length === 0 ? (
        <EmptyState icon={<ShieldAlert className="size-6" />} title="No SuperAdmins" description="No SuperAdmin accounts exist yet." />
      ) : (
        <div className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t("Search SuperAdmins...")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {filteredSuperAdmins.length === 0 && (
            <EmptyState icon={<ShieldAlert className="size-6" />} title="No matches" description="Try a different search term." />
          )}

          {filteredSuperAdmins.map((admin) => (
            <Card key={admin.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{admin.fullName}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      @{admin.username} · {admin.phone}
                      {admin.email && ` · ${admin.email}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("Joined {{date}}", { date: formatDate(admin.createdAt) })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <ResetPasswordAction masterKey={masterKey} userId={admin.id} />
                    <ConfirmDialog
                      trigger={
                        <Button variant="outline" size="icon-sm" aria-label={t("Delete SuperAdmin")}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      }
                      title="Delete SuperAdmin?"
                      description={`This will permanently delete ${admin.fullName} and all of their businesses, products, and sales history. This cannot be undone.`}
                      confirmLabel="Delete"
                      isLoading={deleteMutation.isPending}
                      onConfirm={() => deleteMutation.mutate(admin.id)}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {admin.ownedBusinesses.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("No businesses yet.")}</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {admin.ownedBusinesses.map((business) => (
                      <li key={business.id} className="flex items-center justify-between py-2 text-sm">
                        <span className="font-medium">{business.name}</span>
                        <span className="text-muted-foreground">
                          {business.country} · {business.currency} · {business._count.transactions} sales
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
        </TabsContent>
        <TabsContent value="activity">
          <ActivityTab masterKey={masterKey} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/**
 * PlatformAdmin page — a super-user tool separate from normal business
 * accounts, used to administer SuperAdmin accounts across the whole
 * platform. It is protected by a master key rather than the regular auth
 * session: `UnlockGate` is shown until a valid key is entered, after which
 * `AdminConsole` renders using that key for all API calls. State (the key)
 * is held only in memory and is lost on refresh/navigation.
 */
export default function PlatformAdmin() {
  const [masterKey, setMasterKey] = useState<string | null>(null)

  if (!masterKey) {
    return <UnlockGate onUnlock={setMasterKey} />
  }

  return <AdminConsole masterKey={masterKey} />
}
