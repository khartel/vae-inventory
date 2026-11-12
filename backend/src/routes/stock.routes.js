const express = require("express");
const router = express.Router({ mergeParams: true });
const {
  getStock,
  moveStockBetweenWarehouses,
  getMovements,
  receiveStockController,
  adjustStockController,
} = require("../controllers/product.controller");
const { authenticate } = require("../middleware/auth.middleware");
const { authorize, belongsToBusiness } = require("../middleware/role.middleware");
const { validate } = require("../middleware/validate.middleware");
const {
  moveStockSchema,
  receiveStockSchema,
  movementsQuerySchema,
  adjustStockSchema,
} = require("../validators/stock.validators");

// Mounted under /api/businesses/:businessId/stock. Handlers live in
// product.controller.js (stock is tracked per product/warehouse, not as
// its own resource). Every route requires a valid session and business
// membership.
router.use(authenticate);
router.use(belongsToBusiness);

// All roles can view stock
router.get("/", authorize("SUPERADMIN", "ADMIN", "EMPLOYEE"), getStock);
router.get(
  "/movements",
  authorize("SUPERADMIN", "ADMIN", "EMPLOYEE"),
  validate(movementsQuerySchema),
  getMovements
);

// Only SuperAdmin and Admin can move or receive stock
router.post(
  "/move",
  authorize("SUPERADMIN", "ADMIN"),
  validate(moveStockSchema),
  moveStockBetweenWarehouses
);
router.post(
  "/receive",
  authorize("SUPERADMIN", "ADMIN"),
  validate(receiveStockSchema),
  receiveStockController
);
router.post(
  "/adjust",
  authorize("SUPERADMIN", "ADMIN"),
  validate(adjustStockSchema),
  adjustStockController
);

module.exports = router;