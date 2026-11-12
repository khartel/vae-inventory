const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../utils/prisma");
const AppError = require("../utils/AppError");
const { recordAudit } = require("../utils/auditLog");

const PASSWORD_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/**
 * Generates a random temporary password (avoids ambiguous characters like 0/O, 1/l/I).
 */
const generateTempPassword = (length = 10) => {
  let password = "";
  for (let i = 0; i < length; i++) {
    password += PASSWORD_CHARSET[crypto.randomInt(PASSWORD_CHARSET.length)];
  }
  return password;
};

/**
 * Add a new team member (Admin or Employee) to a business. Handles two
 * distinct cases:
 *  1. The username already belongs to an existing user account — that
 *     user is simply linked to this business via a new `BusinessUser` row
 *     (as long as they aren't already a member), letting one person work
 *     across multiple businesses under one login.
 *  2. The username is new — a brand-new User is created with a
 *     deterministic default password (`Biz@<username><last-4-of-phone>`)
 *     and `mustChangePassword: true`, then linked to the business. User
 *     creation and the business link happen together in one
 *     `$transaction` so a failure can't leave an orphaned user with no
 *     business access (or vice versa).
 * Only ADMIN/EMPLOYEE roles are allowed through this path — SUPERADMIN is
 * reserved for the business owner and is never assigned here.
 *
 * @param {object} params
 * @param {string} params.businessId
 * @param {string} params.fullName
 * @param {string} params.username
 * @param {string} params.phone
 * @param {string} [params.email]
 * @param {"ADMIN"|"EMPLOYEE"} params.role
 * @param {string} params.addedById - Currently unused for auditing but kept for future use.
 * @returns {Promise<object>} The BusinessUser link with nested user info;
 *   includes `defaultPassword` only when a brand-new user was created.
 * @throws {AppError} 409 if the username/email is taken or already a member.
 */
const addTeamMember = async ({ businessId, fullName, username, phone, email, role, addedById }) => {
  // Only ADMIN and EMPLOYEE roles can be added this way
  if (!["ADMIN", "EMPLOYEE"].includes(role)) {
    throw new AppError("Invalid role. Can only add ADMIN or EMPLOYEE");
  }

  // Clean email — convert empty string to null
  const cleanEmail = email && email.trim() !== "" ? email.trim() : null;

  const adder = await prisma.user.findUnique({ where: { id: addedById } });

  // Check if username already exists
  const existingUsername = await prisma.user.findUnique({
    where: { username },
  });

  if (existingUsername) {
    // If user exists, check if they are already in this business
    const alreadyInBusiness = await prisma.businessUser.findFirst({
      where: {
        businessId,
        userId: existingUsername.id,
      },
    });

    if (alreadyInBusiness) {
      throw new AppError("This user is already a member of this business", 409);
    }

    // Add existing user to this business
    const businessUser = await prisma.$transaction(async (tx) => {
      const created = await tx.businessUser.create({
        data: {
          businessId,
          userId: existingUsername.id,
          role,
        },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              username: true,
              phone: true,
              email: true,
              role: true,
            },
          },
        },
      });

      await recordAudit(tx, {
        businessId,
        actorId: addedById,
        actorName: adder?.fullName ?? null,
        action: "team.member_added",
        entityType: "BusinessUser",
        entityId: created.id,
        metadata: { username, role },
      });

      return created;
    });

    return businessUser;
  }

  // Check if email is already taken (only if email provided)
  if (cleanEmail) {
    const existingEmail = await prisma.user.findUnique({
      where: { email: cleanEmail },
    });

    if (existingEmail) {
      throw new AppError("A user with this email already exists", 409);
    }
  }

  // Create new user with a more secure default password pattern
  // In a production app, you should trigger a password reset email here
  const defaultPassword = `Biz@${username}${phone.slice(-4)}`;
  const passwordHash = await bcrypt.hash(defaultPassword, 12);

  // Create user and add to business in one transaction
  const result = await prisma.$transaction(async (tx) => {
    // Create the user
    const newUser = await tx.user.create({
      data: {
        fullName,
        username,
        phone,
        email: cleanEmail,  // null if not provided
        passwordHash,
        role,
        mustChangePassword: true,
      },
    });

    // Link user to business
    const businessUser = await tx.businessUser.create({
      data: {
        businessId,
        userId: newUser.id,
        role,
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            username: true,
            phone: true,
            email: true,
            role: true,
          },
        },
      },
    });

    await recordAudit(tx, {
      businessId,
      actorId: addedById,
      actorName: adder?.fullName ?? null,
      action: "team.member_added",
      entityType: "BusinessUser",
      entityId: businessUser.id,
      metadata: { username, role },
    });

    return businessUser;
  });

  return {
    ...result,
    defaultPassword,
  };
};

/**
 * List all team members (BusinessUser links) of a business, ordered by
 * when they joined.
 *
 * @param {string} businessId
 * @returns {Promise<object[]>}
 */
