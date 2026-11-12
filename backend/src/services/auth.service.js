const bcrypt = require("bcryptjs");
const { generateSecret, verify, generateURI } = require("otplib");
const QRCode = require("qrcode");
const prisma = require("../utils/prisma");
const { generateToken, verifyToken, generateShortLivedToken } = require("../utils/jwt.utils");
const { getCurrencyForCountry } = require("../utils/currencies");
const { sendEmail, passwordResetEmailHtml, welcomeEmailHtml } = require("../utils/email.utils");
const logger = require("../utils/logger");
const AppError = require("../utils/AppError");
const { recordAudit } = require("../utils/auditLog");

/**
 * Fields of a Business that are safe/relevant to expose to a logged-in user
 * (e.g. as part of their session's `businesses` list or receipt settings).
 * Centralized so every place that needs a lightweight business shape stays
 * in sync instead of hand-picking fields in multiple queries.
 */
const BUSINESS_SELECT = {
  id: true,
  name: true,
  country: true,
  currency: true,
  location: true,
  receiptTitle: true,
  receiptFooterNote: true,
  receiptShowSignature: true,
  defaultLowStockThreshold: true,
  lowStockThresholdsByUnit: true,
};

/**
 * Prisma `include` shape for loading a User together with every business
 * they can access: businesses they own (SuperAdmin) via `ownedBusinesses`,
 * and businesses they've been added to as staff via `businessUsers`. Used
 * anywhere a full session/profile needs to be reconstructed (login, 2FA
 * verification, /me).
 */
const USER_WITH_BUSINESSES_INCLUDE = {
  businessUsers: {
    include: {
      business: { select: BUSINESS_SELECT },
    },
  },
  ownedBusinesses: {
    select: BUSINESS_SELECT,
  },
};

/**
 * Builds the normalized `businesses` array embedded in a session/profile
 * response, from a User record fetched with `USER_WITH_BUSINESSES_INCLUDE`.
 * SUPERADMINs see their owned businesses as-is; everyone else sees the
 * businesses they've been added to as staff, each carrying their
 * membership id/role for that specific business. Spreading `bu.business`
 * (rather than hand-listing its fields, as this used to do in two separate
 * places that quietly drifted out of sync with each other and with
 * BUSINESS_SELECT) means every field there automatically flows through
 * here too, with nothing left to remember to update per new field.
 *
 * @param {object} user - Has `role`, `ownedBusinesses`, `businessUsers`.
 * @returns {object[]}
 */
const buildBusinessesList = (user) => {
  if (user.role === "SUPERADMIN") {
    return user.ownedBusinesses;
  }
  return user.businessUsers.map((bu) => ({
    ...bu.business,
    businessUserId: bu.id,
    roleInBusiness: bu.role,
  }));
};

/**
 * Register a new SuperAdmin. Email is required (unlike a team member added
 * via the Team page, who stays email-optional since they always have an
 * admin/owner above them) - it's the SuperAdmin's only self-service password-
 * recovery path, since there's nobody above them in the business. Also
 * used to send a welcome email right after signup - same fire-and-forget
 * pattern as `requestPasswordReset`: a send failure is logged but never
 * thrown, so a flaky email provider can't fail registration itself.
 */
