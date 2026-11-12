/**
 * Master-key middleware: gates platform-admin-only routes (e.g. superadmin
 * bootstrap endpoints) behind a shared secret rather than a user session.
 */
const { sendError } = require("../utils/response.utils");

/**
 * Requires the `x-master-key` request header to exactly match the
 * MASTER_KEY environment variable. Responds 401 if the header is missing,
 * 403 if it doesn't match, otherwise calls next().
 */
const validateMasterKey = (req, res, next) => {
  const masterKey = req.headers["x-master-key"];

  if (!masterKey) {
    return sendError(res, {
      message: "Access denied. Master key required.",
      statusCode: 401,
    });
  }

  if (masterKey !== process.env.MASTER_KEY) {
    return sendError(res, {
      message: "Access denied. Invalid master key.",
      statusCode: 403,
    });
  }

  next();
};

module.exports = { validateMasterKey };