const getTeamMembers = async (businessId) => {
  const members = await prisma.businessUser.findMany({
    where: { businessId },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          username: true,
          phone: true,
          email: true,
          role: true,
          createdAt: true,
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  return members;
};

/**
 * Remove a team member from a business by deleting their `BusinessUser`
 * link (the underlying User account itself is untouched, so they keep
 * access to any other businesses they belong to). Enforces two invariants:
 * a user can never remove themselves this way (must use another admin), and
 * the business owner (role SUPERADMIN within this business) can never be
 * removed via the Team page at all.
 *
 * @param {string} businessUserId - The BusinessUser link to remove.
 * @param {string} businessId - Scopes the lookup to this business.
 * @param {string} requesterId - ID of the user performing the removal.
 * @returns {Promise<{message: string}>}
 * @throws {AppError} 404 if not found; error if removing self or the owner.
 */
const removeTeamMember = async (businessUserId, businessId, requesterId) => {
  const businessUser = await prisma.businessUser.findFirst({
    where: {
      id: businessUserId,
      businessId,
    },
    include: {
      user: true,
    },
  });

  if (!businessUser) {
    throw new AppError("Team member not found", 404);
  }

  // Cannot remove yourself
  if (businessUser.userId === requesterId) {
    throw new AppError("You cannot remove yourself from the business");
  }

  // Cannot remove a SUPERADMIN
  if (businessUser.role === "SUPERADMIN") {
    throw new AppError("Cannot remove the business owner", 403);
  }

  const remover = await prisma.user.findUnique({ where: { id: requesterId } });

  await prisma.$transaction(async (tx) => {
    await tx.businessUser.delete({
      where: { id: businessUserId },
    });

    await recordAudit(tx, {
      businessId,
      actorId: requesterId,
      actorName: remover?.fullName ?? null,
      action: "team.member_removed",
      entityType: "BusinessUser",
      entityId: businessUserId,
      metadata: { username: businessUser.user.username },
    });
  });

  return { message: "Team member removed successfully" };
};

/**
 * Change a team member's role within a business, restricted to ADMIN or
 * EMPLOYEE. The business owner's BusinessUser role (SUPERADMIN) can never
 * be changed this way — ownership/role hierarchy is fixed at creation.
 *
 * @param {string} businessUserId
 * @param {string} businessId - Scopes the lookup to this business.
 * @param {"ADMIN"|"EMPLOYEE"} role - New role to assign.
 * @param {string} requesterId - ID of the user performing the change.
 * @returns {Promise<object>} The updated BusinessUser with nested user info.
 * @throws {AppError} 404 if not found; 403 if targeting the owner.
 */
const updateTeamMemberRole = async (businessUserId, businessId, role, requesterId) => {
  if (!["ADMIN", "EMPLOYEE"].includes(role)) {
    throw new AppError("Invalid role. Can only set ADMIN or EMPLOYEE");
  }

  const businessUser = await prisma.businessUser.findFirst({
    where: {
      id: businessUserId,
      businessId,
    },
    include: { user: { select: { username: true } } },
  });

  if (!businessUser) {
    throw new AppError("Team member not found", 404);
  }

  if (businessUser.role === "SUPERADMIN") {
    throw new AppError("Cannot change the role of the business owner", 403);
  }

  const changer = await prisma.user.findUnique({ where: { id: requesterId } });

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.businessUser.update({
      where: { id: businessUserId },
      data: { role },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            username: true,
            phone: true,
            email: true,
            role: true,
          },
        },
      },
    });

    await recordAudit(tx, {
      businessId,
      actorId: requesterId,
      actorName: changer?.fullName ?? null,
      action: "team.role_changed",
      entityType: "BusinessUser",
      entityId: businessUserId,
      metadata: { username: businessUser.user.username, fromRole: businessUser.role, toRole: role },
    });

    return result;
  });

  return updated;
};

/**
 * Reset a team member's password to a new random temporary one.
 * Requester cannot reset their own password this way, and the business
 * owner's password can never be reset through the Team page.
 */
const resetTeamMemberPassword = async (businessUserId, businessId, requesterId) => {
  const businessUser = await prisma.businessUser.findFirst({
    where: {
      id: businessUserId,
      businessId,
    },
    include: {
      user: true,
    },
  });

  if (!businessUser) {
    throw new AppError("Team member not found", 404);
  }

  if (businessUser.userId === requesterId) {
    throw new AppError("Use Settings to change your own password");
  }

  if (businessUser.role === "SUPERADMIN") {
    throw new AppError("Cannot reset the business owner's password", 403);
  }

  const newPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(newPassword, 12);

  await prisma.user.update({
    where: { id: businessUser.userId },
    data: {
      passwordHash,
      mustChangePassword: true,
    },
  });

  return {
    username: businessUser.user.username,
    newPassword,
  };
};

module.exports = {
  addTeamMember,
  getTeamMembers,
  removeTeamMember,
  updateTeamMemberRole,
  resetTeamMemberPassword,
};