/**
 * Role/business-membership middleware: gates routes by the caller's role -
 * their per-business role (req.businessRole) when the request is scoped to
 * a business `belongsToBusiness` already resolved, falling back to their
 * account-wide role (req.user.role) otherwise - and verifies the
 * authenticated user actually has access to the business referenced in the
 * request before letting it through.
 */
const { sendError } = require("../utils/response.utils");
const prisma = require("../utils/prisma");

/**
 * Allow only specific roles. Must run after `authenticate` (relies on
 * req.user being set) and, for business-scoped routes, after
 * `belongsToBusiness` (relies on req.businessRole when set). Returns a
 * middleware that responds 401 if there's no authenticated user, 403 if
 * the caller's effective role isn't in the allowed list, otherwise calls
 * next().
 *
 * The effective role is req.businessRole if `belongsToBusiness` set one -
 * i.e. the caller's role for the specific business in this request, which
 * can differ from their account-wide role once they belong to more than
 * one business - falling back to req.user.role for routes that aren't
 * business-scoped (e.g. managing businesses themselves).
 *
 * Usage: authorize("SUPERADMIN", "ADMIN")
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return sendError(res, {
        message: "Access denied. Not authenticated.",
        statusCode: 401,
      });
    }

    const effectiveRole = req.businessRole ?? req.user.role;

    if (!roles.includes(effectiveRole)) {
      return sendError(res, {
        message: "Access denied. You do not have permission to do this.",
        statusCode: 403,
      });
    }

    next();
  };
};

/**
 * Checks that the authenticated user is allowed to access the business
 * referenced by req.params.businessId (or req.body.businessId). A
 * SUPERADMIN must own the business; ADMIN/EMPLOYEE users must have a
 * BusinessUser link to it. On success, attaches the business record as
 * req.business, the caller's role for *this* business as req.businessRole,
 * and calls next(); otherwise responds 400/403/500.
 */
const belongsToBusiness = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const businessId = req.params.businessId || req.body.businessId;

    if (!businessId) {
      return sendError(res, {
        message: "Business ID is required.",
        statusCode: 400,
      });
    }

    // Superadmin can access any business they own
    if (req.user.role === "SUPERADMIN") {
      const business = await prisma.business.findFirst({
        where: { id: businessId, ownerId: userId },
      });

      if (!business) {
        return sendError(res, {
          message: "Access denied. This is not your business.",
          statusCode: 403,
        });
      }

      req.business = business;
      req.businessRole = "SUPERADMIN";
      return next();
    }

    // Admins and Employees must be linked to the business
    const businessUser = await prisma.businessUser.findFirst({
      where: { businessId, userId },
      include: { business: true },
    });

    if (!businessUser) {
      return sendError(res, {
        message: "Access denied. You do not belong to this business.",
        statusCode: 403,
      });
    }

    req.business = businessUser.business;
    req.businessRole = businessUser.role;
    next();
  } catch (error) {
    return sendError(res, {
      message: "Something went wrong checking business access.",
      statusCode: 500,
    });
  }
};

module.exports = { authorize, belongsToBusiness };