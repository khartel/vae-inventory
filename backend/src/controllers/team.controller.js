const {
  addTeamMember,
  getTeamMembers,
  removeTeamMember,
  updateTeamMemberRole,
  resetTeamMemberPassword,
} = require("../services/team.service");
const { sendSuccess } = require("../utils/response.utils");
const asyncHandler = require("../utils/asyncHandler");

/**
 * POST /api/businesses/:businessId/team
 * Adds an ADMIN or EMPLOYEE to the business — either by linking an existing
 * user account (if the username already exists) or creating a brand new
 * user with an auto-generated default password (mustChangePassword is set
 * so they're forced to change it on first login). The response message
 * includes that default password so the caller (an Admin/SuperAdmin) can
 * hand it to the new team member.
 */
const add = asyncHandler(async (req, res) => {
  const { fullName, username, phone, email, role } = req.body;
  const { businessId } = req.params;

  const member = await addTeamMember({
    businessId,
    fullName,
    username,
    phone,
    email,
    role,
    addedById: req.user.id,
  });

  return sendSuccess(res, {
    message: `${role} added successfully. Default password is: ${member.defaultPassword || username + "123"}`,
    data: member,
    statusCode: 201,
  });
});

/**
 * GET /api/businesses/:businessId/team
 * Lists everyone who belongs to the business (their BusinessUser membership
 * plus basic user info), regardless of role.
 */
const getAll = asyncHandler(async (req, res) => {
  const members = await getTeamMembers(req.params.businessId);

  return sendSuccess(res, {
    message: "Team members fetched successfully",
    data: members,
  });
});

/**
 * DELETE /api/businesses/:businessId/team/:businessUserId
 * Removes a team member's membership in the business (:businessUserId is
 * the BusinessUser link id, not the user id). A caller can't remove
 * themselves, and the business owner (SUPERADMIN) can never be removed.
 */
const remove = asyncHandler(async (req, res) => {
  const result = await removeTeamMember(
    req.params.businessUserId,
    req.params.businessId,
    req.user.id
  );

  return sendSuccess(res, {
    message: result.message,
  });
});

/**
 * PATCH /api/businesses/:businessId/team/:businessUserId
 * Changes a team member's role between ADMIN and EMPLOYEE. The business
 * owner's (SUPERADMIN's) role can never be changed this way.
 */
const updateRole = asyncHandler(async (req, res) => {
  const { role } = req.body;

  const member = await updateTeamMemberRole(
    req.params.businessUserId,
    req.params.businessId,
    role,
    req.user.id
  );

  return sendSuccess(res, {
    message: "Team member role updated successfully",
    data: member,
  });
});

/**
 * POST /api/businesses/:businessId/team/:businessUserId/reset-password
 * Generates a new random temporary password for a team member and forces a
 * password change on their next login. Returns the new password so an
 * Admin/SuperAdmin can share it with them. A caller cannot reset their own
 * password this way (use Settings instead), and the business owner's
 * password can never be reset here.
 */
const resetPassword = asyncHandler(async (req, res) => {
  const result = await resetTeamMemberPassword(
    req.params.businessUserId,
    req.params.businessId,
    req.user.id
  );

  return sendSuccess(res, {
    message: "Password reset successfully",
    data: result,
  });
});

module.exports = { add, getAll, remove, updateRole, resetPassword };
