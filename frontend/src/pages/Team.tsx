import { useMemo, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Search, Trash2, Users } from "lucide-react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import * as teamService from "@/services/team.service"
import type { TeamMember } from "@/services/team.service"
import { useAuth } from "@/context/AuthContext"
import { canManage } from "@/lib/permissions"
import { ApiError } from "@/lib/api-client"
import { PageHeader } from "@/components/PageHeader"
import { EmptyState } from "@/components/EmptyState"
import { ErrorState } from "@/components/ErrorState"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { AddTeamMemberDialog } from "@/components/team/AddTeamMemberDialog"
import { ResetPasswordDialog } from "@/components/team/ResetPasswordDialog"
import { TeamMemberDetailSheet } from "@/components/team/TeamMemberDetailSheet"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

// Derives up-to-two-letter initials from a full name, for avatar fallbacks.
function initials(fullName: string) {
  return fullName.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()
}

/**
 * Team page — lists everyone with access to the active business, and lets
 * managers change a member's role (Employee/Admin), reset their password,
 * or remove them. A name/username/phone search filters the list, and
 * clicking a row opens `TeamMemberDetailSheet` (a read-only profile view —
 * phone, email, when they joined) without disturbing the row's own
 * management controls.
 *
 * Data: `["team", activeBusinessId]` via `teamService.getTeamMembers`.
 * Role changes and removals both call `invalidate()`, which refetches the
 * team list and `["business", activeBusinessId]` (team count shown
 * elsewhere).
 *
 * Role-gating rules baked into the row rendering:
 * - Only users passing `canManage(user?.role)` see edit controls at all.
 * - The business owner (`role === "SUPERADMIN"`) can never have their role
 *   changed or be removed, even by another manager.
 * - A user can't remove themselves (`isSelf`), though they can still see
 *   their own row's role badge.
 */
export default function Team() {
  const { t } = useTranslation()
  const { user, activeBusinessId } = useAuth()
  const queryClient = useQueryClient()
  const canEdit = canManage(user?.role)
  const [search, setSearch] = useState("")
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null)

  const teamQuery = useQuery({
    queryKey: ["team", activeBusinessId],
    queryFn: () => teamService.getTeamMembers(activeBusinessId!),
    enabled: !!activeBusinessId,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["team", activeBusinessId] })
    queryClient.invalidateQueries({ queryKey: ["business", activeBusinessId] })
  }

  const roleMutation = useMutation({
    mutationFn: ({ businessUserId, role }: { businessUserId: string; role: "ADMIN" | "EMPLOYEE" }) =>
      teamService.updateTeamMemberRole(activeBusinessId!, businessUserId, role),
    onSuccess: () => {
      invalidate()
      toast.success(t("Role updated"))
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t("Could not update role")),
  })

  const removeMutation = useMutation({
    mutationFn: (businessUserId: string) => teamService.removeTeamMember(activeBusinessId!, businessUserId),
    onSuccess: () => {
      invalidate()
      toast.success(t("Team member removed"))
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t("Could not remove team member")),
  })

  const members = teamQuery.data ?? []
  // Client-side filter over the fetched member list, matching on name,
  // username, or phone (case-insensitive).
  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return members
    return members.filter(
      (m) =>
        m.user.fullName.toLowerCase().includes(q) ||
        m.user.username.toLowerCase().includes(q) ||
        m.user.phone.toLowerCase().includes(q)
    )
  }, [members, search])

  if (!activeBusinessId) {
    return (
      <EmptyState
        icon={<Users className="size-6" />}
        title="No business selected"
        description="Select or create a business to manage its team."
      />
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader action={canEdit && <AddTeamMemberDialog />} />

      {teamQuery.isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : teamQuery.isError ? (
        <ErrorState onRetry={() => teamQuery.refetch()} />
      ) : members.length === 0 ? (
        <EmptyState icon={<Users className="size-6" />} title="No team members yet" />
      ) : (
        <div className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t("Search team members...")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {filteredMembers.length === 0 ? (
            <EmptyState icon={<Users className="size-6" />} title="No matches" description="Try a different search term." />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Name")}</TableHead>
                    <TableHead>{t("Username")}</TableHead>
                    <TableHead>{t("Role")}</TableHead>
                    <TableHead className="text-right">{t("Actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMembers.map((member) => {
                    const isSelf = member.userId === user?.id
                    const isOwner = member.role === "SUPERADMIN"
                    return (
                      <TableRow
                        key={member.id}
                        className="cursor-pointer"
                        onClick={() => setSelectedMember(member)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Avatar className="size-7">
                              <AvatarFallback className="text-xs">{initials(member.user.fullName)}</AvatarFallback>
                            </Avatar>
                            <span className="font-medium">{member.user.fullName}</span>
                            {isSelf && <span className="text-xs text-muted-foreground">({t("you")})</span>}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{member.user.username}</TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {canEdit && !isOwner ? (
                            <Select
                              value={member.role}
                              onValueChange={(role) =>
                                roleMutation.mutate({ businessUserId: member.id, role: role as "ADMIN" | "EMPLOYEE" })
                              }
                            >
                              <SelectTrigger size="sm" className="w-32">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="EMPLOYEE">{t("Employee")}</SelectItem>
                                <SelectItem value="ADMIN">{t("Admin")}</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant="secondary">{member.role}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          {canEdit && !isOwner && !isSelf && (
                            <div className="flex justify-end gap-2">
                              <ResetPasswordDialog businessUserId={member.id} memberName={member.user.fullName} />
                              <ConfirmDialog
                                trigger={
                                  <Button variant="outline" size="icon-sm" aria-label={t("Remove team member")}>
                                    <Trash2 className="size-3.5" />
                                  </Button>
                                }
                                title="Remove team member?"
                                description={`${member.user.fullName} will lose access to this business.`}
                                confirmLabel="Remove"
                                isLoading={removeMutation.isPending}
                                onConfirm={() => removeMutation.mutate(member.id)}
                              />
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      <TeamMemberDetailSheet member={selectedMember} onOpenChange={(open) => !open && setSelectedMember(null)} />
    </div>
  )
}