const registerSuperAdmin = async ({ fullName, username, phone, email, password }) => {
  const cleanEmail = email.trim();

  // Check if username already exists
  const existingUsername = await prisma.user.findUnique({
    where: { username },
  });

  if (existingUsername) {
    throw new AppError("Username is already taken", 409);
  }

  const existingEmail = await prisma.user.findUnique({
    where: { email: cleanEmail },
  });

  if (existingEmail) {
    throw new AppError("Email is already registered", 409);
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, 12);

  // Create the user
  const user = await prisma.user.create({
    data: {
      fullName,
      username,
      phone,
      email: cleanEmail,
      passwordHash,
      role: "SUPERADMIN",
    },
    select: {
      id: true,
      fullName: true,
      username: true,
      phone: true,
      email: true,
      role: true,
      createdAt: true,
    },
  });

  // Not tied to a business yet at this point (a SuperAdmin creates their
  // first business separately) - a platform-level event, surfaced on the
  // Platform Admin console's Activity tab rather than any per-business one.
  await recordAudit(prisma, {
    actorId: user.id,
    actorName: user.fullName,
    action: "superadmin.registered",
    entityType: "User",
    entityId: user.id,
    metadata: { username: user.username },
  });

  // Deliberately not awaited: registration must not hang or fail because a
  // third-party email API is slow or down. Errors (including a slow
  // rejection) are still caught and logged, just off the request's
  // critical path.
  sendEmail({
    to: { email: user.email, name: user.fullName },
    subject: "Welcome to VAE Inventory",
    html: welcomeEmailHtml(user.fullName),
  }).catch((err) => {
    logger.error({ err, userId: user.id }, "Failed to send welcome email");
  });

  return user;
};

/**
 * Builds the final session (JWT + normalized user/businesses shape) for a
 * fully-authenticated user - i.e. password verified, and 2FA verified too
 * if the account has it enabled. Shared by the direct login path and the
 * 2FA-verify path so both produce an identical session shape.
 */
const issueSession = (user, rememberMe) => {
  const token = generateToken(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      tokenVersion: user.tokenVersion,
    },
    rememberMe
  );

  const businesses = buildBusinessesList(user);

  // Remove passwordHash/2FA secret from response
  const { passwordHash, twoFactorSecret, businessUsers, ownedBusinesses, ...userWithoutPassword } = user;

  return {
    token,
    user: {
      ...userWithoutPassword,
      businesses,
    },
  };
};

/**
 * Login any user (SuperAdmin, Admin, Employee)
 */
const loginUser = async ({ username, password, rememberMe = false }) => {
  // Find user by username
  const user = await prisma.user.findUnique({
    where: { username },
    include: USER_WITH_BUSINESSES_INCLUDE,
  });

  if (!user) {
    throw new AppError("Invalid username or password", 401);
  }

  // Check password
  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

  if (!isPasswordValid) {
    throw new AppError("Invalid username or password", 401);
  }

  // If 2FA is enabled, don't issue a real session yet - only a short-lived
  // token identifying who's mid-login, to be exchanged for a session once
  // they provide a valid authenticator code.
  if (user.twoFactorEnabled) {
    const tempToken = generateShortLivedToken(
      { id: user.id, purpose: "2fa-pending", rememberMe },
      "5m"
    );
    return { requires2FA: true, tempToken };
  }

  return issueSession(user, rememberMe);
};

/**
 * Completes login for an account with 2FA enabled: verifies the short-lived
 * tempToken from the password step, then the TOTP code, then issues a real
 * session identical in shape to a normal (non-2FA) login.
 */
const verifyLoginTwoFactor = async (tempToken, code) => {
  let payload;
  try {
    payload = verifyToken(tempToken);
  } catch {
    throw new AppError("Your session expired. Please log in again.", 401);
  }

  if (payload.purpose !== "2fa-pending") {
    throw new AppError("Invalid session. Please log in again.", 401);
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.id },
    include: USER_WITH_BUSINESSES_INCLUDE,
  });

  if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
    throw new AppError("Invalid session. Please log in again.", 401);
  }

  const result = await verify({ secret: user.twoFactorSecret, token: code, tolerance: 30 });
  if (!result.valid) {
    throw new AppError("Invalid authentication code", 401);
  }

  const rememberMe = payload.rememberMe ?? false;
  return { ...issueSession(user, rememberMe), rememberMe };
};

