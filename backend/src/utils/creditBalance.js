/**
 * Shared credit-balance calculation used by both `transaction.service.js`
 * and `customer.service.js` so that CREDIT sales, payment recording, and
 * customer credit summaries always agree — especially when a CREDIT sale
 * has been partially or fully reduced by a `CREDIT_BALANCE` return.
 *
 * `CREDIT_BALANCE` returns are deliberately kept separate from `payments`
 * (which only record money the customer actually paid in) so `amountPaid`
 * and `balanceDue` remain distinct and accurate.
 */

/**
 * Computes `amountPaid`, `creditReductionFromReturns`, and `balanceDue`
 * (each rounded to 2 decimal places to avoid floating-point cent drift).
 *
 * Callers MUST load `payments` and `returns` on `transaction` before calling.
 *
 * @param {{ totalAmount: number, payments?: Array<{ amount: number }>, returns?: Array<{ refundMethod: string, refundAmount: number }> }} transaction
 * @returns {{ amountPaid: number, creditReductionFromReturns: number, balanceDue: number }}
 */
const computeCreditStats = (transaction) => {
  const amountPaid =
    Math.round((transaction.payments || []).reduce((sum, p) => sum + p.amount, 0) * 100) / 100;
  const creditReductionFromReturns =
    Math.round(
      (transaction.returns || [])
        .filter((r) => r.refundMethod === "CREDIT_BALANCE")
        .reduce((sum, r) => sum + r.refundAmount, 0) * 100
    ) / 100;
  const balanceDue =
    Math.round((transaction.totalAmount - amountPaid - creditReductionFromReturns) * 100) / 100;

  return { amountPaid, creditReductionFromReturns, balanceDue };
};

/**
 * Attaches computed `amountPaid` and `balanceDue` to a transaction object.
 *
 * @template T
 * @param {T} transaction
 * @returns {T & { amountPaid: number, balanceDue: number }}
 */
const withCreditStats = (transaction) => {
  const { amountPaid, balanceDue } = computeCreditStats(transaction);
  return { ...transaction, amountPaid, balanceDue };
};

module.exports = { computeCreditStats, withCreditStats };
