# Architecture decision records

Chronological. Each entry: context → decision → consequences. Treat these as settled unless Victor says otherwise — if you're about to contradict one, flag it and confirm rather than silently overriding it.

---

## ADR-1: Scale target is small — no Redis/queues/microservices by default (2026-07-24)

**Context**: Initial architecture review had to decide how much production-checklist machinery to apply.
**Decision**: This serves a few small businesses with a handful of staff each, run by one family. Do not introduce Redis, message queues, microservices, or multi-region infrastructure by default.
**Consequences**: Every later architecture decision in `architecture.md` is filtered through this. Revisit only if real usage genuinely outgrows a single small Postgres + single app instance — not preemptively.

## ADR-2: Plan fully before coding, phase by phase (2026-07-24)

**Context**: A full rewrite/hardening pass was starting from a rough existing codebase.
**Decision**: Target architecture and a phased roadmap are written and approved before implementation starts; implementation proceeds one phase at a time.
**Consequences**: This is the origin of the Phase A–F structure still in use (`phases/`). New large bodies of work should generally still get a plan reviewed before building, per `instructions.md`.

## ADR-3: TypeScript for the frontend (2026-07-24)

**Context**: Frontend was being rebuilt from scratch (Phase B).
**Decision**: TypeScript, Victor's explicit call — better autocomplete/error-catching while learning, and shadcn/ui is TS-first.
**Consequences**: All frontend code is typed; `tsc -b` clean is part of the verification bar for every batch of work.

## ADR-4: JWT + httpOnly cookie only, no refresh-token rotation (Phase A, 2026-07-24)

**Context**: Original design echoed the JWT in the JSON login response too, readable by frontend JS.
**Decision**: Token lives only in an httpOnly, `sameSite=strict` cookie. No refresh-token rotation or per-session revocation granularity — a 24h/30d token with logout-triggered `tokenVersion` revocation (added 2026-07-31) is accepted as sufficient at this scale.
**Consequences**: Removes the token from any XSS-reachable surface. Logout/password-reset revoke *every* session at once, not just one device — documented as an accepted tradeoff, not a bug. Revisit only if the trust model changes materially.

## ADR-5: Business-picker + POS as the post-login home screen (2026-07-25)

**Context**: Phase C's original Sales/Transactions list+dialog didn't match how Victor's dad actually wants to work — like a real cash register.
**Decision**: `/` is always a business-picker (every role, every login); selecting a business lands on `/pos`, a genuine cash-register-style screen, replacing Sales/Transactions entirely.
**Consequences**: This is the current IA and shouldn't be second-guessed without a specific new request — it was deliberately chosen over alternatives (e.g. a dashboard-first landing) after discussion.

## ADR-6: Glassmorphic design language, applied via shared primitives (2026-07-25)

**Context**: Victor wanted a "high end, modern, slick" visual bar, discovered only after the first Phase C build shipped.
**Decision**: Extend the existing glass language app-wide (translucent blurred `Card`/`Dialog` surfaces, near-black dark mode) by modifying shared components (`Card`, `Dialog`, `Tabs`, `PageHeader`) rather than rebuilding each screen individually.
**Consequences**: Most visual reworks in this project's history landed as small, high-leverage changes to a handful of components. Keep doing this — a new screen should extend the shared primitives, not invent its own visual treatment.

## ADR-7: Soft-delete scoped to Product/Customer/Warehouse only (2026-08-01)

**Context**: Hard deletes cascaded through the whole schema with no recovery path or audit trail.
**Decision**: Add `deletedAt` to Product, Customer, and Warehouse specifically — not Business (owner might want to fully close one down) and not team-member removal (both stay deliberate, hard actions).
**Consequences**: Don't add soft-delete to every table reflexively. If a new entity seems to need it, make the same explicit case (does losing it destroy referenced history?) before adding the column.

## ADR-8: Internal-only structured logging, no external error-tracking service (2026-08-01)

**Context**: The backend had essentially no logging (3 bare `console.log` calls total).
**Decision**: `pino` structured logging, but no Sentry (or equivalent) — Victor's explicit cost/no-new-accounts choice.
**Consequences**: Production exceptions are only as visible as whatever's capturing the host's log output. Tracked as an open item in `todo.md`/`architecture.md`, not silently "fixed" by adding Sentry without revisiting this decision first.

## ADR-9: CSV export from already-fetched data, PDF as an accepted new dependency (2026-07-26)

