# VAE Inventory

A multi-business inventory and sales management tool — built so a small business owner (and their staff) can track stock, record sales, manage warehouses, and see reports across one or more businesses from a single login.

> **Working on this project?** Read [`projects_roadmap/instructions.md`](./projects_roadmap/instructions.md) first, then [`projects_roadmap/phase-00-analysis.md`](./projects_roadmap/phase-00-analysis.md) and [`projects_roadmap/todo.md`](./projects_roadmap/todo.md) — that folder is the living record of architecture decisions, what's been built, what's known-broken, and what's next. This README only covers "how do I run it."

## Stack

| Layer | Tech |
|---|---|
| Backend | Node.js, Express 5, Prisma 7 (Postgres), JWT auth (httpOnly cookie), zod validation |
| Frontend | React 19, TypeScript, Vite, React Router, TanStack Query, Tailwind CSS v4, shadcn/ui |
| Database | PostgreSQL |
| Tests | Jest + Supertest (backend, against a dedicated test database) |

## Project structure

```
business_webapp/
├── backend/            Express API (routes → controllers → services → Prisma)
├── frontend/           React app (Vite + TypeScript)
└── projects_roadmap/   Project context, decisions, and phase-by-phase status
```

## Prerequisites

- Node.js 20+
- PostgreSQL 14+ running locally (or a connection string to a remote instance)

## Getting started

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env` and set:
- `DATABASE_URL` — your Postgres connection string
- `JWT_SECRET` / `MASTER_KEY` — generate strong random values, e.g.:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```

Then create the database schema and start the API:

```bash
npx prisma migrate dev
npm run dev          # starts on http://localhost:5000
```

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env   # defaults to http://localhost:5000/api, which matches the backend above
npm run dev             # starts on http://localhost:5173
```

Open `http://localhost:5173` — it redirects to `/login`. Use `/register` to create the first SuperAdmin account (registration is currently open; every account created this way starts as a business owner).

## Backend scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the API with auto-reload (nodemon) |
| `npm start` | Start the API (no auto-reload) |
| `npm run prisma:migrate` | Create/apply a migration against your dev database |
| `npm run prisma:studio` | Open Prisma Studio (visual DB browser) |
| `npm test` | Run the backend test suite against a dedicated `*_test` database (never your dev data) — see below |

### Running backend tests

Tests use their own database so they can never touch real data. One-time setup:

```bash
# create the test database (adjust connection details as needed)
psql -U postgres -c "CREATE DATABASE business_webapp_test"
cp .env.example .env.test
```

Then edit `.env.test`: point `DATABASE_URL` at `business_webapp_test` and set `NODE_ENV=test`. Use different (dummy is fine) `JWT_SECRET`/`MASTER_KEY` values from your real `.env`. Then:

```bash
npm run test:migrate        # applies migrations to the test database
```

Then, any time:

```bash
npm test
```

`tests/setup.js` refuses to run unless `DATABASE_URL` points at a database ending in `_test`, as a safety rail.

## Frontend scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Type-check and build for production (output in `dist/`) |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run the linter |

## Master key / platform admin

`backend/.env`'s `MASTER_KEY` gates a small set of developer/ops-only endpoints under `/api/platform/*` (list, delete, or reset the password of SuperAdmin accounts) — this is for you as the developer to support the business owner, not something end users interact with. Keep it secret and rotate it before any real deployment.

## Current status

Backend and frontend are both feature-complete for the app's current scope (Products, Warehouses, Stock, POS/Sales, Team, Reports, Customers/Credit, Settings) and hardened (auth, IDOR fixes, soft-delete/audit trail, structured logging, tested). A free-tier demo deployment (Vercel + Render + Neon) is live for real-world testing. The only open phase is production deployment/ops (Docker, CI, staging, monitoring, and the long-term hosting decision) — see [`projects_roadmap/todo.md`](./projects_roadmap/todo.md). Full detail, decisions, and the phase-by-phase plan live in [`projects_roadmap/`](./projects_roadmap/).