/**
 * Revokes every JWT previously issued to this user by bumping their
 * `tokenVersion` - `authenticate` rejects any token whose `tokenVersion`
 * claim no longer matches the stored value. Called on logout so a
 * leaked/stolen token stops working immediately instead of staying valid
 * until it naturally expires. Note this signs the user out everywhere
 * (every device/session), not just the one calling logout - there's no
 * per-session store to revoke a single token in isolation.
 *
 * @param {string} userId - ID of the user logging out.
 */
const invalidateSessions = async (userId) => {
  await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });
};

/**
 * Starts a self-service password reset: if `email` matches an account,
 * emails them a short-lived, purpose-tagged reset link (same idiom as the
 * "2fa-pending" token used mid-login - a plain JWT, verified later via
 * `verifyToken` + a `purpose` check). Deliberately returns nothing and never
 * throws for "no such account" or "send failed" - the controller always
 * responds with the same generic message either way, so this endpoint can't
 * be used to probe which emails are registered. The send itself isn't
 * awaited either, so a slow/unreachable email provider can't stall this
 * endpoint's response - a failure is still logged server-side so it's not
 * silently invisible to us, just off the request's critical path.
 *
 * @param {string} email
 */
const requestPasswordReset = async (email) => {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) return;

  const resetToken = generateShortLivedToken({ id: user.id, purpose: "password-reset" }, "30m");
  const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;

  sendEmail({
    to: { email: user.email, name: user.fullName },
    subject: "Reset your VAE Inventory password",
    html: passwordResetEmailHtml(resetUrl),
  }).catch((err) => {
    logger.error({ err, userId: user.id }, "Failed to send password-reset email");
  });
};

/**
 * Completes a password reset: verifies the token from the emailed link,
 * sets the new password, and invalidates every existing session (same
 * `invalidateSessions` used on logout) - a forgotten/possibly-leaked
 * password being reset is exactly the situation where signing out every
 * other device is the right call.
 *
 * @param {string} token
 * @param {string} newPassword
 * @throws {AppError} 401 if the token is missing/invalid/expired/wrong-purpose.
 */
const resetPassword = async (token, newPassword) => {
  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    throw new AppError("This reset link is invalid or has expired. Please request a new one.", 401);
  }

  if (payload.purpose !== "password-reset") {
    throw new AppError("This reset link is invalid or has expired. Please request a new one.", 401);
  }

  const user = await prisma.user.findUnique({ where: { id: payload.id } });
  if (!user) {
    throw new AppError("This reset link is invalid or has expired. Please request a new one.", 401);
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePassword: false },
  });

  await invalidateSessions(user.id);
};

/**
 * Fetches the current logged-in user's profile for the /auth/me endpoint,
 * used to rehydrate a session client-side (e.g. after a page reload) without
 * requiring a fresh login.
 *
 * @param {string} userId - ID of the authenticated user.
 * @returns {Promise<object>} The user (minus password/2FA secret) with a
 *   normalized `businesses` array built the same way as `issueSession`, so
 *   the frontend can treat a fresh login and a /me refetch identically.
 * @throws {AppError} 404 if the user no longer exists.
 */
const getMe = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      fullName: true,
      username: true,
      phone: true,
      email: true,
      role: true,
      twoFactorEnabled: true,
      language: true,
      createdAt: true,
      ...USER_WITH_BUSINESSES_INCLUDE,
    },
  });

  if (!user) {
    throw new AppError("User not found", 404);
  }

  // Build the same normalized `businesses` array shape as issueSession, so
  // the frontend can rely on it regardless of whether the session came from
  // a fresh login or a /auth/me refetch (e.g. after a page reload).
  const businesses = buildBusinessesList(user);

  const { ownedBusinesses, businessUsers, ...userWithoutRaw } = user;

  return {
    ...userWithoutRaw,
    businesses,
  };
};

