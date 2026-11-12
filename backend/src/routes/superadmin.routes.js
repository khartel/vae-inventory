const express = require("express");
const router = express.Router();
const {
  getAllSuperAdmins,
  deleteSuperAdmin,
  resetPassword,
  getActivity,
} = require("../controllers/superadmin.controller");
const { validateMasterKey } = require("../middleware/masterkey.middleware");
const { validate } = require("../middleware/validate.middleware");
const { userIdParamSchema } = require("../validators/superadmin.validators");

/**
 * Platform-admin router — internal/support tooling for managing SuperAdmin
 * accounts directly, bypassing normal user auth entirely. There is no
 * `authenticate` here: access is gated solely by the `x-master-key` header
 * matching process.env.MASTER_KEY (see validateMasterKey), so this is meant
 * to be called by developers/support, not the regular frontend.
 */

// All routes protected by master key
router.use(validateMasterKey);

router.get("/superadmins", getAllSuperAdmins);

// Deletes the SuperAdmin AND cascades (via Prisma schema relations) to
// everything they own: businesses, products, transactions, team members, etc.
router.delete("/superadmins/:userId", validate(userIdParamSchema), deleteSuperAdmin);
router.post(
  "/superadmins/:userId/reset-password",
  validate(userIdParamSchema),
  resetPassword
);

router.get("/activity", getActivity);

module.exports = router;