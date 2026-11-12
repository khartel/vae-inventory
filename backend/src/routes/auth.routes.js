const express = require("express");
const router = express.Router();
const {
  register,
  login,
  verifyLogin2FA,
  logout,
  forgotPassword,
  resetPassword,
  me,
  changePassword,
  updateProfile,
  setup2FA,
  verify2FASetup,
  disable2FA,
} = require("../controllers/auth.controller");
const { authenticate } = require("../middleware/auth.middleware");
const { validate } = require("../middleware/validate.middleware");
const {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  updateProfileSchema,
  verifyLogin2FASchema,
  verify2FASetupSchema,
  disable2FASchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} = require("../validators/auth.validators");

/**
 * Auth router — registration, login (including the two-step 2FA flow),
 * logout, and the logged-in user's own profile/security settings.
 * The "Public routes" section needs no session; everything under
 * "Protected routes" runs behind `authenticate` (valid session cookie).
 * Logout is protected (not public) because revoking the session requires
 * knowing whose tokenVersion to bump - see auth.controller.js's `logout`.
 */

// Public routes
router.post("/register", validate(registerSchema), register);
router.post("/login", validate(loginSchema), login);
router.post("/login/2fa", validate(verifyLogin2FASchema), verifyLogin2FA);
router.post("/forgot-password", validate(forgotPasswordSchema), forgotPassword);
router.post("/reset-password", validate(resetPasswordSchema), resetPassword);

// Protected routes (must be logged in)
router.post("/logout", authenticate, logout);
router.get("/me", authenticate, me);
router.patch("/me", authenticate, validate(updateProfileSchema), updateProfile);
router.post("/change-password", authenticate, validate(changePasswordSchema), changePassword);
router.post("/2fa/setup", authenticate, setup2FA);
router.post("/2fa/verify", authenticate, validate(verify2FASetupSchema), verify2FASetup);
router.post("/2fa/disable", authenticate, validate(disable2FASchema), disable2FA);

module.exports = router;