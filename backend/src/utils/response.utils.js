/**
 * Shared helpers for sending consistently-shaped JSON responses
 * ({ success, message, data|errors }) from controllers.
 */

/**
 * Send a success response.
 * @param {import('express').Response} res
 * @param {object} [options]
 * @param {string} [options.message="Success"]
 * @param {*} [options.data=null] - Response payload.
 * @param {number} [options.statusCode=200]
 */
const sendSuccess = (res, { message = "Success", data = null, statusCode = 200 } = {}) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

/**
 * Send an error response.
 * @param {import('express').Response} res
 * @param {object} [options]
 * @param {string} [options.message="Something went wrong"]
 * @param {number} [options.statusCode=500]
 * @param {*} [options.errors=null] - Optional field-level or detail errors.
 */
const sendError = (res, { message = "Something went wrong", statusCode = 500, errors = null } = {}) => {
  return res.status(statusCode).json({
    success: false,
    message,
    errors,
  });
};

module.exports = { sendSuccess, sendError };