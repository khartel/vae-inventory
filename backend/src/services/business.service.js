const prisma = require("../utils/prisma");
const { getCurrencyForCountry } = require("../utils/currencies");
const AppError = require("../utils/AppError");
const { recordAudit } = require("../utils/auditLog");

/**
 * Create a new business (SuperAdmin only). Also derives the business's
 * default currency from its country, and mirrors the owner into the
 * `BusinessUser` join table with a SUPERADMIN role so that later queries
 * (e.g. "what businesses can this user access") can treat owners and staff
 * uniformly via a single join, instead of special-casing ownership.
 *
 * @param {object} params
 * @param {string} params.name
 * @param {string} params.phone
 * @param {string} params.email
 * @param {string} params.country - Used to look up the default currency.
 * @param {string} params.location
 * @param {string} params.ownerId - ID of the SuperAdmin creating/owning it.
 * @returns {Promise<object>} The created business, including owner info,
 *   related counts, and the resolved `currencyDetails`.
 */
const createBusiness = async ({ name, phone, email, country, location, ownerId }) => {
  // Get currency based on country
  const currency = getCurrencyForCountry(country);

  // Create the business
  const business = await prisma.business.create({
    data: {
      name,
      phone,
      email,
      country,
      location,
      currency: currency.code,
      ownerId,
    },
    include: {
      owner: {
        select: {
          id: true,
          fullName: true,
          username: true,
          phone: true,
          email: true,
        },
      },
      _count: {
        select: {
          businessUsers: true,
          warehouses: true,
          products: true,
        },
      },
    },
  });

  // Also add the superadmin as a BusinessUser with SUPERADMIN role
  // This makes querying easier later
  await prisma.businessUser.create({
    data: {
      businessId: business.id,
      userId: ownerId,
      role: "SUPERADMIN",
    },
  });

  await recordAudit(prisma, {
    businessId: business.id,
    actorId: ownerId,
    actorName: business.owner?.fullName ?? null,
    action: "business.created",
    entityType: "Business",
    entityId: business.id,
    metadata: { name: business.name },
  });

  return {
    ...business,
    currencyDetails: currency,
  };
};

/**
 * List all businesses owned by a given SuperAdmin, with summary counts
 * (team size, warehouse/product/transaction counts) and each business's
 * primary warehouse, for the business-picker/dashboard screens.
 *
 * @param {string} ownerId - ID of the SuperAdmin whose businesses to list.
 * @returns {Promise<object[]>} Businesses ordered newest first.
 */
