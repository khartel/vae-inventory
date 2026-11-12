const express = require("express");
const router = express.Router({ mergeParams: true });
const {
  add,
  getAll,
  remove,
  updateRole,
  resetPassword,
} = require("../controllers/team.controller");
const { authenticate } = require("../middleware/auth.middleware");
const { authorize, belongsToBusiness } = require("../middleware/role.middleware");
const { validate } = require("../middleware/validate.middleware");
const {
  addTeamMemberSchema,
  businessUserIdParamSchema,
  updateRoleSchema,
} = require("../validators/team.validators");

// Mounted under /api/businesses/:businessId/team. Every route requires a
// valid session and business membership.
router.use(authenticate);
router.use(belongsToBusiness);

// All roles can view team
router.get("/", authorize("SUPERADMIN", "ADMIN", "EMPLOYEE"), getAll);

// Only SuperAdmin and Admin can manage team
router.post("/", authorize("SUPERADMIN", "ADMIN"), validate(addTeamMemberSchema), add);
router.patch(
  "/:businessUserId",
  authorize("SUPERADMIN", "ADMIN"),
  validate(updateRoleSchema),
  updateRole
);
router.delete(
  "/:businessUserId",
  authorize("SUPERADMIN", "ADMIN"),
  validate(businessUserIdParamSchema),
  remove
);
router.post(
  "/:businessUserId/reset-password",
  authorize("SUPERADMIN", "ADMIN"),
  validate(businessUserIdParamSchema),
  resetPassword
);

module.exports = router;