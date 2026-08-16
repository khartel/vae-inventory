// Wrappers around the /businesses/:businessId/products endpoints — the
// product catalog. Stock levels are per-warehouse; see stock.service.ts for
// stock adjustment/transfer operations.
import { apiClient, apiRequest } from "@/lib/api-client"

// A product's stock level in one specific warehouse, plus the threshold at
// which it should be flagged as "low stock".
export interface ProductStockEntry {
  id: string
  quantity: number
  lowStockThreshold: number
  warehouse: { id: string; name: string; isPrimary: boolean; location?: string | null }
}

// An alternate pack size for a product (e.g. "dozen" = 12 base units).
// Price for one of these is always product.price * factor - there's no
// separate price to store per unit.
export interface ProductUnit {
  id: string
  label: string
  factor: number
}

// A catalog product. `stock` lists per-warehouse quantities; `totalQuantity`
// is the sum across all warehouses and `primaryStock` is the stock entry for
// the business's primary warehouse (both computed server-side for
// convenience). `units` lists any alternate pack sizes beyond the base
// `unit` (e.g. selling the same product individually or "by the dozen").
export interface Product {
  id: string
  businessId: string
  name: string
  unit: string
  price: number
  // Absent entirely (not null) when the caller is an Employee - the backend
  // strips it rather than sending null, so cost/margin data never appears
  // in the network response for a role that shouldn't see it. SuperAdmin/
  // Admin get either a number or null (no cost price recorded yet).
  costPrice?: number | null
  description: string | null
  shortCode: string | null
  createdAt: string
  updatedAt: string
  stock: ProductStockEntry[]
  totalQuantity: number
  primaryStock: ProductStockEntry | null
  units: ProductUnit[]
}

// Fields required to add a new product. `shortCode` is an optional
// quick-search/scan code used in POS lookups. `units`, when provided,
// wholesale-replaces the product's alternate pack sizes on update.
export interface CreateProductInput {
  name: string
  unit: string
  price?: number
  costPrice?: number
  description?: string
  shortCode?: string
  units?: Array<{ label: string; factor: number }>
}

// Partial product fields for edits.
export type UpdateProductInput = Partial<CreateProductInput>

/** Lists every product in a business's catalog, with stock info included. */
export const getProducts = (businessId: string) =>
  apiRequest<Product[]>(apiClient.get(`/businesses/${businessId}/products`))

/** Fetches one product by id. */
export const getProductById = (businessId: string, productId: string) =>
  apiRequest<Product>(apiClient.get(`/businesses/${businessId}/products/${productId}`))

/** Creates a new product in the catalog. */
export const createProduct = (businessId: string, input: CreateProductInput) =>
  apiRequest<Product>(apiClient.post(`/businesses/${businessId}/products`, input))

/** Updates a product's editable fields. */
export const updateProduct = (businessId: string, productId: string, input: UpdateProductInput) =>
  apiRequest<Product>(apiClient.patch(`/businesses/${businessId}/products/${productId}`, input))

/** Deletes a product from the catalog. */
export const deleteProduct = (businessId: string, productId: string) =>
  apiRequest<null>(apiClient.delete(`/businesses/${businessId}/products/${productId}`))

// A soft-deleted product as returned by the Trash endpoint — scalar fields
// only, no stock/units relations (those aren't loaded for a hidden product).
export interface DeletedProduct {
  id: string
  name: string
  unit: string
  price: number
  deletedAt: string
}

/** Lists soft-deleted products for a business (the Trash view). */
export const getDeletedProducts = (businessId: string) =>
  apiRequest<DeletedProduct[]>(apiClient.get(`/businesses/${businessId}/products/deleted`))

/** Restores a soft-deleted product back into the active catalog. */
export const restoreProduct = (businessId: string, productId: string) =>
  apiRequest<null>(apiClient.post(`/businesses/${businessId}/products/${productId}/restore`))
