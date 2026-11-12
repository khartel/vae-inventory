const express = require("express");
const router = express.Router({ mergeParams: true });
const {
  create,
  getAll,
  getOne,
  update,
  remove,
  getDeleted,
  restore,
} = require("../controllers/product.controller");
const { authenticate } = require("../middleware/auth.middleware");
const { authorize, belongsToBusiness } = require("../middleware/role.middleware");
const { validate } = require("../middleware/validate.middleware");
const {
  productIdParamSchema,
  createProductSchema,
  updateProductSchema,
} = require("../validators/product.validators");

// Mounted under /api/businesses/:businessId/products. Every route requires
// a valid session and membership of the business (`belongsToBusiness`).
// Stock-specific endpoints (receive/move/movements) live in stock.routes.js
// but are handled by this same product.controller.js.
router.use(authenticate);
router.use(belongsToBusiness);

// ─────────────────────────────────────────
// PRODUCT ROUTES
// ─────────────────────────────────────────

// All roles can view products
router.get("/", authorize("SUPERADMIN", "ADMIN", "EMPLOYEE"), getAll);

// Registered before "/:productId" so "deleted" isn't swallowed as an id.
// Trash view is a management concern, same roles as delete/restore below.
router.get("/deleted", authorize("SUPERADMIN", "ADMIN"), getDeleted);

router.get(
  "/:productId",
  authorize("SUPERADMIN", "ADMIN", "EMPLOYEE"),
  validate(productIdParamSchema),
  getOne
);

// Only SuperAdmin and Admin can manage products
router.post("/", authorize("SUPERADMIN", "ADMIN"), validate(createProductSchema), create);
router.patch(
  "/:productId",
  authorize("SUPERADMIN", "ADMIN"),
  validate(updateProductSchema),
  update
);
router.delete(
  "/:productId",
  authorize("SUPERADMIN", "ADMIN"),
  validate(productIdParamSchema),
  remove
);
router.post(
  "/:productId/restore",
  authorize("SUPERADMIN", "ADMIN"),
  validate(productIdParamSchema),
  restore
);

module.exports = router;