**Context**: Nothing in the app was downloadable; Victor wanted both CSV and PDF everywhere.
**Decision**: CSV built client-side from data the page already fetched (no new backend endpoints). PDF: discussed the tradeoff directly (a `jspdf` dependency for one-click parity vs. reusing the receipt's print-dialog trick with no new dependency) — Victor chose the dependency.
**Consequences**: Reports/Stock Movements exports are a frontend-only concern; a new report tab should follow the same "build from what's already fetched" pattern rather than adding a dedicated export endpoint.

## ADR-10: i18n key convention — source English text as the key (2026-07-30)

**Context**: ~150 files needed translation wrapping; needed one convention ~100 files' worth of edits could agree on without coordination overhead.
**Decision**: `t("Exact English Sentence")` — the English string itself is the i18next key. Missing French entries fall back to the English text via `defaultValue`, never a blank string or crash.
**Consequences**: Adding a new user-facing string anywhere just means wrapping it in `t()` — no separate key-naming step. Don't invent a parallel `t("some.nested.key")` scheme for new code; stay consistent with what's already there.

## ADR-11: Reset token is a stateless JWT, not single-use-tracked; rate limiting is per-IP (2026-08-01)

**Context**: Building self-service password reset raised the question of a single-use token store.
**Decision**: No DB table tracking used tokens — the 30-minute-lived JWT simply remains valid for its own window even after one successful reset. Rate limiting on `/forgot-password` is per-IP via `express-rate-limit`, not per-target-email.
**Consequences**: Accepted, documented risk at this scale — someone could in principle reset twice inside the same 30-minute window, and the rate limit doesn't fully stop multi-IP inbox spam. Not worth solving at this project's size; revisit only if abuse is actually observed.

## ADR-12: Low-stock alerts are a live, read-time-resolved rule, not a write-time default (2026-08-05)

**Context**: `WarehouseStock.lowStockThreshold` existed but defaulted to a flat hardcoded `10` and was never exposed in any UI. Victor wanted a general per-unit rule (e.g. "pcs below 50") settable once, in Settings, that applies to everything using that unit.
**Decision**: `Business.defaultLowStockThreshold` + `lowStockThresholdsByUnit` (a `{unit: threshold}` map), resolved against a stock row's nullable per-product override **at read time**, not baked in at restock time.
**Consequences**: Editing the Settings rule retroactively re-flags every existing product using that unit, with zero per-product edits — this is the entire point of the design. Any future "business-wide rule that should apply to existing data" should follow this same read-time-resolution pattern rather than a one-time default.

## ADR-13: Hosting — self-host at work first, deferred; free-tier cloud demo stood up instead for testing (2026-08-01, amended 2026-08-06)

**Context (2026-08-01)**: Phase E's original plan (written 2026-07-24) assumed a cloud PaaS from day one. Victor decided to self-host on an existing work server for roughly the first year instead, then migrate to a real online host later — low-risk, low-cost way to prove the app in daily use before committing to hosting costs.

**Amendment (2026-08-06)**: Victor's dad wanted to test the app now, well ahead of that self-host timeline. Rather than wait or rush the self-host setup, a temporary free-tier cloud deployment was stood up instead — Vercel + Render + Neon (see `completed.md`, "Free-tier demo deployment"). This is explicitly a testing/demo deployment, **not** a reversal of the self-host decision.

**Decision**: The long-term production hosting path (self-host vs. staying cloud vs. hybrid) remains genuinely open, to be decided after Victor's dad's testing feedback. The current free-tier deployment should not be treated as permanent infrastructure — see `architecture.md`'s Infrastructure section and `todo.md`.
**Consequences**: Don't build backup/monitoring/CI automation specifically tied to Render/Neon as if they're permanent until this decision is revisited. Docker Compose (still on `todo.md`) is useful regardless of which path is eventually chosen, and shouldn't wait on this decision.

## ADR-14: Vercel proxy rewrite over `sameSite=none`, to keep the session cookie working across Vercel/Render (2026-08-06)

**Context**: The demo deployment splits frontend (Vercel) and backend (Render) across different domains. The session cookie is `sameSite=strict` (ADR-4), which only works same-domain — cross-domain, the browser would never send it back, silently breaking login.
**Decision**: Rather than weaken the cookie to `sameSite=none` + `secure` (which would additionally require third-party-cookie support — Safari/iOS blocks this by default, a real risk for this app's actual user base), proxy `/api/*` through Vercel to the Render backend (`frontend/vercel.json`) so the browser only ever sees one origin.
**Consequences**: No code change to `sameSite` was needed, no cookie-security weakening. Any future domain-split hosting arrangement should default to this proxy pattern first, before considering `sameSite=none`.

## ADR-15: Neon over Render's own free Postgres, for the demo deployment (2026-08-06)

**Context**: Render's free-tier Postgres expires 30 days after creation and then requires a paid plan — a real risk of Victor's dad's testing period getting interrupted mid-way.
**Decision**: Use Neon's free tier (no such expiry) for the demo deployment's database instead.
**Consequences**: The demo's database is decoupled from Render specifically — relevant if/when the hosting decision (ADR-13) changes the backend host but keeps the database, or vice versa.

## ADR-17: Credit sales require a strict pick from the customer directory, not free text (2026-08-07)

**Context**: `createTransaction` used to auto-create a lightweight `Customer` from whatever name was typed, for every payment method including CREDIT — meaning credit could be extended to a name with no other record.
**Decision**: A Credit sale must reference a real `customerId`, resolved by the cashier clicking an actual search result (`CreditCustomerPicker.tsx`), never by name-matching alone. If no match exists, checkout is blocked; SUPERADMIN/ADMIN cashiers get an inline shortcut to add the customer on the spot (still going through the same permission-gated `POST .../customers` endpoint), EMPLOYEE cashiers are told to ask a manager.
**Consequences**: Every credit sale is traceable to a real, addressable customer record from the moment it's created. This also motivated ADR-18 (phone+address required) — a "known customer" needs to actually be locatable, not just named.

## ADR-18: Customer phone and address are required fields (2026-08-07)

**Context**: `Customer.phone` was optional and there was no `address` field at all — fine when customers were auto-created from a bare typed name (ADR from 2026-07-25), but insufficient once ADR-17 made the directory the sole gate for extending credit.
**Decision**: Both fields are required at the schema level (backfilled for the small amount of existing test data — see `completed.md`) and enforced by validators on create; on edit, they're optional-if-provided (partial update), not force-resubmitted every time.
**Consequences**: Combined with ADR-17, this closes the loop — credit can only go to someone the business can actually reach and locate.

## ADR-19: Country-flag phone input (`react-phone-number-input`), applied to every phone field in the app (2026-08-07)

**Context**: Every phone field in the app was a plain text input with inconsistent, weak validation (`min(7)` on some, nothing on others).
**Decision**: One shared component (`components/ui/phone-input.tsx`) wrapping `react-phone-number-input`, applied to all six phone fields (Customer, Register signup, Team member, Business create/edit, Settings profile) — not just the new Customer field, per Victor's explicit "every phone field" scope choice. Validation (`isValidPhoneNumber`, from the same underlying `libphonenumber-js` library on both frontend and backend) replaced every ad hoc length check.
**Consequences**: Any future phone field should reuse this component and validator rather than a plain `Input` — the inconsistency this replaced (some required, some not, none actually validated) shouldn't reappear piecemeal.

## ADR-21: Ecommerce-inventory-software feature checklist evaluated, adopted selectively (2026-08-07)

**Context**: Victor shared a general ecommerce-inventory-management feature checklist plus Fishbowl's blog post, asking where VAE Inventory falls short of "the best in the world" and wanting a plan to close the gap.
**Decision**: Full analysis in `gap-analysis-2026-08.md`. Most of that checklist targets multi-channel ecommerce sellers, manufacturers, and 3PL warehouses — business shapes VAE Inventory's actual users (a small, in-person, physical retail/wholesale shop) don't have. Explicitly **not adopted**: multi-channel sync (Shopify/Amazon/eBay), 3PL/shipping/carrier integration, manufacturing (BOM/work orders/MRP), EDI. The genuinely transferable core — cost/profitability tracking, barcode scanning, returns/stock-adjustment workflows, supplier/purchase-order management, and sales-velocity-based reorder suggestions — was scoped into new Phases G through K.
**Consequences**: A future session (or a future pasted feature list from elsewhere on the web) should run through the same filter — "does this solve a problem VAE Inventory's actual users have?" — before adding a phase for it, rather than treating a generic SaaS feature checklist as a requirements document. This is the same discipline ADR-1 already established for infrastructure; this ADR extends it to product features.

## ADR-20: GitHub repo and Vercel project renamed to `vae-inventory` (2026-08-06)

**Context**: Repo was still named `Business_WebApp` (a placeholder name); Victor wanted the live demo URL to read `vae-inventory.vercel.app`.
**Decision**: Renamed the GitHub repo `khartel/Business_WebApp` → `khartel/vae-inventory` (GitHub's automatic redirect keeps old links working); local `origin` remote updated to match; Vercel project named `vae-inventory` to match on import.
**Consequences**: Any documentation or tooling referencing the old repo name/URL should be treated as stale if found — this migration (`projects_roadmap/`, `README.md`) is itself part of cleaning that up.
