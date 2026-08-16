# Working instructions — read before touching this codebase

> This file replaces the old `ROADMAP.md`'s role as "read this before doing anything else." If you are an AI assistant (or a human) picking up this project cold, read this file, then `phase-00-analysis.md`, then `todo.md`, before making any change.

## Who this project is for

A personal project being built for the owner's father, so he can run inventory + sales tracking for **multiple small businesses** from one login, without needing to be technical himself. Anyone he authorizes (an "employee") should be able to record a sale and have stock/reporting update automatically.

This is **not** a public SaaS product launching to strangers. It's a real tool for a real small business owner and a small number of staff per business. Every recommendation below is right-sized for that scale — correctness, security of one business's data from another, and a UI a non-technical person can use confidently. Do not introduce Kubernetes, microservices, message queues, or multi-region infrastructure by default. Revisit only if real usage genuinely outgrows a single small Postgres instance + single app instance.

See `phase-00-analysis.md` §1 for the full domain model (SuperAdmin/Business/Warehouse/Product/Transaction/etc.).

## Mandatory process before any code change

1. **Read the relevant files in full** before editing them — this project's own history (see `completed.md`) is full of bugs caused by acting on partial context (stale hand-duplicated field lists, assumptions about what a helper already does, etc.). Use whatever full-file-read tooling is available; there is no substitute for reading the actual current code.
2. **Be at least 95% confident** you understand the existing code, the task, and the blast radius of the change before writing anything. If a schema change is involved, read the full `schema.prisma` first — this project has a real production database with real business data in it (Victor's dad's businesses), not just test fixtures.
3. **If anything is unclear, ask.** Do not guess at intent, especially for anything touching money (transactions, credit payments), data isolation (business scoping), or auth. This project's decisions log (`decisions.md`) exists specifically because ambiguous requests were clarified before building, not after.
4. **Update the roadmap immediately after every meaningful change** — not as a follow-up task. Move finished items from `todo.md` into `completed.md` with the same level of detail this project has always used (what changed, why, what broke and how it was found, how it was verified). A stale roadmap actively misleads the next session more than no roadmap at all.

## Engineering conventions established by this project's history

