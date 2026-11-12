// Wrappers around the /businesses/:businessId/transactions endpoints — the
// POS sales record: creating sales, listing/filtering history, and
// recording installment payments against CREDIT sales.
import { apiClient, apiRequest } from "@/lib/api-client"

// CASH/TRANSFER settle immediately in full; CREDIT is sold now and paid
// later (possibly in installments via `recordPayment`).
export type PaymentMethod = "CASH" | "TRANSFER" | "CREDIT"

// One line item (product + quantity + price) within a transaction.
// `unitLabel`/`unitQuantity` are display-only: set when the sale was rung
// up in a pack size other than the product's base unit (e.g. "2 dozen") -
// `quantitySold`/`unitPrice` are always in base-unit terms regardless.
export interface TransactionItem {
  id: string
  quantitySold: number
  unitPrice: number
  subtotal: number
  discountPercent: number | null
  unitLabel: string | null
  unitQuantity: number | null
  product: { id: string; name: string; unit: string }
}

// A single installment payment recorded against a CREDIT transaction.
export interface CreditPayment {
  id: string
  amount: number
  createdAt: string
  recordedBy: { id: string; fullName: string; username: string }
}

// CASH covers both cash and transfer refunds handed back to the customer.
// CREDIT_BALANCE reduces what's still owed on an outstanding CREDIT sale
// instead (only ever offered when there's a positive balance left to reduce).
export type RefundMethod = "CASH" | "CREDIT_BALANCE"

// One line within a Return: how much of a given TransactionItem came back.
export interface ReturnItem {
  id: string
  transactionItemId: string
  quantityReturned: number
  refundAmount: number
}

// A return recorded against a transaction — some or all of its items
// reversed, stock restocked, and the customer made whole one of two ways.
export interface ReturnRecord {
  id: string
  refundMethod: RefundMethod
  refundAmount: number
  reason: string | null
  createdAt: string
  processedBy: { id: string; fullName: string; username: string }
  items: ReturnItem[]
}

// A completed sale. `amountPaid`/`balanceDue` track partial payments for
// CREDIT sales (both equal `totalAmount`/0 for CASH/TRANSFER); `paidAt` is
// set once `balanceDue` reaches zero. `amountTendered`/`changeGiven` are
// only ever non-null for a CASH sale where the cashier chose to record what
// the customer physically handed over — null otherwise.
export interface Transaction {
  id: string
  businessId: string
  warehouseId: string
  customerId: string | null
  paymentMethod: PaymentMethod
  totalAmount: number
  customerName: string
  notes: string | null
  paidAt: string | null
  createdAt: string
  items: TransactionItem[]
  payments: CreditPayment[]
  returns: ReturnRecord[]
  amountPaid: number
  balanceDue: number
  amountTendered: number | null
  changeGiven: number | null
  performedBy: { id: string; fullName: string; username: string; role: string }
  warehouse: { id: string; name: string; isPrimary: boolean }
}

// Payload for ringing up a new sale (POS checkout). Sold against the
// current user's active warehouse/business context on the backend.
export interface CreateTransactionInput {
  paymentMethod: PaymentMethod
  // Required for CREDIT (must reference an existing customer); ignored for
  // CASH/TRANSFER, which use free-text customerName instead.
  customerId?: string
  customerName?: string
  notes?: string
  // Only meaningful for CASH; ignored by the backend for TRANSFER/CREDIT.
  amountTendered?: number
  items: Array<{
    productId: string
    quantitySold: number
    unitPrice: number
    discountPercent?: number
    unitLabel?: string
    unitQuantity?: number
  }>
}

// Payload for reversing some or all of a sale's items (see ReturnRecord).
export interface CreateReturnInput {
  items: Array<{ transactionItemId: string; quantityReturned: number }>
  refundMethod: RefundMethod
  reason?: string
}

// Optional filters/pagination for listing transaction history.
export interface ListTransactionsParams {
  performedById?: string
  paymentMethod?: PaymentMethod
  paid?: boolean
  startDate?: string
  endDate?: string
  page?: number
  limit?: number
}

// A page of transaction results with pagination metadata.
export interface PaginatedTransactions {
  transactions: Transaction[]
  pagination: { total: number; page: number; limit: number; totalPages: number }
}

/** Lists transactions for a business, paginated and optionally filtered. */
export const getTransactions = (businessId: string, params: ListTransactionsParams = {}) =>
  apiRequest<PaginatedTransactions>(
    apiClient.get(`/businesses/${businessId}/transactions`, { params })
  )

/** Fetches a single transaction with its full item and payment history. */
export const getTransactionById = (businessId: string, transactionId: string) =>
  apiRequest<Transaction>(apiClient.get(`/businesses/${businessId}/transactions/${transactionId}`))

/** Records a new sale (POS checkout), deducting stock and creating the transaction. */
export const createTransaction = (businessId: string, input: CreateTransactionInput) =>
  apiRequest<Transaction>(apiClient.post(`/businesses/${businessId}/transactions`, input))

/** Records an installment payment against an outstanding CREDIT transaction. */
export const recordPayment = (businessId: string, transactionId: string, amount: number) =>
  apiRequest<Transaction>(
    apiClient.post(`/businesses/${businessId}/transactions/${transactionId}/payments`, { amount })
  )

/** Undoes a previously-recorded credit payment (a correction, not a customer refund). */
export const undoPayment = (businessId: string, transactionId: string, paymentId: string) =>
  apiRequest<Transaction>(
    apiClient.delete(`/businesses/${businessId}/transactions/${transactionId}/payments/${paymentId}`)
  )

/** Reverses some or all of a sale's items — restocks quantity and records how the customer was made whole. */
export const createReturn = (businessId: string, transactionId: string, input: CreateReturnInput) =>
  apiRequest<Transaction>(
    apiClient.post(`/businesses/${businessId}/transactions/${transactionId}/returns`, input)
  )
