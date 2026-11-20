# Current backlog

Latest work: Reports redesign (2026-11-13), completed locally with build, regression and responsive browser checks. PDF generation is verified; saving a PDF in the preview browser remains unconfirmed. See `completed.md` for details. Previous receipt-print output also awaits the user's browser check; expanded countries, Pocket Register and purchasing are recorded there.

Last reviewed: 2026-11-13. Grouped by phase — see `phases/` for the full context on each. Phases A–D have no open items. There are now two independent, parallel tracks: **Phase E** (finish deploying what's already built) and **Phases G–K** (a new feature-development track from the ecommerce-benchmark gap analysis, `gap-analysis-2026-08.md`). Neither blocks the other.

## Phases G–K — New feature track (from the 2026-08-07 gap analysis)

Recommended order (see each phase file for the full reasoning and dependencies):

1. [x] **Phase G — Profitability & cost tracking** (`phases/phase-g-profitability-cost-tracking.md`) — **done 2026-08-16**, see `completed.md`. Cost price now exists on every product and flows through to a Profit figure across Reports, gated to SuperAdmin/Admin.
2. [ ] **Phase H — Barcode scanning** (`phases/phase-h-barcode-scanning.md`). Deferred — not every business has a scanner; picked up again once Phase J/K or a real usability complaint makes it the priority.
3. [x] **Phase I — Returns & stock adjustments** (`phases/phase-i-returns-stock-adjustments.md`) — **done 2026-08-16**, see `completed.md`. Sale returns (cash refund or credit-balance reduction) and cycle-count stock adjustments, both with a proper audit trail. Reports deliberately not netted for returns yet — Victor's call, revisit later.
4. [x] **Phase J — Purchasing & supplier management** (`phases/phase-j-purchasing-suppliers.md`) — **done locally 2026-11-12**. Suppliers, draft/ordered/partially received/received/cancelled purchase orders, receipt history, lead time, and latest-received-cost updates. Migration applied to local dev/test databases; deployment still needs the migration and a backend restart.
5. [ ] **Phase K — Smart reorder suggestions** (`phases/phase-k-smart-reorder-forecasting.md`). Phase J now records supplier/order lead times; still needs enough real sales history before useful reorder suggestions can be built.

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

- [x] Delete the dead empty `backend/src/socket/` directory (leftover from the removed `socket.io` dependency) — done 2026-11-20.
- [ ] Continue frontend integration coverage beyond Login, Dashboard, Sales, Reports, Pocket Register, and the shared phone/country picker + supplier creation (covered now). Purchase forms have live-browser verification; expand their automated component coverage opportunistically.
- [ ] Add `compression` middleware to the backend — cheap, not yet done.
- [ ] Extend pagination to products/warehouses/team/stock-movements lists once any of them grow past a page or two in real use. Not needed at current data volumes.

## Explicitly not on this list

Everything from the original "Known issues" review (2026-07-24) and every feature request through 2026-08-05 is done — see `completed.md`. Don't re-derive a backlog from the old known-issues sections; they're historical, not current.
