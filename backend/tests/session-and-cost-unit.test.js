// Socket-free checks supplement the PostgreSQL/HTTP regression suites. They do
// not establish database lock behavior; those checks live in the concurrency suite.
jest.mock("../src/utils/prisma", () => ({
  user: { findUnique: jest.fn(), updateMany: jest.fn() },
  transaction: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
  customer: { findFirst: jest.fn() },
  warehouse: { findFirst: jest.fn() },
  product: { findFirst: jest.fn() },
  warehouseStock: { updateMany: jest.fn(), upsert: jest.fn() },
  creditPayment: { create: jest.fn(), delete: jest.fn() },
  return: { create: jest.fn() },
  stockMovement: { create: jest.fn() },
  auditLog: { create: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
}));
jest.mock("bcryptjs", () => ({ compare: jest.fn().mockResolvedValue(true) }));
jest.mock("otplib", () => ({
  verify: jest.fn().mockResolvedValue({ valid: true }),
  generateSecret: jest.fn().mockReturnValue("NEWSECRET"),
  generateURI: jest.fn().mockReturnValue("otpauth://test"),
}));
jest.mock("qrcode", () => ({ toDataURL: jest.fn().mockResolvedValue("data:image/png;base64,test") }));
jest.mock("../src/utils/email.utils", () => ({}));

const prisma = require("../src/utils/prisma");
const { authenticate } = require("../src/middleware/auth.middleware");
const { generateToken, generateShortLivedToken, verifyToken } = require("../src/utils/jwt.utils");
const { loginUser, verifyLoginTwoFactor, setupTwoFactor } = require("../src/services/auth.service");
const transactions = require("../src/services/transaction.service");
const { getCustomerById } = require("../src/services/customer.service");
const { canViewCostPrice, stripItemCostPrice, withTransactionCostVisibility } = require("../src/utils/transactionResponse");

beforeEach(() => {
  jest.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue({ id: "user", tokenVersion: 0 });
  prisma.user.updateMany.mockResolvedValue({ count: 1 });
});

describe("Forced password changes without sockets", () => {
  const session = () => generateToken({ id: "user", tokenVersion: 0, mustChangePassword: false });
  const reqFor = (method, path, baseUrl = "/api/auth") => ({
    method, path, baseUrl, headers: { authorization: `Bearer ${session()}` },
  });

  test.each([
    ["GET", "/me"], ["POST", "/logout"], ["POST", "/change-password"],
  ])("permits only the recovery route %s %s while a change is required", async (method, path) => {
    prisma.user.findUnique.mockResolvedValue({ tokenVersion: 0, mustChangePassword: true });
    const next = jest.fn();
    await authenticate(reqFor(method, path), response(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["PATCH", "/me", "/api/auth"],
    ["POST", "/me", "/api/auth"],
    ["HEAD", "/me", "/api/auth"],
    ["GET", "/logout", "/api/auth"],
    ["POST", "/2fa/setup", "/api/auth"],
    ["GET", "/me/extra", "/api/auth"],
    ["GET", "/products", "/api/businesses/business"],
  ])("blocks %s %s on mount %s even if the JWT claims no change is required", async (method, path, baseUrl) => {
    prisma.user.findUnique.mockResolvedValue({ tokenVersion: 0, mustChangePassword: true });
    const res = response();
    const next = jest.fn();
    await authenticate(reqFor(method, path, baseUrl), res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: "Password change required before continuing", errors: null });
    expect(next).not.toHaveBeenCalled();
  });

  test("uses the current stored flag so the same session works immediately after a password change", async () => {
    const req = reqFor("GET", "/products", "/api/businesses/business");
    prisma.user.findUnique.mockResolvedValueOnce({ tokenVersion: 0, mustChangePassword: true });
    const before = response();
    await authenticate(req, before, jest.fn());
    expect(before.status).toHaveBeenCalledWith(403);
    const next = jest.fn();
    await authenticate(req, response(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("2FA setup guards without sockets", () => {
  test("does not write when 2FA is already enabled", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "user", twoFactorEnabled: true, twoFactorSecret: "EXISTING" });
    await expect(setupTwoFactor("user")).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  test("a concurrent enable cannot be overwritten by a stale setup request", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "user", username: "member", twoFactorEnabled: false });
    prisma.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(setupTwoFactor("user")).rejects.toMatchObject({ statusCode: 409 });
  });

  test("a disabled account can begin setup normally", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "user", username: "member", twoFactorEnabled: false });
    await expect(setupTwoFactor("user")).resolves.toEqual({ secret: "NEWSECRET", qrCodeDataUrl: "data:image/png;base64,test" });
  });
});

function response() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe("Session middleware without sockets", () => {
  test.each(["2fa-pending", "password-reset", "unknown", ""])("rejects purpose %p before any account lookup", async (purpose) => {
    const token = generateShortLivedToken({ id: "user", purpose }, "5m");
    for (const source of ["bearer", "cookie"]) {
      const req = source === "bearer" ? { headers: { authorization: `Bearer ${token}` } } : { headers: {}, cookies: { token } };
      const res = response();
      const next = jest.fn();
      await authenticate(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    }
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  test.each([{}, { tokenType: "session" }])("accepts a valid legacy or explicit session: %p", async (claims) => {
    const req = { headers: { authorization: `Bearer ${generateToken({ id: "user", tokenVersion: 0, ...claims })}` } };
    const next = jest.fn();
    await authenticate(req, response(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.id).toBe("user");
  });

  test("a session tag cannot override a special purpose or an unknown token type", async () => {
    for (const claims of [{ tokenType: "session", purpose: "2fa-pending" }, { tokenType: "other" }]) {
      const res = response();
      const next = jest.fn();
      await authenticate({ headers: { authorization: `Bearer ${generateToken({ id: "user", tokenVersion: 0, ...claims })}` } }, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    }
  });

  test("legacy and tagged sessions still require the current token version", async () => {
    prisma.user.findUnique.mockResolvedValue({ tokenVersion: 1 });
    for (const claims of [{}, { tokenType: "session" }]) {
      const res = response();
      const next = jest.fn();
      await authenticate({ headers: { authorization: `Bearer ${generateToken({ id: "user", tokenVersion: 0, ...claims })}` } }, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    }
  });

  test("both password login and completed 2FA issue explicitly tagged sessions", async () => {
    const user = { id: "user", username: "member", role: "EMPLOYEE", tokenVersion: 0, passwordHash: "hash", businessUsers: [], ownedBusinesses: [] };
    prisma.user.findUnique.mockResolvedValue(user);
    expect(verifyToken((await loginUser({ username: "member", password: "password" })).token).tokenType).toBe("session");
    prisma.user.findUnique.mockResolvedValue({ ...user, twoFactorEnabled: true, twoFactorSecret: "secret" });
    const pending = await loginUser({ username: "member", password: "password" });
    expect(pending.requires2FA).toBe(true);
    expect(verifyToken(pending.tempToken).purpose).toBe("2fa-pending");
    const completed = await verifyLoginTwoFactor(pending.tempToken, "123456");
    expect(verifyToken(completed.token).tokenType).toBe("session");
  });
});

describe("Cost response shaping without sockets", () => {
  test("only manager business roles reveal costs; shaping preserves stored snapshots", () => {
    expect(canViewCostPrice("SUPERADMIN")).toBe(true);
    expect(canViewCostPrice("ADMIN")).toBe(true);
    expect(canViewCostPrice("EMPLOYEE")).toBe(false);
    expect(canViewCostPrice(undefined)).toBe(false);
    const original = { items: [{ id: "item", costPrice: 12, subtotal: 100 }] };
    expect(withTransactionCostVisibility(original).items[0]).toEqual({ id: "item", subtotal: 100 });
    expect(original.items[0].costPrice).toBe(12);
    expect(withTransactionCostVisibility(original, { includeCostPrice: true }).items[0].costPrice).toBe(12);
    expect(stripItemCostPrice({ id: "item", costPrice: null })).toEqual({ id: "item" });
  });

  test.each(["create", "list", "detail", "payment", "undo", "return", "customer"])("%s service responses hide costs by default and retain them for managers", async (operation) => {
    const sale = {
      id: "sale", businessId: "business", warehouseId: "warehouse", totalAmount: 100, paymentMethod: "CREDIT", paidAt: null,
      items: [{ id: "item", productId: "product", costPrice: 12, quantitySold: 5, subtotal: 100 }],
      payments: [{ id: "payment", amount: 20 }], returns: [],
    };
    prisma.$transaction.mockImplementation((fn) => fn(prisma));
    prisma.$queryRaw.mockResolvedValue([{ id: "sale" }]);
    prisma.transaction.findFirst.mockResolvedValue(sale);
    prisma.transaction.findMany.mockResolvedValue([sale]);
    prisma.transaction.count.mockResolvedValue(1);
    prisma.transaction.create.mockResolvedValue(sale);
    prisma.transaction.update.mockResolvedValue(sale);
    prisma.warehouse.findFirst.mockResolvedValue({ id: "warehouse" });
    prisma.product.findFirst.mockResolvedValue({ id: "product", name: "Rice", unit: "pcs", costPrice: 12 });
    prisma.warehouseStock.updateMany.mockResolvedValue({ count: 1 });
    prisma.return.create.mockResolvedValue({ id: "return" });
    prisma.customer.findFirst.mockResolvedValue({ id: "customer", transactions: [sale] });
    const calls = {
      create: (options) => transactions.createTransaction({ businessId: "business", performedById: "user", paymentMethod: "CASH", items: [{ productId: "product", quantitySold: 5, unitPrice: 20 }] }, options),
      list: async (options) => (await transactions.getTransactions({ businessId: "business" }, options)).transactions[0],
      detail: (options) => transactions.getTransactionById("sale", "business", options),
      payment: (options) => transactions.recordCreditPayment("sale", "business", { amount: 10, recordedById: "user" }, options),
      undo: (options) => transactions.undoCreditPayment("sale", "payment", "business", "user", options),
      return: (options) => transactions.createReturn("sale", "business", { items: [{ transactionItemId: "item", quantityReturned: 1 }], refundMethod: "CREDIT_BALANCE", processedById: "user" }, options),
      customer: async (options) => (await getCustomerById("customer", "business", options)).transactions[0],
    };
    expect((await calls[operation]()).items[0]).not.toHaveProperty("costPrice");
    expect((await calls[operation]({ includeCostPrice: true })).items[0].costPrice).toBe(12);
    expect(sale.items[0].costPrice).toBe(12);
  });
});