const getMyBusinesses = async (ownerId) => {
  const businesses = await prisma.business.findMany({
    where: { ownerId },
    include: {
      _count: {
        select: {
          businessUsers: true,
          warehouses: { where: { deletedAt: null } },
          products: { where: { deletedAt: null } },
          transactions: true,
        },
      },
      warehouses: {
        where: { isPrimary: true, deletedAt: null },
        select: {
          id: true,
          name: true,
          location: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return businesses;
};

/**
 * Get a single business by ID, with full detail (owner, warehouses with
 * stock counts, team members, aggregate counts). Access is enforced
 * differently depending on role: a SuperAdmin must be the owner; any other
 * role (Admin/Employee) must have an active `BusinessUser` link to it. This
 * dual lookup path means the function returns the *same* not-found error
 * for "doesn't exist" and "exists but you don't have access", so callers
 * can't probe for the existence of businesses they aren't part of.
 *
 * @param {string} businessId
 * @param {string} userId - ID of the requesting user.
 * @param {string} role - The requesting user's global role (SUPERADMIN/ADMIN/EMPLOYEE).
 * @returns {Promise<object>} The business with nested detail.
 * @throws {AppError} 404 if not found or the user has no access to it.
 */
const BUSINESS_DETAIL_INCLUDE = {
  owner: {
    select: {
      id: true,
      fullName: true,
      username: true,
      phone: true,
      email: true,
    },
  },
  warehouses: {
    where: { deletedAt: null },
    include: {
      _count: {
        select: {
          stock: { where: { product: { deletedAt: null } } },
        },
      },
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  },
  businessUsers: {
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
  },
  _count: {
    select: {
      businessUsers: true,
      warehouses: { where: { deletedAt: null } },
      products: { where: { deletedAt: null } },
      transactions: true,
    },
  },
};

const getBusinessById = async (businessId, userId, role) => {
  let business;

  if (role === "SUPERADMIN") {
    business = await prisma.business.findFirst({
      where: {
        id: businessId,
        ownerId: userId,
      },
      include: BUSINESS_DETAIL_INCLUDE,
    });
  } else {
    // Admin or Employee — must be linked to business
    const businessUser = await prisma.businessUser.findFirst({
      where: { businessId, userId },
      include: {
        business: {
          include: BUSINESS_DETAIL_INCLUDE,
        },
      },
    });

    business = businessUser?.business;
  }

  if (!business) {
    throw new AppError("Business not found or access denied", 404);
  }

  return business;
};

/**
 * Update editable business fields (contact info, location, and receipt
 * branding/customization). Only the owning SuperAdmin may update it, and
 * only fields explicitly provided are changed — falsy/undefined values are
 * left untouched rather than overwriting existing data.
 *
 * @param {string} businessId
 * @param {string} ownerId - Must match the business's owner.
 * @param {object} fields - Partial update (name, phone, email, location,
 *   receiptTitle, receiptFooterNote, receiptShowSignature,
 *   defaultLowStockThreshold, lowStockThresholdsByUnit).
 * @returns {Promise<object>} The updated business record.
 * @throws {Error} If the business doesn't exist or isn't owned by ownerId.
 */
const updateBusiness = async (
  businessId,
  ownerId,
  {
    name,
    phone,
    email,
    location,
    receiptTitle,
    receiptFooterNote,
    receiptShowSignature,
    defaultLowStockThreshold,
    lowStockThresholdsByUnit,
  }
) => {
  // Make sure this business belongs to this owner
  const existing = await prisma.business.findFirst({
    where: { id: businessId, ownerId },
  });

  if (!existing) {
    throw new AppError("Business not found or access denied", 404);
  }

  const updated = await prisma.business.update({
    where: { id: businessId },
    data: {
      ...(name && { name }),
      ...(phone && { phone }),
      ...(email && { email }),
      ...(location && { location }),
      ...(receiptTitle !== undefined && { receiptTitle }),
      ...(receiptFooterNote !== undefined && { receiptFooterNote }),
      ...(receiptShowSignature !== undefined && { receiptShowSignature }),
      ...(defaultLowStockThreshold !== undefined && { defaultLowStockThreshold }),
      ...(lowStockThresholdsByUnit !== undefined && { lowStockThresholdsByUnit }),
    },
  });

  return updated;
};

/**
 * Delete a business and everything under it (products, warehouses, sales,
 * team access). Relies on cascading deletes configured in schema.prisma —
 * this is a single irreversible operation, so ownership is re-verified
 * first to ensure only the owning SuperAdmin can trigger it.
 *
 * @param {string} businessId
 * @param {string} ownerId - Must match the business's owner.
 * @returns {Promise<{message: string}>}
 * @throws {AppError} 404 if the business doesn't exist or isn't owned by ownerId.
 */
const deleteBusiness = async (businessId, ownerId) => {
  const existing = await prisma.business.findFirst({
    where: { id: businessId, ownerId },
  });

  if (!existing) {
    throw new AppError("Business not found or access denied", 404);
  }

  const owner = await prisma.user.findUnique({ where: { id: ownerId } });

  // The audit entry is written with `businessId` set *before* the cascading
  // delete fires in the same transaction; the AuditLog->Business relation is
  // onDelete: SetNull, so the row survives (businessId becomes null) instead
  // of being cascade-deleted along with everything else - metadata.name
  // keeps it readable afterward.
  await prisma.$transaction(async (tx) => {
    await recordAudit(tx, {
      businessId,
      actorId: ownerId,
      actorName: owner?.fullName ?? null,
      action: "business.deleted",
      entityType: "Business",
      entityId: businessId,
      metadata: { name: existing.name },
    });

    await tx.business.delete({ where: { id: businessId } });
  });

  return { message: "Business deleted successfully" };
};

module.exports = {
  createBusiness,
  getMyBusinesses,
  getBusinessById,
  updateBusiness,
  deleteBusiness,
};