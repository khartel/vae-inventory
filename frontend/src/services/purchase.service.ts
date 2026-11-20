import { apiClient, apiRequest } from "@/lib/api-client";
export type PurchaseStatus = "DRAFT" | "ORDERED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";
export interface Supplier {
  id: string;
  name: string;
  phone: string;
  address: string;
  email: string | null;
  archivedAt: string | null;
  _count?: {
    orders: number;
  };
}
export interface SupplierInput {
  name: string;
  phone: string;
  address: string;
  email?: string;
}
export interface PurchaseItem {
  id: string;
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  receivedQuantity: number;
  unitCost: number;
}
export interface PurchaseOrder {
  id: string;
  supplierId: string;
  supplierName: string;
  supplier: Supplier;
  warehouseId: string;
  warehouse: {
    id: string;
    name: string;
  };
  status: PurchaseStatus;
  version: number;
  notes: string | null;
  expectedAt: string | null;
  orderedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  totalAmount: number;
  receivedAmount: number;
  leadTimeDays: number | null;
  items: PurchaseItem[];
  receipts: Array<{
    id: string;
    createdAt: string;
    actorName: string;
    items: Array<{
      orderItemId: string;
      quantity: number;
    }>;
  }>;
}
export interface OrderInput {
  supplierId: string;
  warehouseId: string;
  notes?: string;
  expectedAt?: string | null;
  items: Array<{
    productId: string;
    quantity: number;
    unitCost: number;
  }>;
}
export interface PurchasePage<T> {
  rows: T[];
  total: number;
  page: number;
  totalPages: number;
}
const base = (b: string) => `/businesses/${b}/purchasing`;
export const getSuppliers = (b: string, params: {
  page?: number;
  limit?: number;
  search?: string;
  archived?: string;
} = {}) => apiRequest<PurchasePage<Supplier>>(apiClient.get(`${base(b)}/suppliers`, {
  params
}));
export const saveSupplier = (b: string, input: SupplierInput, id?: string) => apiRequest<Supplier>(id ? apiClient.patch(`${base(b)}/suppliers/${id}`, input) : apiClient.post(`${base(b)}/suppliers`, input));
export const archiveSupplier = (b: string, id: string, restore = false) => apiRequest<Supplier>(restore ? apiClient.post(`${base(b)}/suppliers/${id}/restore`) : apiClient.delete(`${base(b)}/suppliers/${id}`));
export const getPurchaseOrders = (b: string, params: {
  page?: number;
  limit?: number;
  search?: string;
  status?: PurchaseStatus;
} = {}) => apiRequest<PurchasePage<PurchaseOrder>>(apiClient.get(`${base(b)}/orders`, {
  params
}));
export const getPurchaseOrder = (b: string, id: string) => apiRequest<PurchaseOrder>(apiClient.get(`${base(b)}/orders/${id}`));
export const savePurchaseOrder = (b: string, input: OrderInput, id?: string, version?: number) => apiRequest<PurchaseOrder>(id ? apiClient.patch(`${base(b)}/orders/${id}`, {
  ...input,
  version
}) : apiClient.post(`${base(b)}/orders`, input));
export const transitionPurchase = (b: string, o: PurchaseOrder, action: "ORDER" | "CANCEL") => apiRequest<PurchaseOrder>(apiClient.post(`${base(b)}/orders/${o.id}/status`, {
  version: o.version,
  action
}));
export const receivePurchase = (b: string, o: PurchaseOrder, requestId: string, items: Array<{
  orderItemId: string;
  quantity: number;
}>) => apiRequest<PurchaseOrder>(apiClient.post(`${base(b)}/orders/${o.id}/receive`, {
  version: o.version,
  requestId,
  items
}));
