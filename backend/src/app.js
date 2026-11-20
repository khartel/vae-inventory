/**
 * Express app setup and middleware/route-mounting pipeline.
 *
 * Order of concerns, top to bottom:
 *  1. Request logging (every request is logged to the console).
 *  2. Security headers (helmet) and CORS (must run before rate limiting so
 *     rate-limited/blocked responses still carry CORS headers).
 *  3. Rate limiting (a general API limiter plus stricter ones for login and forgot-password).
 *  4. Body/cookie parsing.
 *  5. Route mounting (auth, business, warehouse, team, product, customer,
 *     stock, transaction, report, audit-log, and platform/superadmin routers).
 *  6. Health check endpoint.
 *  7. 404 fallback handler.
 *  8. Global error handler (must be registered last).
 *
 * This module only builds and exports the configured `app`; it does not
 * call `app.listen()` (that's expected to live in the server entry point).
 */
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const pinoHttp = require("pino-http");
const logger = require("./utils/logger");

// Routes
const authRoutes = require("./routes/auth.routes");
const businessRoutes = require("./routes/business.routes");
const warehouseRoutes = require("./routes/warehouse.routes");
const teamRoutes = require("./routes/team.routes");
const productRoutes = require("./routes/product.routes");
const customerRoutes = require("./routes/customer.routes");
const stockRoutes = require("./routes/stock.routes");
const transactionRoutes = require("./routes/transaction.routes");
const reportRoutes = require("./routes/report.routes");
const auditLogRoutes = require("./routes/audit-log.routes");
const purchaseRoutes = require("./routes/purchase.routes");
const platformRoutes = require("./routes/superadmin.routes");

const app = express();

// Trust the first reverse-proxy hop (Render / Vercel rewrite proxy) so
// req.ip reflects the real client IP for rate limiting instead of collapsing
// all users behind one proxy IP or tripping express-rate-limit v8's
// X-Forwarded-For check.
app.set("trust proxy", 1);

// ─────────────────────────────────────────
// REQUEST LOGGER
// ─────────────────────────────────────────
// Structured method/url/status/responseTime/request-id logs for every
// request, at "info" level (quieter "debug"-level details - headers etc -
// are available via LOG_LEVEL=debug since pino-http logs those too).
app.use(pinoHttp({ logger }));

// ─────────────────────────────────────────
// SECURITY MIDDLEWARE
// ─────────────────────────────────────────
app.use(helmet());

// CORS must run before the rate limiters (and everything else) so that
// 429/404/error responses still carry Access-Control-Allow-Origin — otherwise
// a rate-limited browser request surfaces as an opaque "CORS blocked" error
// instead of the actual "too many requests" message.
// CLIENT_URL can be a single origin or a comma-separated list (e.g. for
// staging + production). In development, any localhost/127.0.0.1 port is
// also allowed so the frontend dev server can bind to a fallback port
// (Vite auto-increments) without breaking API calls.
const configuredOrigins = (process.env.CLIENT_URL || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const isLocalDevOrigin = (origin) =>
  process.env.NODE_ENV !== "production" && /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    if (configuredOrigins.includes(origin) || isLocalDevOrigin(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked: ${origin}`));
    }
  },
  credentials: true,
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests, please try again later.",
});
app.use("/api", limiter);

// Stricter limiter specifically for login, to slow down credential brute-forcing
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many login attempts. Please try again later.",
  skipSuccessfulRequests: true,
});
app.use("/api/auth/login", loginLimiter);

// Stricter limiter for forgot-password, to protect against inbox-spamming
// abuse and to stay well under Brevo's own sending quota.
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Too many password reset requests. Please try again later.",
});
app.use("/api/auth/forgot-password", forgotPasswordLimiter);

// ─────────────────────────────────────────
// GENERAL MIDDLEWARE
// ─────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ─────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/businesses", businessRoutes);
app.use("/api/businesses/:businessId/warehouses", warehouseRoutes);
app.use("/api/businesses/:businessId/team", teamRoutes);
app.use("/api/businesses/:businessId/products", productRoutes);
app.use("/api/businesses/:businessId/customers", customerRoutes);
app.use("/api/businesses/:businessId/stock", stockRoutes);
app.use("/api/businesses/:businessId/transactions", transactionRoutes);
app.use("/api/businesses/:businessId/reports", reportRoutes);
app.use("/api/businesses/:businessId/audit-log", auditLogRoutes);
app.use("/api/businesses/:businessId/purchasing", purchaseRoutes);
app.use("/api/platform", platformRoutes);

// ─────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────
// Simple liveness probe endpoint (used by uptime monitors / deploy checks).
app.get("/api/health", (req, res) => {
  res.json({ success: true, message: "Server is running" });
});

// ─────────────────────────────────────────
// 404 HANDLER
// ─────────────────────────────────────────
// Catches any request that didn't match a mounted route above.
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// ─────────────────────────────────────────
// GLOBAL ERROR HANDLER
// ─────────────────────────────────────────
// Express recognizes this as an error handler because it takes 4 args.
// AppError instances (isOperational = true) surface their own status code
// and message to the client; anything else is treated as an unexpected
// bug - logged server-side and reported to the client as a generic 500
// so internal details aren't leaked.
app.use((err, req, res, next) => {
  const statusCode = err.isOperational ? err.statusCode : 500;
  const message = err.isOperational ? err.message : "Internal server error";
  const context = { err, reqId: req.id, method: req.method, path: req.path, userId: req.user?.id };

  if (!err.isOperational) {
    logger.error(context, err.message);
  } else {
    logger.debug(context, err.message);
  }

  res.status(statusCode).json({
    success: false,
    message,
    errors: err.errors || null,
  });
});

module.exports = app;