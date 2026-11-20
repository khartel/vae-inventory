const {
  registerSuperAdmin,
  loginUser,
  verifyLoginTwoFactor,
  invalidateSessions,
  requestPasswordReset,
  resetPassword,
  getMe,
  updatePassword,
  updateProfile: updateProfileService,
  setupTwoFactor,
  verifyTwoFactorSetup,
  disableTwoFactor,
} = require("../services/auth.service");
const { sendSuccess } = require("../utils/response.utils");
const asyncHandler = require("../utils/asyncHandler");

const AUTH_COOKIE_OPTIONS = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
});

/**
 * Sets the httpOnly session cookie - shared by the direct login path and
 * the 2FA-verify path so both produce an identical session.
 */
const setAuthCookie = (res, token, rememberMe) => {
  res.cookie("token", token, {
    ...AUTH_COOKIE_OPTIONS(),
    maxAge: rememberMe
      ? 30 * 24 * 60 * 60 * 1000 // 30 days
      : 24 * 60 * 60 * 1000, // 24 hours
  });
};

/**
 * POST /api/auth/register
 * Register a new SuperAdmin
 */
const register = asyncHandler(async (req, res) => {
  const { fullName, username, phone, email, password } = req.body;

  const user = await registerSuperAdmin({ fullName, username, phone, email, password });

  return sendSuccess(res, {
    message: "Account created successfully. Please log in.",
    data: user,
    statusCode: 201,
  });
});

/**
 * POST /api/auth/login
 * Login any user
 */
const login = asyncHandler(async (req, res) => {
  const { username, password, rememberMe } = req.body;

  const result = await loginUser({ username, password, rememberMe });

  if (result.requires2FA) {
    return sendSuccess(res, {
      message: "Two-factor authentication code required",
      data: { requires2FA: true, tempToken: result.tempToken },
    });
  }

  // Token is only ever sent via httpOnly cookie — never in the JSON body —
  // so it can't be read or exfiltrated by client-side JS.
  setAuthCookie(res, result.token, rememberMe);

  return sendSuccess(res, {
    message: "Login successful",
    data: { user: result.user },
  });
});

/**
 * POST /api/auth/login/2fa
 * Completes login for an account with 2FA enabled - public endpoint (no
 * session cookie exists yet), takes the tempToken from step 1 + a TOTP code.
 */
const verifyLogin2FA = asyncHandler(async (req, res) => {
  const { tempToken, code } = req.body;

  const { token, user, rememberMe } = await verifyLoginTwoFactor(tempToken, code);

  setAuthCookie(res, token, rememberMe);

  return sendSuccess(res, {
    message: "Login successful",
    data: { user },
  });
});

/**
 * POST /api/auth/logout
 * Logout user - revokes every outstanding JWT for this account (via
 * tokenVersion) in addition to clearing the session cookie, so a leaked
 * token doesn't stay valid after a legitimate logout.
 */
const logout = asyncHandler(async (req, res) => {
  await invalidateSessions(req.user.id);
  res.clearCookie("token", AUTH_COOKIE_OPTIONS());

  return sendSuccess(res, {
    message: "Logged out successfully",
  });
});

/**
 * POST /api/auth/forgot-password
 * Always responds with the same generic message regardless of whether the
 * email matched an account or the send actually succeeded - the service
 * function never surfaces that distinction, so there's nothing to leak here.
 */
const forgotPassword = asyncHandler(async (req, res) => {
  await requestPasswordReset(req.body.email);

  return sendSuccess(res, {
    message:
      "If an account with that email exists, we've sent password-reset instructions. If you don't have an email on file, ask your business owner or admin to reset it from the Team page instead.",
  });
});

/**
 * POST /api/auth/reset-password
 * Public endpoint (no session cookie yet) - the emailed token is the proof
 * of identity. Does not auto-login; the user signs in with their new
 * password afterward.
 */
const resetPasswordHandler = asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;

  await resetPassword(token, newPassword);

  return sendSuccess(res, {
    message: "Password reset successfully. Please log in with your new password.",
  });
});

/**
 * GET /api/auth/me
 * Get current logged in user
 */
const me = asyncHandler(async (req, res) => {
  const user = await getMe(req.user.id);

  return sendSuccess(res, {
    message: "User profile fetched",
    data: user,
  });
});

/**
 * POST /api/auth/change-password
 */
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  await updatePassword(req.user.id, currentPassword, newPassword);

  return sendSuccess(res, {
    message: "Password updated successfully",
  });
});

/**
 * PATCH /api/auth/me
 * Update the current user's own profile (fullName, phone, email, language)
 */
const updateProfile = asyncHandler(async (req, res) => {
  const { fullName, phone, email, language } = req.body;

  const user = await updateProfileService(req.user.id, { fullName, phone, email, language });

  return sendSuccess(res, {
    message: "Profile updated successfully",
    data: user,
  });
});

/**
 * POST /api/auth/2fa/setup
 */
const setup2FA = asyncHandler(async (req, res) => {
  const result = await setupTwoFactor(req.user.id);

  return sendSuccess(res, {
    message: "Scan the QR code with your authenticator app",
    data: result,
  });
});

/**
 * POST /api/auth/2fa/verify
 */
const verify2FASetup = asyncHandler(async (req, res) => {
  const { code } = req.body;

  await verifyTwoFactorSetup(req.user.id, code);

  return sendSuccess(res, {
    message: "Two-factor authentication enabled",
  });
});

/**
 * POST /api/auth/2fa/disable
 */
const disable2FA = asyncHandler(async (req, res) => {
  const { password } = req.body;

  await disableTwoFactor(req.user.id, password);

  return sendSuccess(res, {
    message: "Two-factor authentication disabled",
  });
});

module.exports = {
  register,
  login,
  verifyLogin2FA,
  logout,
  forgotPassword,
  resetPassword: resetPasswordHandler,
  me,
  changePassword,
  updateProfile,
  setup2FA,
  verify2FASetup,
  disable2FA,
};
