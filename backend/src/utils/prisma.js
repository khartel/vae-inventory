/**
 * Shared Prisma Client singleton, backed by a pg connection pool via the
 * PrismaPg driver adapter. Exported as a single instance (rather than
 * constructed per-file) so the whole app reuses one connection pool
 * instead of exhausting the database with a new pool per import.
 */
const { PrismaClient } = require(".prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const pg = require("pg");

// Load env
require("dotenv").config({ quiet: true });

const connectionString = process.env.DATABASE_URL;

const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

module.exports = prisma;