- **Layered backend, no over-abstraction**: `routes/` → `controllers/` (thin, `asyncHandler`-wrapped) → `services/` (business logic + Prisma calls) → `utils/`. No repository layer beyond Prisma itself, no DI container — this is deliberate and correct at this scale. Don't add one.
- **`zod` validates every endpoint boundary** via `validate(schema)` middleware, attaching parsed/coerced input to `req.validatedQuery`/`req.body` (never reassign `req.query` directly — Express 5 makes it a getter-only property; see `completed.md`'s Phase C bug #3).
- **`AppError` + `asyncHandler`** — services throw `AppError(message, statusCode)`, controllers never try/catch, the global error handler in `app.js` formats the response from `err.statusCode`.
- **`sendSuccess`/`sendError` response envelope** — every endpoint returns the same shape. Keep it that way.
- **Soft-delete only where it matters**: `Product`, `Customer`, `Warehouse` have `deletedAt`. `Business` and team-member removal stay hard/deliberate actions — don't add soft-delete everywhere reflexively.
- **Every destructive/administrative action gets an `AuditLog` entry** via `recordAudit()`, inside the same `$transaction` as the action itself where possible. Routine sales/stock activity does not — it already has its own history views.
- **Read-time resolution over write-time defaults** for anything that should be a "live rule" (see the low-stock threshold feature in `completed.md`, 2026-08-05) — if a Settings-level rule should retroactively affect existing data, resolve it at read time, don't bake it in at creation time.
- **One shared source of truth for repeated field lists.** This project has been bitten twice by hand-duplicated field-select lists drifting out of sync (`BUSINESS_SELECT` vs. two separate hand-written copies in `auth.service.js`). When you notice the same list of fields/logic written in more than one place, consolidate before adding a third copy.
- **Fire-and-forget for non-critical async side effects** (transactional email sends) — never `await` something that shouldn't block the HTTP response if it's slow or fails. Use `.catch()` + structured logging, not a blocking `await` in a try/catch.
- **Frontend**: TypeScript, React Hook Form + zod (`z.input`/`z.output` generic split when a schema uses `z.coerce`), TanStack Query, shadcn/ui on Radix primitives. Session auth lives **only** in the httpOnly cookie — never touch or store the token in frontend JS/localStorage.
- **i18n key convention**: every user-facing string is wrapped `t("Exact English Sentence")` — the English text is the key. Don't invent a parallel key-naming scheme. Missing French entries gracefully fall back to English via i18next's `defaultValue`, never a blank string or crash.

## Two schema-change gotchas that have each bitten this project twice

After any `prisma migrate dev` (or hand-edited migration), do both of these before trusting anything works — skipping either produces a confusing failure that looks like a code bug but isn't:

1. **Restart the dev backend process.** `nodemon` watches source files, not `node_modules` — a regenerated Prisma Client on disk is invisible to an already-running process until it's killed and restarted (`Get-NetTCPConnection -LocalPort 5000 -State Listen | Stop-Process`, then `npm run dev` again).
2. **Run `npm run test:migrate`.** The Jest test database (`*_test`) is completely separate from the dev database and does not get migrated automatically — it silently drifts behind, and a test that touches the changed model fails with a real, confusing Prisma error (`Unknown argument`) that has nothing to do with the test itself. This has already caused a test-suite regression to go unnoticed across an entire feature batch before being caught by the next one's test run.

## Verification discipline (non-negotiable for this project)

Every feature batch in this project's history was verified live, not just "should work":

- **Disposable test accounts**, timestamp-suffixed (e.g. `__lowstock_941208__`), cleaned up afterward via the platform-admin API or a direct Prisma script matching the prefix. Victor's real accounts/businesses are read-only reference points during verification, never touched.
- **Playwright walkthroughs** through the real UI against the real running backend — screenshots for visual changes, light + dark mode, mobile viewport where layout is affected.
- **`tsc -b` clean, backend Jest suite passing, frontend Vitest suite passing** before considering a batch done.
- When something can't be verified live (e.g. real email delivery, a specific browser's cookie behavior), say so explicitly rather than claiming it works.

## Git discipline

- **Never commit or push without an explicit instruction to do so**, given in that turn. Prior approval for one commit does not carry forward to the next batch of work.
- Create new commits rather than amending. One meaningful batch of work per commit, with a message explaining *why*, not just *what*.

## Where things live now

- `projects_roadmap/phase-00-analysis.md` — deep architectural analysis (read this for "how does this app actually work").
- `projects_roadmap/gap-analysis-2026-08.md` — comparison against general ecommerce-inventory-software feature checklists, and which of those ideas actually apply to this business (most don't — see ADR-21). Read before proposing a new feature sourced from "what other inventory tools do."
- `projects_roadmap/architecture.md` — target production architecture and the reasoning behind each choice.
- `projects_roadmap/phases/` — one file per phase, in order. All of Phase A–D are done; Phase E (deployment) is partially done (a free-tier test deploy is live — see below); Phase F hasn't started.
- `projects_roadmap/todo.md` — what's actually still open, right now.
- `projects_roadmap/completed.md` — the full historical log (migrated verbatim from the old `ROADMAP.md`, then continued from here).
- `projects_roadmap/decisions.md` — architecture decision records.

## Current deployment note (2026-08-06)

A free-tier demo deployment is live — Vercel (frontend) + Render (backend) + Neon (Postgres) — so Victor's dad can test the app for real. This is explicitly **not** the final production hosting decision (see `decisions.md` "Hosting: free-tier test deploy vs. long-term plan"). Don't treat the current Render/Neon setup as permanent infrastructure to build further automation around until that decision is revisited.
