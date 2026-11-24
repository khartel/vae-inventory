const { Client } = require("pg");
const { sendSuccess, sendError } = require("./response.utils");

const READINESS_TIMEOUT_MS = 3000;

// Keep liveness independent of the database and preserve its existing payload.
const liveness = (req, res) => res.json({ success: true, message: "Server is running" });

const readiness = async (req, res) => {
  // A dedicated, short-lived client lets us close an expired probe without
  // changing the main Prisma pool or leaving an uncancelled query in it.
  let client;
  let timeout;

  try {
    client = new Client({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: READINESS_TIMEOUT_MS,
      query_timeout: READINESS_TIMEOUT_MS,
      statement_timeout: READINESS_TIMEOUT_MS,
      application_name: "inventory-readiness",
    });
    const deadline = new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("Database readiness timed out")), READINESS_TIMEOUT_MS);
    });
    const probe = new Promise((resolve, reject) => {
      // Also handle connection-level errors between queries and during teardown.
      client.on("error", reject);
      client.connect().then(() => client.query("SELECT 1")).then(resolve, reject);
    });
    await Promise.race([probe, deadline]);
    return sendSuccess(res, { message: "Database is ready" });
  } catch {
    return sendError(res, { message: "Database is unavailable", statusCode: 503 });
  } finally {
    clearTimeout(timeout);
    // pg terminates an active query when end() closes its connection. Do not
    // extend the HTTP deadline while waiting for the server's close handshake.
    if (client) void client.end().catch(() => {});
  }
};

module.exports = { liveness, readiness };
