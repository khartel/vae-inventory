const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../utils/prisma");
const AppError = require("../utils/AppError");
const { recordAudit } = require("../utils/auditLog");

/**
 * Get all superadmins with their businesses
 */
const fetchAllSuperAdmins = async () => {
  const superAdmins = await prisma.user.findMany({
    where: { role: "SUPERADMIN" },
    select: {
      id: true,
      fullName: true,
      username: true,
      email: true,
      phone: true,
      createdAt: true,
      ownedBusinesses: {
        select: {
          id: true,
          name: true,
          country: true,
          currency: true,
          createdAt: true,
          _count: {
            select: {
              transactions: true,
              products: true,
              warehouses: true,
              businessUsers: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return superAdmins;
};

/**
 * Delete a superadmin and all their data
 */
const removeSuperAdmin = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      ownedBusinesses: {
        select: { id: true },
      },
    },
  });

  if (!user) {
    throw new AppError("User not found", 404);
  }

  if (user.role !== "SUPERADMIN") {
    throw new AppError("User is not a SuperAdmin", 400);
  }

  // Recorded before the delete (not tied to any one business, and there's
  // no authenticated actor here - this is a master-key-gated platform
  // action, not a normal session) so it survives on the Platform Admin
  // console's Activity tab even though the user row itself is about to go.
  await recordAudit(prisma, {
    action: "superadmin.removed",
    entityType: "User",
    entityId: userId,
    metadata: { username: user.username, fullName: user.fullName },
  });

  // Delete user - Prisma will handle the rest via cascading deletes defined in schema.prisma
  await prisma.user.delete({ where: { id: userId } });

  return true;
};

/**
 * Reset a superadmin's password directly (developer/support action, master-key gated).
 * Replaces the old approach of running a one-off script against the database.
 * Generates a random password and forces a change on next login.
 */
const resetSuperAdminPassword = async (userId) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw new AppError("User not found", 404);
  }

  if (user.role !== "SUPERADMIN") {
    throw new AppError("User is not a SuperAdmin", 400);
  }

  const newPassword = crypto.randomBytes(9).toString("base64url");
  const passwordHash = await bcrypt.hash(newPassword, 12);

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      mustChangePassword: true,
      tokenVersion: { increment: 1 },
    },
  });

  return { username: user.username, newPassword };
};

module.exports = { fetchAllSuperAdmins, removeSuperAdmin, resetSuperAdminPassword };
