import { useEffect, useState } from "react";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput, isValidPhoneNumber, type PhoneInputCountry } from "@/components/ui/phone-input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { getProducts } from "@/services/product.service";
import { getWarehouses } from "@/services/warehouse.service";
import * as purchase from "@/services/purchase.service";
import { formatMoney } from "@/lib/format";

/** Generates an RFC-4122 v4 UUID even in plain-HTTP LAN contexts where crypto.randomUUID is unavailable. */
function generateRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function usePurchaseRefresh(b: string) {
  const client = useQueryClient();
  return () => {
    for (const key of ["suppliers", "purchases", "purchase", "products", "warehouses", "stock", "stock-movements", "report-stock-alerts", "business", "dashboard-sales", "audit-log"]) client.invalidateQueries({
      queryKey: [key, b]
    });
  };
}
const supplierSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  phone: z.string().refine(isValidPhoneNumber, "Enter a valid phone number"),
  address: z.string().trim().min(1, "Address is required"),
  email: z.union([z.email(), z.literal("")]).optional()
});
export function SupplierForm({
  businessId,
  supplier,
  defaultCountry,
  onClose
}: {
  businessId: string;
  supplier?: purchase.Supplier;
  defaultCountry?: PhoneInputCountry;
  onClose: () => void;
}) {
  const {
    t
  } = useTranslation();
  const refresh = usePurchaseRefresh(businessId);
  const {
    register,
    control,
    handleSubmit,
    formState: {
      errors,
      isSubmitting
    }
  } = useForm<z.infer<typeof supplierSchema>>({
    resolver: zodResolver(supplierSchema),
    defaultValues: supplier ? {
      ...supplier,
      email: supplier.email ?? ""
    } : {
      name: "",
      phone: "",
      address: "",
      email: ""
    }
  });
  const [error, setError] = useState("");
  return <Dialog open onOpenChange={open => {
    if (!open && !isSubmitting) onClose();
  }}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>{t(supplier ? "Edit supplier" : "Add supplier")}</DialogTitle><DialogDescription>{t("Keep the contact details for your stock suppliers in one place.")}</DialogDescription></DialogHeader><form className="workspace-form" onSubmit={handleSubmit(async values => {
        try {
          setError("");
          await purchase.saveSupplier(businessId, values, supplier?.id);
          refresh();
          toast.success(t("Supplier saved"));
          onClose();
        } catch (e) {
          setError(e instanceof Error ? e.message : t("Could not save supplier"));
        }
      })}>
 <label>{t("Supplier name")}<Input {...register("name")} />{errors.name && <span className="field-error">{t(errors.name.message!)}</span>}</label>
 <label htmlFor="supplier-phone">{t("Phone number")}</label><Controller control={control} name="phone" render={({
          field
        }) => <PhoneInput id="supplier-phone" defaultCountry={defaultCountry} value={field.value} onChange={field.onChange} />} />{errors.phone && <span className="field-error">{t(errors.phone.message!)}</span>}
 <label>{t("Address")}<Input {...register("address")} />{errors.address && <span className="field-error">{t(errors.address.message!)}</span>}</label>
 <label>{t("Email (optional)")}<Input type="email" {...register("email")} />{errors.email && <span className="field-error">{t(errors.email.message!)}</span>}</label>
 {error && <p role="alert" className="field-error">{error}</p>}<Button disabled={isSubmitting} type="submit">{t(isSubmitting ? "Saving..." : "Save supplier")}</Button></form></DialogContent></Dialog>;
}
const orderSchema = z.object({
  supplierId: z.string().min(1, "Select a supplier"),
  warehouseId: z.string().min(1, "Select a warehouse"),
  expectedAt: z.string(),
  notes: z.string().max(2000),
  items: z.array(z.object({
    productId: z.string().min(1, "Select a product"),
    quantity: z.coerce.number().positive().max(1e9),
    unitCost: z.coerce.number().min(0).max(1e9)
  })).min(1).max(100)
}).refine(v => new Set(v.items.map(i => i.productId)).size === v.items.length, {
  message: "Each product can only be added once",
  path: ["items"]
});
export function PurchaseOrderForm({
  businessId,
  order,
  currency,
  onClose,
  onSaved
}: {
  businessId: string;
  order?: purchase.PurchaseOrder;
  currency: string;
  onClose: () => void;
  onSaved: (o: purchase.PurchaseOrder) => void;
}) {
  const {
    t
  } = useTranslation();
  const refresh = usePurchaseRefresh(businessId);
  const [error, setError] = useState("");
  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: {
      errors,
      isSubmitting
    }
  } = useForm<z.input<typeof orderSchema>, unknown, z.output<typeof orderSchema>>({
    resolver: zodResolver(orderSchema),
    defaultValues: order ? {
      ...order,
      notes: order.notes ?? "",
      expectedAt: order.expectedAt?.slice(0, 10) ?? ""
    } : {
      supplierId: "",
      warehouseId: "",
      notes: "",
      expectedAt: "",
      items: [{
        productId: "",
        quantity: 1,
        unitCost: 0
      }]
    }
  });
  const {
    fields,
    append,
    remove
  } = useFieldArray({
    control,
    name: "items"
  });
  const products = useQuery({
    queryKey: ["products", businessId],
    queryFn: () => getProducts(businessId)
  });
  const warehouses = useQuery({
    queryKey: ["warehouses", businessId],
    queryFn: () => getWarehouses(businessId)
  });
  const [supplierSearch, setSupplierSearch] = useState("");
  const [debouncedSupplierSearch, setDebouncedSupplierSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSupplierSearch(supplierSearch), 250);
    return () => clearTimeout(timer);
  }, [supplierSearch]);
  const suppliers = useQuery({
    queryKey: ["suppliers", businessId, "picker", debouncedSupplierSearch],
    queryFn: () => purchase.getSuppliers(businessId, {
      limit: 100,
      search: debouncedSupplierSearch
    })
  });
  const lines = watch("items");
  const total = lines.reduce((sum, i) => sum + Number(i.quantity || 0) * Number(i.unitCost || 0), 0);
  const unavailable = products.isError || warehouses.isError || suppliers.isError;
  return <Dialog open onOpenChange={open => {
    if (!open && !isSubmitting) onClose();
  }}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>{t(order ? "Edit draft purchase" : "New purchase order")}</DialogTitle><DialogDescription>{t("Quantities and costs are per base unit. Stock changes only when you receive the order.")}</DialogDescription></DialogHeader><form className="workspace-form" onSubmit={handleSubmit(async values => {
        try {
          setError("");
          const saved = await purchase.savePurchaseOrder(businessId, {
            ...values,
            expectedAt: values.expectedAt ? new Date(values.expectedAt + "T12:00:00").toISOString() : null
          }, order?.id, order?.version);
          refresh();
          onSaved(saved);
          onClose();
        } catch (e) {
          setError(e instanceof Error ? e.message : t("Could not save purchase"));
        }
      })}>
 <div className="grid gap-4 sm:grid-cols-2"><label>{t("Find supplier")}<Input value={supplierSearch} onChange={e => setSupplierSearch(e.target.value)} placeholder={t("Search suppliers")} /></label><label>{t("Supplier")}<select className="workspace-select" {...register("supplierId")}><option value="">{t("Select a supplier")}</option>{suppliers.data?.rows.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}{order && !suppliers.data?.rows.some(s => s.id === order.supplierId) && <option value={order.supplierId}>{order.supplierName}</option>}</select></label><label>{t("Receiving warehouse")}<select className="workspace-select" {...register("warehouseId")}><option value="">{t("Select a warehouse")}</option>{warehouses.data?.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label><label>{t("Expected delivery")}<Input type="date" {...register("expectedAt")} /></label></div>
 {(errors.supplierId || errors.warehouseId) && <p className="field-error">{t("Select a supplier and receiving warehouse.")}</p>}
 {fields.map((field, index) => <div className="purchase-line" key={field.id}><label>{t("Product")}<select className="workspace-select" {...register(`items.${index}.productId`, {
              onChange: e => {
                const p = products.data?.find(p => p.id === e.target.value);
                setValue(`items.${index}.unitCost`, p?.costPrice ?? 0);
              }
            })}><option value="">{t("Select a product")}</option>{products.data?.map(p => <option value={p.id} key={p.id}>{p.name} ({p.unit})</option>)}</select></label><label>{t("Quantity")}<Input type="number" min="0.0001" step="0.0001" {...register(`items.${index}.quantity`)} /></label><label>{t("Unit cost")}<Input type="number" min="0" step="0.0001" {...register(`items.${index}.unitCost`)} /></label><Button type="button" variant="ghost" size="icon" aria-label={t("Remove product")} onClick={() => remove(index)} disabled={fields.length === 1}><Trash2 size={15} /></Button></div>)}
 {errors.items && <p className="field-error">{t("Choose distinct products, positive quantities, and non-negative unit costs.")}</p>}
 <Button type="button" variant="outline" onClick={() => append({
          productId: "",
          quantity: 1,
          unitCost: 0
        })} disabled={fields.length >= 100}><Plus size={15} />{t("Add another product")}</Button>
 <label>{t("Notes (optional)")}<Input {...register("notes")} /></label><div className="purchase-summary"><span>{t("Order total")}<strong>{formatMoney(total, currency)}</strong></span><span>{t("Cost update policy")}<strong>{t("Latest received unit cost")}</strong></span></div>
 {unavailable && <p className="field-error">{t("Could not load order choices. Close and try again.")}</p>}{error && <p role="alert" className="field-error">{error}</p>}
 <Button type="submit" disabled={isSubmitting || unavailable || products.isLoading || suppliers.isLoading || warehouses.isLoading}>{t(isSubmitting ? "Saving..." : "Save draft")}</Button></form></DialogContent></Dialog>;
}
const receiveSchema = z.object({
  items: z.array(z.object({
    orderItemId: z.string(),
    quantity: z.coerce.number().min(0).max(1e9)
  })).min(1)
}).refine(v => v.items.some(i => i.quantity > 0), {
  path: ["items"],
  message: "Enter a quantity to receive"
});
export function ReceivePurchaseForm({
  businessId,
  order,
  onClose,
  onSaved
}: {
  businessId: string;
  order: purchase.PurchaseOrder;
  onClose: () => void;
  onSaved: (o: purchase.PurchaseOrder) => void;
}) {
  const {
    t
  } = useTranslation();
  const refresh = usePurchaseRefresh(businessId);
  const [error, setError] = useState("");
  // Keep the same receipt reference on a network retry. A changed payload gets
  // a new reference; the server also rejects stale versions and over-receipts.
  const [attempt, setAttempt] = useState<{
    payload: string;
    id: string;
  } | null>(null);
  const remaining = order.items.filter(i => i.receivedQuantity < i.quantity);
  const {
    register,
    handleSubmit,
    formState: {
      isSubmitting,
      errors
    }
  } = useForm<z.input<typeof receiveSchema>, unknown, z.output<typeof receiveSchema>>({
    resolver: zodResolver(receiveSchema),
    defaultValues: {
      items: remaining.map(i => ({
        orderItemId: i.id,
        quantity: Number((i.quantity - i.receivedQuantity).toFixed(4))
      }))
    }
  });
  const mutation = useMutation({
    mutationFn: async (data: z.output<typeof receiveSchema>) => {
      const items = data.items.filter(i => i.quantity > 0);
      const payload = JSON.stringify(items);
      const id = attempt?.payload === payload ? attempt.id : generateRequestId();
      setAttempt({
        payload,
        id
      });
      return purchase.receivePurchase(businessId, order, id, items);
    },
    onSuccess: o => {
      refresh();
      onSaved(o);
      onClose();
      toast.success(t("Stock received"));
    },
    onError: e => setError(e instanceof Error ? e.message : t("Could not receive stock"))
  });
  return <Dialog open onOpenChange={open => {
    if (!open && !mutation.isPending) onClose();
  }}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>{t("Receive purchase")}</DialogTitle><DialogDescription>{t("Enter only what arrived today. Remaining quantities stay open for the next delivery.")}</DialogDescription></DialogHeader><form className="workspace-form" onSubmit={handleSubmit(v => mutation.mutate(v))}>{remaining.map((i, index) => <label key={i.id}>{i.productName} · {t("Remaining")}: {Number((i.quantity - i.receivedQuantity).toFixed(4))} {i.unit}<input type="hidden" {...register(`items.${index}.orderItemId`)} /><Input type="number" step="0.0001" min="0" max={Number((i.quantity - i.receivedQuantity).toFixed(4))} {...register(`items.${index}.quantity`)} /></label>)}{errors.items && <p className="field-error">{t("Enter a quantity to receive")}</p>}<p className="text-xs text-muted-foreground">{t("Receiving adds stock to the selected warehouse and updates product costs to this order's unit costs.")}</p>{error && <p role="alert" className="field-error">{error}</p>}<Button type="submit" disabled={isSubmitting || mutation.isPending}>{t(mutation.isPending ? "Receiving..." : "Confirm receipt")}</Button></form></DialogContent></Dialog>;
}