/**
 * Changes a logged-in user's own password. Requires the current password as
 * proof of identity, and clears `mustChangePassword` so a user who was
 * issued a temporary/forced password (e.g. new team member, post-reset)
 * is no longer nagged to change it after doing so voluntarily.
 *
 * @param {string} userId - ID of the user changing their password.
 * @param {string} currentPassword - Plaintext current password to verify.
 * @param {string} newPassword - Plaintext new password to hash and store.
 * @returns {Promise<boolean>} true on success.
 * @throws {AppError} 404 if user not found, 401 if currentPassword is wrong.
 */
const updatePassword = async (userId, currentPassword, newPassword) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new AppError("User not found", 404);
  }

  const isPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isPasswordValid) {
    throw new AppError("Current password is incorrect", 401);
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      mustChangePassword: false,
    },
  });

  return true;
};

/**
 * Update the current user's own profile fields (fullName, phone, email).
 * All fields are optional/partial - only provided ones are updated.
 *
 * @param {string} userId - ID of the user being updated.
 * @param {{fullName?: string, phone?: string, email?: string, language?: string}} fields -
 *   Partial profile fields. An empty-string email is normalized to null;
 *   a changed, non-empty email is checked for uniqueness across all users
 *   before being saved. `language` is the user's own UI-language preference
 *   (e.g. "en"/"fr") and is saved immediately by the language switcher, not
 *   just from the Profile form.
 * @returns {Promise<object>} The refreshed profile, same shape as `getMe`.
 * @throws {AppError} 404 if user not found, 409 if the new email is already
 *   registered to another account.
 */
const updateProfile = async (userId, { fullName, phone, email, language }) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw new AppError("User not found", 404);
  }

  const data = {};
  if (fullName !== undefined) data.fullName = fullName;
  if (phone !== undefined) data.phone = phone;
  if (language !== undefined) data.language = language;

  if (email !== undefined) {
    const cleanEmail = email.trim() !== "" ? email.trim() : null;
    if (cleanEmail && cleanEmail !== user.email) {
      const existingEmail = await prisma.user.findUnique({ where: { email: cleanEmail } });
      if (existingEmail) {
        throw new AppError("Email is already registered", 409);
      }
    }
    data.email = cleanEmail;
  }

  await prisma.user.update({ where: { id: userId }, data });

  return getMe(userId);
};

/**
 * Begins 2FA setup: generates a new secret (stored but not yet enabled),
 * and returns a QR code + the raw secret as a manual-entry fallback.
 */
const setupTwoFactor = async (userId) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw new AppError("User not found", 404);
  }

  const secret = generateSecret();

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorSecret: secret, twoFactorEnabled: false },
  });

  const otpauthUrl = generateURI({ issuer: "VAE Inventory", label: user.username, secret });
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

  return { secret, qrCodeDataUrl };
};

/**
 * Confirms 2FA setup by verifying a code against the pending secret, then
 * flips twoFactorEnabled on.
 */
const verifyTwoFactorSetup = async (userId, code) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw new AppError("User not found", 404);
  }

  if (!user.twoFactorSecret) {
    throw new AppError("No 2FA setup in progress. Please start setup again.", 400);
  }

  const result = await verify({ secret: user.twoFactorSecret, token: code, tolerance: 30 });
  if (!result.valid) {
    throw new AppError("Invalid code. Please try again.", 400);
  }

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: true },
  });

  return true;
};

/**
 * Disables 2FA. Requires the current password since this is a sensitive
 * security action that shouldn't be doable from just a live session.
 */
const disableTwoFactor = async (userId, password) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw new AppError("User not found", 404);
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
  if (!isPasswordValid) {
    throw new AppError("Current password is incorrect", 401);
  }

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorSecret: null, twoFactorEnabled: false },
  });

  return true;
};

module.exports = {
  registerSuperAdmin,
  loginUser,
  verifyLoginTwoFactor,
  invalidateSessions,
  requestPasswordReset,
  resetPassword,
  getMe,
  updatePassword,
  updateProfile,
  setupTwoFactor,
  verifyTwoFactorSetup,
  disableTwoFactor,
};