import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Star, Trash2, Warehouse as WarehouseIcon } from "lucide-react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import * as warehouseService from "@/services/warehouse.service"
import { useAuth } from "@/context/AuthContext"
import { useActiveBusinessRole } from "@/hooks/useActiveBusiness"
import { canManage } from "@/lib/permissions"
import { ApiError } from "@/lib/api-client"
import { PageHeader } from "@/components/PageHeader"
import { EmptyState } from "@/components/EmptyState"
import { ErrorState } from "@/components/ErrorState"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { WarehouseFormDialog } from "@/components/warehouses/WarehouseFormDialog"
import { WarehouseDetailSheet } from "@/components/warehouses/WarehouseDetailSheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/**
 * Warehouses page — lists all warehouses/storage locations for the active
 * business, with product-in-stock counts, and lets managers create/edit
 * warehouses, promote one to "primary" (the default location used e.g. for
 * POS stock checks), or delete a warehouse.
 *
 * Data: `["warehouses", activeBusinessId]` via
 * `warehouseService.getWarehouses`. Setting a primary warehouse or
 * deleting one both call `invalidate()`, refetching the warehouse list and
 * `["business", activeBusinessId]`. Clicking a row opens
 * `WarehouseDetailSheet` for the selected warehouse.
 */
export default function Warehouses() {
  const { t } = useTranslation()
  const { activeBusinessId } = useAuth()
  const activeRole = useActiveBusinessRole()
  const queryClient = useQueryClient()
  const canEdit = canManage(activeRole)
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | null>(null)

  const warehousesQuery = useQuery({
    queryKey: ["warehouses", activeBusinessId],
    queryFn: () => warehouseService.getWarehouses(activeBusinessId!),
    enabled: !!activeBusinessId,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["warehouses", activeBusinessId] })
    queryClient.invalidateQueries({ queryKey: ["business", activeBusinessId] })
  }

  const setPrimaryMutation = useMutation({
    mutationFn: (warehouseId: string) => warehouseService.setPrimaryWarehouse(activeBusinessId!, warehouseId),
    onSuccess: () => {
      invalidate()
      toast.success(t("Primary warehouse updated"))
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t("Could not update")),
  })

  const deleteMutation = useMutation({
    mutationFn: (warehouseId: string) => warehouseService.deleteWarehouse(activeBusinessId!, warehouseId),
    onSuccess: () => {
      invalidate()
      toast.success(t("Warehouse deleted"))
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t("Could not delete warehouse")),
  })

  if (!activeBusinessId) {
    return (
      <EmptyState
        icon={<WarehouseIcon className="size-6" />}
        title="No business selected"
        description="Select or create a business to manage warehouses."
      />
    )
  }

  const warehouses = warehousesQuery.data ?? []

  return (
    <div className="space-y-6">
      <PageHeader action={canEdit && <WarehouseFormDialog />} />

      {warehousesQuery.isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : warehousesQuery.isError ? (
        <ErrorState onRetry={() => warehousesQuery.refetch()} />
      ) : warehouses.length === 0 ? (
        <EmptyState
          icon={<WarehouseIcon className="size-6" />}
          title="No warehouses yet"
          description="Create your first warehouse to start adding stock."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Name")}</TableHead>
                <TableHead>{t("Location")}</TableHead>
                <TableHead>{t("Products in stock")}</TableHead>
                <TableHead className="text-right">{t("Actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {warehouses.map((warehouse) => (
                <TableRow
                  key={warehouse.id}
                  className="cursor-pointer"
                  onClick={() => setSelectedWarehouseId(warehouse.id)}
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {warehouse.name}
                      {warehouse.isPrimary && (
                        <Badge variant="secondary" className="gap-1">
                          <Star className="size-3 fill-current" />
                          {t("Primary")}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{warehouse.location || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{warehouse._count?.stock ?? 0}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {canEdit && (
                      <div className="flex justify-end gap-2">
                        {!warehouse.isPrimary && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPrimaryMutation.mutate(warehouse.id)}
                            disabled={setPrimaryMutation.isPending}
                          >
                            {t("Make primary")}
                          </Button>
                        )}
                        <WarehouseFormDialog warehouse={warehouse} />
                        <ConfirmDialog
                          trigger={
                            <Button variant="outline" size="icon-sm" aria-label={t("Delete warehouse")}>
                              <Trash2 className="size-3.5" />
                            </Button>
                          }
                          title="Delete warehouse?"
                          description={`This will permanently delete "${warehouse.name}". This can't be undone.`}
                          confirmLabel="Delete"
                          isLoading={deleteMutation.isPending}
                          onConfirm={() => deleteMutation.mutate(warehouse.id)}
                        />
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <WarehouseDetailSheet
        businessId={activeBusinessId}
        warehouseId={selectedWarehouseId}
        onOpenChange={(open) => !open && setSelectedWarehouseId(null)}
      />
    </div>
  )
}
