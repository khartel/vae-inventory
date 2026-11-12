const express = require("express");
const router = express.Router({ mergeParams: true });
const {
  daily,
  weekly,
  monthly,
  employees,
  products,
  stockAlerts,
} = require("../controllers/report.controller");
const { authenticate } = require("../middleware/auth.middleware");
const { authorize, belongsToBusiness } = require("../middleware/role.middleware");
const { validate } = require("../middleware/validate.middleware");
const {
  dateQuerySchema,
  monthlyQuerySchema,
  dateRangeQuerySchema,
  businessIdParamSchema,
} = require("../validators/report.validators");

// Mounted under /api/businesses/:businessId/reports. Every route requires a
// valid session and business membership; reports are restricted to
// SuperAdmin/Admin since they expose sales and staff performance data that
// regular Employees shouldn't see.
router.use(authenticate);
router.use(belongsToBusiness);

// Only SuperAdmin and Admin can see reports
router.get("/daily", authorize("SUPERADMIN", "ADMIN"), validate(dateQuerySchema), daily);
router.get("/weekly", authorize("SUPERADMIN", "ADMIN"), validate(dateQuerySchema), weekly);
router.get("/monthly", authorize("SUPERADMIN", "ADMIN"), validate(monthlyQuerySchema), monthly);
router.get(
  "/employees",
  authorize("SUPERADMIN", "ADMIN"),
  validate(dateRangeQuerySchema),
  employees
);
router.get(
  "/products",
  authorize("SUPERADMIN", "ADMIN"),
  validate(dateRangeQuerySchema),
  products
);
router.get("/stock", authorize("SUPERADMIN", "ADMIN"), validate(businessIdParamSchema), stockAlerts);

module.exports = router;