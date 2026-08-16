# Current backlog

Last reviewed: 2026-08-16. Grouped by phase — see `phases/` for the full context on each. Phases A–D have no open items. There are now two independent, parallel tracks: **Phase E** (finish deploying what's already built) and **Phases G–K** (a new feature-development track from the ecommerce-benchmark gap analysis, `gap-analysis-2026-08.md`). Neither blocks the other.

## Phases G–K — New feature track (from the 2026-08-07 gap analysis)

Recommended order (see each phase file for the full reasoning and dependencies):

1. [x] **Phase G — Profitability & cost tracking** (`phases/phase-g-profitability-cost-tracking.md`) — **done 2026-08-16**, see `completed.md`. Cost price now exists on every product and flows through to a Profit figure across Reports, gated to SuperAdmin/Admin.
2. [ ] **Phase H — Barcode scanning** (`phases/phase-h-barcode-scanning.md`). Independent of Phase G — biggest day-to-day usability win for the cashier at the register.
3. [ ] **Phase I — Returns & stock adjustments** (`phases/phase-i-returns-stock-adjustments.md`). Two routine physical-retail operations (returns, cycle-count reconciliation) that don't exist yet.
4. [ ] **Phase J — Purchasing & supplier management** (`phases/phase-j-purchasing-suppliers.md`). Now unblocked (Phase G's cost data exists) — real purchase orders should feed `Product.costPrice` rather than it only ever being hand-typed.
5. [ ] **Phase K — Smart reorder suggestions** (`phases/phase-k-smart-reorder-forecasting.md`). Deliberately last — needs Phase J (supplier lead times) plus enough real sales history to exist in the first place.

Also flagged in the gap analysis but **not yet phased, revisit later**: offline-resilient POS (a real engineering investment, worth doing once G–K land and the Phase E hosting decision is settled). Explicitly **not planned** unless the business model changes: multi-channel ecommerce sync (Shopify/Amazon/eBay), manufacturing (BOM/work orders), 3PL/shipping, EDI, accounting-software integration — see `gap-analysis-2026-08.md` for why each doesn't apply to VAE Inventory's actual business today.

## Phase E — Deployment & Ops (the only phase with open work in the original A–F sequence)

- [ ] **Decide the real long-term hosting path**, once Victor's dad has tested the current free-tier demo (Vercel + Render + Neon) — self-host at work (original plan) vs. staying on a paid cloud tier vs. a hybrid. See `decisions.md`. Nothing below this line should be over-invested-in until this is decided, since some of it (backup strategy, monitoring target) depends on the answer.
- [ ] Dockerize the backend (`Dockerfile` + `docker-compose.yml` with Postgres for local dev) — useful regardless of the hosting decision above.
- [ ] CI pipeline (GitHub Actions: lint + backend Jest + frontend Vitest + Prisma migration-diff check on every PR).
- [ ] Staging environment, separate DB, once the real production host is chosen.
- [ ] Extend `/api/health` to a real DB connectivity check (`SELECT 1`), so uptime monitoring means something.
- [ ] Uptime monitoring (UptimeRobot free tier or equivalent) once there's a real production URL to watch.
- [ ] Backup policy for the real production database (nightly dump to object storage, retained ~30 days, or the equivalent managed feature) — depends on the hosting decision.
- [ ] Rotate `JWT_SECRET`/`MASTER_KEY` to fresh values before treating any deployment as real production (the current values were generated for the free-tier demo).
- [ ] Decide whether `POST /api/auth/register` should become invite-only before any wider real-world exposure (currently open registration — fine while the only users are Victor's dad's businesses).

## Small, non-blocking niceties

- [ ] Delete the dead empty `backend/src/socket/` directory (leftover from the removed `socket.io` dependency).
- [ ] Extend frontend test coverage past `Login` — no other page has a component-level integration test yet (pure-logic unit tests exist for units/permissions/format). Not urgent; grow opportunistically.
- [ ] Add `compression` middleware to the backend — cheap, not yet done.
- [ ] Extend pagination to products/warehouses/team/stock-movements lists once any of them grow past a page or two in real use. Not needed at current data volumes.

## Explicitly not on this list

Everything from the original "Known issues" review (2026-07-24) and every feature request through 2026-08-05 is done — see `completed.md`. Don't re-derive a backlog from the old known-issues sections; they're historical, not current.
