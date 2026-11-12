/**
 * JWT helpers: sign/verify/decode tokens used for session auth. Two "sign"
 * functions exist for different purposes - see generateToken vs
 * generateShortLivedToken below.
 */
const jwt = require("jsonwebtoken");
const logger = require("./logger");

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  logger.fatal("JWT_SECRET is not defined in .env file.");
  process.exit(1);
}

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "24h";
const JWT_REMEMBER_ME_EXPIRES_IN = process.env.JWT_REMEMBER_ME_EXPIRES_IN || "30d";

/**
 * Generate the main session JWT for a logged-in user.
 * @param {object} payload - Data to embed in the token (e.g. id, username, role).
 * @param {boolean} [rememberMe=false] - If true, uses the longer JWT_REMEMBER_ME_EXPIRES_IN lifetime instead of the default JWT_EXPIRES_IN.
 */
const generateToken = (payload, rememberMe = false) => {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: rememberMe ? JWT_REMEMBER_ME_EXPIRES_IN : JWT_EXPIRES_IN,
  });
};

/**
 * Verify a JWT token's signature and expiry.
 * @param {string} token - The JWT to verify.
 * @returns {object} The decoded payload if valid.
 * @throws Throws (e.g. TokenExpiredError, JsonWebTokenError) if the token is invalid or expired.
 */
const verifyToken = (token) => {
  return jwt.verify(token, JWT_SECRET);
};

/**
 * Sign a short-lived, special-purpose token (e.g. the pending-2FA token
 * issued between password verification and TOTP code verification).
 * Unlike generateToken, the caller supplies an explicit expiry so these
 * tokens can be scoped much shorter than a real session (e.g. "5m").
 * @param {object} payload - Data to embed in the token.
 * @param {string|number} expiresIn - jsonwebtoken-compatible expiry (e.g. "5m").
 */
const generateShortLivedToken = (payload, expiresIn) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
};

/**
 * Decode a token's payload without verifying its signature or expiry
 * (for debugging/inspection only - never use this for auth decisions).
 */
const decodeToken = (token) => {
  return jwt.decode(token);
};

module.exports = { generateToken, verifyToken, decodeToken, generateShortLivedToken };