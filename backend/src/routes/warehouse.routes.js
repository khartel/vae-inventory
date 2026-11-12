const express = require("express");
const router = express.Router({ mergeParams: true });
const {
  create,
  getAll,
  getOne,
  setPrimary,
  update,
  remove,
  getDeleted,
  restore,
} = require("../controllers/warehouse.controller");
const { authenticate } = require("../middleware/auth.middleware");
const { authorize, belongsToBusiness } = require("../middleware/role.middleware");
const { validate } = require("../middleware/validate.middleware");
const {
  createWarehouseSchema,
  warehouseIdParamSchema,
  updateWarehouseSchema,
} = require("../validators/warehouse.validators");

// Mounted under /api/businesses/:businessId/warehouses. Every route
// requires a valid session and business membership.
router.use(authenticate);
router.use(belongsToBusiness);

// All roles can view warehouses
router.get("/", authorize("SUPERADMIN", "ADMIN", "EMPLOYEE"), getAll);

// Registered before "/:warehouseId" so "deleted" isn't swallowed as an id.
router.get("/deleted", authorize("SUPERADMIN", "ADMIN"), getDeleted);

router.get(
  "/:warehouseId",
  authorize("SUPERADMIN", "ADMIN", "EMPLOYEE"),
  validate(warehouseIdParamSchema),
  getOne
);

// Only SuperAdmin and Admin can manage warehouses
router.post("/", authorize("SUPERADMIN", "ADMIN"), validate(createWarehouseSchema), create);
router.patch(
  "/:warehouseId",
  authorize("SUPERADMIN", "ADMIN"),
  validate(updateWarehouseSchema),
  update
);
router.patch(
  "/:warehouseId/primary",
  authorize("SUPERADMIN", "ADMIN"),
  validate(warehouseIdParamSchema),
  setPrimary
);
router.delete(
  "/:warehouseId",
  authorize("SUPERADMIN", "ADMIN"),
  validate(warehouseIdParamSchema),
  remove
);
router.post(
  "/:warehouseId/restore",
  authorize("SUPERADMIN", "ADMIN"),
  validate(warehouseIdParamSchema),
  restore
);

module.exports = router;