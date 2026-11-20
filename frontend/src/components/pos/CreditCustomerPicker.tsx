import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import { UserPlus } from "lucide-react"
import * as customerService from "@/services/customer.service"
import { useActiveBusinessRole } from "@/hooks/useActiveBusiness"
import { canManage } from "@/lib/permissions"
import { Input } from "@/components/ui/input"
import { CustomerFormDialog } from "@/components/customers/CustomerFormDialog"

export interface SelectedCreditCustomer {
  id: string
  name: string
}

/**
 * Strict customer picker for Credit sales — unlike `CustomerNameField`
 * (free-text, used for Cash/Transfer), a Credit sale can only be attributed
 * to a real, already-known customer: typing a name alone is never enough,
 * the cashier must actually click a search result. `value` only ever
 * becomes non-null via that click (or via the inline "add customer"
 * shortcut below), which is what lets the register block checkout on a
 * missing selection rather than a missing string.
 *
 * When there are zero matches for what's been typed, SUPERADMIN/ADMIN
 * cashiers (the only roles allowed to manage the customer directory — see
 * lib/permissions.ts) get an inline shortcut to add that person on the spot
 * via `CustomerFormDialog` in its controlled-open mode, pre-filled with the
 * typed name; on success the new customer is selected automatically so the
 * sale can continue without losing the cart. EMPLOYEE cashiers instead see
 * a plain "ask a manager" message, since they can't create customers.
 */
export function CreditCustomerPicker({
  businessId,
  value,
  onChange,
  error,
}: {
  businessId: string
  value: SelectedCreditCustomer | null
  onChange: (value: SelectedCreditCustomer | null) => void
  error?: string
}) {
  const { t } = useTranslation()
  const activeRole = useActiveBusinessRole()
  const canAddCustomer = canManage(activeRole)
  const [query, setQuery] = useState(value?.name ?? "")
  const [debounced, setDebounced] = useState(query)
  const [focused, setFocused] = useState(false)
  const [addDialogOpen, setAddDialogOpen] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 200)
    return () => clearTimeout(timer)
  }, [query])

  // Keep the visible text in sync if the selection changes from elsewhere
  // (e.g. cleared by the parent when payment method changes away and back).
  useEffect(() => {
    setQuery(value?.name ?? "")
  }, [value])

  const search = useQuery({
    queryKey: ["customers-search", businessId, debounced],
    queryFn: () => customerService.getCustomers(businessId, { search: debounced, limit: 5 }),
    enabled: debounced.trim().length > 0,
  })

  const results = search.data ?? []
  const hasQuery = debounced.trim().length > 0
  const showDropdown = focused && hasQuery
  const noResults = hasQuery && !search.isLoading && results.length === 0

  const handleTextChange = (next: string) => {
    setQuery(next)
    if (value) onChange(null)
  }

  return (
    <div className="relative">
      <Input
        placeholder={t("Search for an existing customer")}
        value={query}
        onChange={(e) => handleTextChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        aria-invalid={!!error}
        aria-required
      />
      {error && <p className="mt-1 text-xs text-destructive">{t(error)}</p>}
      {showDropdown && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-border/60 bg-popover/95 shadow-xl backdrop-blur-2xl dark:bg-popover/80">
          {results.map((customer) => (
            <button
              key={customer.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange({ id: customer.id, name: customer.name })
                setFocused(false)
              }}
              className="flex w-full items-center justify-between gap-3 border-b border-border/40 px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
            >
              <span className="font-medium">{customer.name}</span>
              <span className="text-xs text-muted-foreground">{customer.phone}</span>
            </button>
          ))}
          {noResults && canAddCustomer && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setAddDialogOpen(true)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
            >
              <UserPlus className="size-4" />
              {t("Add \"{{name}}\" as a new customer", { name: debounced.trim() })}
            </button>
          )}
          {noResults && !canAddCustomer && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {t("No customer found — ask a manager to add them first.")}
            </p>
          )}
        </div>
      )}

      <CustomerFormDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        initialName={debounced.trim()}
        onCreated={(customer) => {
          onChange({ id: customer.id, name: customer.name })
        }}
      />
    </div>
  )
}
