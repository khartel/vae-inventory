const express = require("express");
const router = express.Router({ mergeParams: true });
const {
  create,
  getAll,
  getSummary,
  getOne,
  recordPayment,
  undoPayment,
  createReturnController,
} = require("../controllers/transaction.controller");
const { authenticate } = require("../middleware/auth.middleware");
const { authorize, belongsToBusiness } = require("../middleware/role.middleware");
const { validate } = require("../middleware/validate.middleware");
const {
  transactionIdParamSchema,
  createTransactionSchema,
  listTransactionsQuerySchema,
  recordPaymentSchema,
  undoPaymentSchema,
  createReturnSchema,
} = require("../validators/transaction.validators");

// Mounted under /api/businesses/:businessId/transactions. Every route
// requires a valid session and business membership.
router.use(authenticate);
router.use(belongsToBusiness);

// All roles can make and view transactions
router.post(
  "/",
  authorize("SUPERADMIN", "ADMIN", "EMPLOYEE"),
  validate(createTransactionSchema),
  create
);

router.get(
  "/",
  authorize("SUPERADMIN", "ADMIN", "EMPLOYEE"),
  validate(listTransactionsQuerySchema),
  getAll
);

// Summary only for SuperAdmin and Admin
router.get(
  "/summary",
  authorize("SUPERADMIN", "ADMIN"),
  getSummary
);

router.get(
  "/:transactionId",
  authorize("SUPERADMIN", "ADMIN", "EMPLOYEE"),
  validate(transactionIdParamSchema),
  getOne
);

// Recording a credit payment is an operational action, same roles as making a sale
router.post(
  "/:transactionId/payments",
  authorize("SUPERADMIN", "ADMIN", "EMPLOYEE"),
  validate(recordPaymentSchema),
  recordPayment
);

// Undoing a payment is a correction, not routine operation - same roles as
// deleting a product/customer/warehouse.
router.delete(
  "/:transactionId/payments/:paymentId",
  authorize("SUPERADMIN", "ADMIN"),
  validate(undoPaymentSchema),
  undoPayment
);

// Processing a return is a correction, not a routine operation - same roles
// as undoing a payment/receiving stock/moving stock.
router.post(
  "/:transactionId/returns",
  authorize("SUPERADMIN", "ADMIN"),
  validate(createReturnSchema),
  createReturnController
);

module.exports = router;