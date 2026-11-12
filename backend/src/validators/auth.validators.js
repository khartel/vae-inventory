/**
 * Zod request-validation schemas for the auth endpoints (register, login,
 * profile updates, password change, and 2FA setup/verify/disable).
 * Each exported schema is consumed by the `validate` middleware and shaped
 * as { body?, params?, query? }.
 */
const { z } = require("zod");

// Optional email field that also accepts an empty string (so forms can
// submit "" to mean "no email" instead of omitting the key entirely).
const emailOrEmpty = z
  .string()
  .email("Invalid email address")
  .optional()
  .or(z.literal(""));

/**
 * Validates POST /auth/register - creates a new SuperAdmin account. Email is
 * required (unlike `updateProfileSchema`/team members) since it's this
 * account's only self-service password-recovery path - there's nobody above
 * a SuperAdmin in the business to reset it for them.
 */
const registerSchema = {
  body: z.object({
    fullName: z.string().trim().min(1, "Full name is required"),
    username: z.string().trim().min(3, "Username must be at least 3 characters"),
    phone: z.string().trim().min(7, "Phone number is required"),
    email: z.string().trim().min(1, "Email is required").email("Invalid email address"),
    password: z.string().min(6, "Password must be at least 6 characters"),
  }),
};

/** Validates POST /auth/login - username/password credentials, plus an optional "remember me" flag that extends token lifetime. */
const loginSchema = {
  body: z.object({
    username: z.string().trim().min(1, "Username is required"),
    password: z.string().min(1, "Password is required"),
    rememberMe: z.boolean().optional(),
  }),
};

/** Validates POST /auth/change-password - requires the current password to authorize setting a new one. */
const changePasswordSchema = {
  body: z.object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(6, "New password must be at least 6 characters"),
  }),
};

/** Validates PATCH /auth/profile - all fields optional to support partial updates. */
const updateProfileSchema = {
  body: z.object({
    fullName: z.string().trim().min(1, "Full name is required").optional(),
    phone: z.string().trim().min(7, "Phone number is required").optional(),
    email: emailOrEmpty,
    // Keep this enum in sync with SUPPORTED_LANGUAGES in
    // frontend/src/components/LanguageSwitcher.tsx when adding a new language.
    language: z.enum(["en", "fr"]).optional(),
  }),
};

/** Validates POST /auth/2fa/verify-login - exchanges the short-lived pending-2FA token plus a 6-digit TOTP code for a real session. */
const verifyLogin2FASchema = {
  body: z.object({
    tempToken: z.string().min(1, "Session token is required"),
    code: z.string().trim().min(6, "Enter the 6-digit code").max(6, "Enter the 6-digit code"),
  }),
};

/** Validates POST /auth/2fa/verify-setup - confirms a 6-digit TOTP code to finish enabling 2FA. */
const verify2FASetupSchema = {
  body: z.object({
    code: z.string().trim().min(6, "Enter the 6-digit code").max(6, "Enter the 6-digit code"),
  }),
};

/** Validates POST /auth/2fa/disable - requires the current password since disabling 2FA is security-sensitive. */
const disable2FASchema = {
  body: z.object({
    password: z.string().min(1, "Current password is required"),
  }),
};

/** Validates POST /auth/forgot-password - just an email to send the reset link to. */
const forgotPasswordSchema = {
  body: z.object({
    email: z.string().trim().min(1, "Email is required").email("Invalid email address"),
  }),
};

/** Validates POST /auth/reset-password - the emailed token plus the new password. */
const resetPasswordSchema = {
  body: z.object({
    token: z.string().min(1, "Reset token is required"),
    newPassword: z.string().min(6, "New password must be at least 6 characters"),
  }),
};

module.exports = {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  updateProfileSchema,
  verifyLogin2FASchema,
  verify2FASetupSchema,
  disable2FASchema,
  forgotPasswordSchema,
  resetPasswordSchema,
};
