/**
 * Authentication middleware: verifies the caller's JWT (from either the
 * Authorization header or the "token" cookie) and attaches the decoded
 * payload to req.user for downstream handlers/middleware to use.
 */
const { verifyToken } = require("../utils/jwt.utils");
const { sendError } = require("../utils/response.utils");
const prisma = require("../utils/prisma");

const PASSWORD_CHANGE_ROUTES = new Set([
  "GET /api/auth/me",
  "POST /api/auth/logout",
  "POST /api/auth/change-password",
]);

/**
 * Requires a valid JWT on the request. Reads the token from the
 * `Authorization: Bearer <token>` header first, falling back to the
 * `token` cookie. On success, attaches the decoded payload as `req.user`
 * and calls next(). On failure (missing/expired/invalid token, or a token
 * revoked via logout - see the tokenVersion check below), responds with
 * 401 and does not call next().
 */
const authenticate = async (req, res, next) => {
  try {
    // Get token from header or cookie
    const authHeader = req.headers.authorization;
    const cookieToken = req.cookies?.token;

    let token = null;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    } else if (cookieToken) {
      token = cookieToken;
    }

    if (!token) {
      return sendError(res, {
        message: "Access denied. No token provided.",
        statusCode: 401,
      });
    }

    // Verify the token
    const decoded = verifyToken(token);

    // Special-purpose tokens share the signing key but are never sessions.
    // Keep legacy sessions (no purpose/tokenType) valid until normal expiry or
    // revocation; explicitly typed tokens must identify themselves as sessions.
    if (
      (decoded.purpose !== undefined && decoded.purpose !== "session") ||
      (decoded.tokenType !== undefined && decoded.tokenType !== "session")
    ) {
      return sendError(res, {
        message: "Invalid token. Please log in again.",
        statusCode: 401,
      });
    }

    // Reject tokens revoked by a logout since they were issued. Tokens
    // signed before the tokenVersion claim existed have no claim at all,
    // so they're treated as version 0 (matching a fresh account's default)
    // rather than being force-invalidated by this change.
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { tokenVersion: true, mustChangePassword: true },
    });

    if (!user || (decoded.tokenVersion ?? 0) !== user.tokenVersion) {
      return sendError(res, {
        message: "Session expired. Please log in again.",
        statusCode: 401,
      });
    }

    // Use the current database flag, not a JWT claim that can become stale
    // after an administrator issues a temporary password. Match both method
    // and mounted path; PATCH /auth/me must not inherit GET /auth/me's exception.
    if (user.mustChangePassword) {
      const path = `${req.baseUrl || ""}${req.path}`.replace(/\/+$/, "").toLowerCase();
      if (!PASSWORD_CHANGE_ROUTES.has(`${req.method} ${path}`)) {
        return sendError(res, {
          message: "Password change required before continuing",
          statusCode: 403,
        });
      }
    }

    // Attach user info to request
    req.user = decoded;

    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return sendError(res, {
        message: "Session expired. Please log in again.",
        statusCode: 401,
      });
    }

    return sendError(res, {
      message: "Invalid token. Please log in again.",
      statusCode: 401,
    });
  }
};

module.exports = { authenticate };
