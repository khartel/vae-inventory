/**
 * Shared structured logger. Pretty-printed to the console in development,
 * raw JSON in production (so it can be piped into a log aggregator later
 * without any code changes here). Level is configurable via LOG_LEVEL
 * (default "info"); use "debug" locally to also see the operational-error
 * traces logged by the global error handler in app.js.
 */
const pino = require("pino");

const isProduction = process.env.NODE_ENV === "production";

// Never write session JWTs, bearer tokens, or the platform master key to logs.
const REDACT_PATHS = [
  "req.headers.cookie",
  "req.headers.authorization",
  'req.headers["x-master-key"]',
  'res.headers["set-cookie"]',
];

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: REDACT_PATHS,
    censor: "[Redacted]",
  },
  transport: isProduction
    ? undefined
    : {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
      },
});

logger.REDACT_PATHS = REDACT_PATHS;

module.exports = logger;
