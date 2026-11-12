const express = require("express");
const router = express.Router();
const {
  create,
  getAll,
  getOne,
  update,
  remove,
  getCountries,
} = require("../controllers/business.controller");
const { authenticate } = require("../middleware/auth.middleware");
const { authorize } = require("../middleware/role.middleware");
const { validate } = require("../middleware/validate.middleware");
const {
  createBusinessSchema,
  updateBusinessSchema,
  businessIdParamSchema,
} = require("../validators/business.validators");

/**
 * Business router — creating/listing/updating/deleting businesses and the
 * countries lookup used on business-creation forms. Every route except
 * `/countries` requires a valid session (`authenticate`), and most are
 * SuperAdmin-only since businesses are owned by a single SuperAdmin.
 */

// Get all countries (public, needed for register/create business form)
router.get("/countries", getCountries);

// All routes below require authentication
router.use(authenticate);

// SuperAdmin only
router.post("/", authorize("SUPERADMIN"), validate(createBusinessSchema), create);
router.get("/", authorize("SUPERADMIN"), getAll);
router.patch("/:id", authorize("SUPERADMIN"), validate(updateBusinessSchema), update);
router.delete("/:id", authorize("SUPERADMIN"), validate(businessIdParamSchema), remove);

// SuperAdmin, Admin, Employee (must belong to business)
router.get("/:id", authorize("SUPERADMIN", "ADMIN", "EMPLOYEE"), validate(businessIdParamSchema), getOne);

module.exports = router;