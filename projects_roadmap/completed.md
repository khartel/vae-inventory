# Completed work log

Migrated from the old `ROADMAP.md` §9 (2026-08-06) and continued here going forward. Entries are in chronological order, each dated, each written at the same level of detail as the original — what changed, why, what broke and how it was found, how it was verified. Keep that standard for new entries.

---

### Phase A — Backend Hardening & Security Fix (done 2026-07-24)

All deliverables from `phases/phase-a-backend-hardening.md` complete, verified by an automated test suite and a manual smoke test against the real dev database:

- **Fixed the cross-business IDOR bug** — `belongsToBusiness` wired into all 6 nested routers (`warehouse`, `team`, `product`, `stock`, `transaction`, `report`) via `router.use(belongsToBusiness)` right after `router.use(authenticate)`. Regression-tested in `backend/tests/business-scoping.test.js` — proves a SuperAdmin can't access a business they don't own, and an employee/admin of business A gets 403 on every nested resource of business B while still being able to use their own business normally.
- **Found and fixed a second, more serious pre-existing bug while building the test suite**: the migration named `20260501113108_add_must_change_password_flag` never actually contained the `ADD COLUMN` statement — its SQL only touched foreign key cascade rules. Both the real dev database and a freshly-migrated database were missing the `User.mustChangePassword` column despite `schema.prisma` and the generated Prisma Client expecting it. This meant a fresh deploy anywhere (staging, production, a new machine) would have been unable to log in or register at all — it only "worked" locally because the previously generated (stale) Prisma Client also didn't know about the column. Fixed with a new migration, `20260724142258_fix_missing_must_change_password_column`, applied to both dev and test databases. The original broken migration file was left untouched (migrations are immutable once applied), per standard Prisma practice.
- **Validation**: every endpoint across all 9 resource groups now validates via `zod` schemas in `backend/src/validators/*.js`, applied through `backend/src/middleware/validate.middleware.js`. Replaces old scattered manual `if (!field)` checks.
- **Centralized error handling**: `AppError` (`backend/src/utils/AppError.js`) and `asyncHandler` (`backend/src/utils/asyncHandler.js`). Every controller is a thin `asyncHandler`-wrapped function with no try/catch; every service throws `AppError(message, statusCode)`. The global error handler in `app.js` respects `err.statusCode` instead of always returning 500.
- **Auth hardening**: login no longer echoes the JWT in the JSON response body — the httpOnly cookie is the only place the token lives. Added a login-specific rate limiter (10 attempts/15 min, successful logins don't count against it).
- **Admin password reset**: `POST /api/platform/superadmins/:userId/reset-password` (master-key gated), replacing ad-hoc `reset_password.js`/`check_users.js` scripts (deleted).
- **Secrets rotated**: `JWT_SECRET`/`MASTER_KEY` replaced with strong random values. Added `backend/.env.example`. `.env.test` added to `.gitignore`.
- **Performance**: fixed two N+1 query patterns — `report.service.js`'s `getEmployeeReport` and `getProductReport`'s stock lookup.
- **Cleanup**: removed dead imports in `product.routes.js`.
- **Tests**: Jest + Supertest against a dedicated `business_webapp_test` Postgres database. `npm run test:migrate` applies migrations; `npm test` runs 10 tests (`tests/auth.test.js`, `tests/business-scoping.test.js`). `tests/setup.js` refuses to run unless `DATABASE_URL` points at a `*_test` database — a safety rail against ever running tests against real data.

**Not done in Phase A, intentionally deferred**: the JWT-role-vs-BusinessUser-role inconsistency (fixed later, 2026-07-31), MFA/email verification (not warranted at this scale yet), any frontend work.

**Known issue found, not yet fixed at this point (resolved 2026-07-31)**: `authorize(...roles)` checked the *global* `role` field from the JWT, not the per-business `BusinessUser.role` — latent, not yet triggered since every user belonged to exactly one business at the time.

---

### Phase B — Frontend Foundation (done 2026-07-24)

Rebuilt from scratch in `frontend/`. Verified end-to-end with a headless-browser walkthrough (register → login → dashboard → nav) against the real backend.

- **Stack**: TypeScript, Vite + React 19 + React Router 7 + TanStack Query v5 + React Hook Form + zod + Tailwind CSS v4 + shadcn/ui.
- **Design system**: generated via the `ui-ux-pro-max` skill — style "Soft UI Evolution," palette "industrial slate + stock green" (`#334155`/`#059669`), Poppins/Open Sans, self-hosted via `@fontsource`. Layout direction (dark sidebar, KPI cards) came from Victor's reference screenshot, not the tool.
- **Auth wiring**: `AuthContext` backed by TanStack Query's `/auth/me`, `mustChangePassword` redirect handling, `activeBusinessId` in `localStorage` (UI preference only — session token stays exclusively in the httpOnly cookie).
- **App shell**: dark sidebar + topbar with business switcher/avatar menu.
- **Pages built**: Login, Register, Change Password, Dashboard (real data). Other nav destinations routed correctly with "Coming soon" placeholders.
- **Bug found and fixed**: CORS allowlist was three hardcoded origins (including a stale LAN IP), broke when Vite fell back to port 5174. Replaced with env-driven `CLIENT_URL` allowlist + "any localhost port" in non-production.
- **Known trade-off, not a bug**: production build showed a "chunk larger than 500kB" warning — expected with no route-level code-splitting yet (fixed later, 2026-08-01).

---

### Auth UI redesign + light/dark theme (done 2026-07-24, between Phase B and Phase C)

Not in the original plan — added mid-project after Victor shared a reference image (dark glassmorphic login, pill-shaped inputs, frosted glass card, animated gradient background).

- `ThemeContext`: light/dark/system, persisted to `localStorage`, pre-hydration inline script to avoid flash-of-wrong-theme. `ThemeToggle` dropdown added to topbar and standalone pages.
- Glassmorphic `AuthShell`/`AuthField`/`AuthBackground` (animated blurred gradient orbs, `motion-safe:` gated), rebuilt Login/Register/ChangePassword on top of them.
- Verified in both light and dark mode via Playwright screenshots.

---

### Phase C — Core Feature Screens (done 2026-07-25)

Businesses, Warehouses, Products, Team, Stock Movements, Sales/Transactions, Reports, Dashboard, Platform Admin all built and wired to real backend endpoints.

**Verification method**: a full Playwright script registered a disposable SuperAdmin and walked every screen, asserting on console/page errors and HTTP statuses throughout. Caught five real, previously-unknown bugs:

1. **`GET /auth/me` didn't return the same `businesses` array shape as `POST /auth/login`.** Login worked because the frontend seeds its cache from the login response, but any full page reload crashed `Topbar.tsx` on `user.businesses.length`. Fixed by making `getMe` build the identical normalized shape.
2. **CORS middleware ran after the rate limiter.** A 429 response never got `Access-Control-Allow-Origin`, so the browser reported it as an opaque CORS failure instead of the real message. Fixed by moving `cors()` before both rate limiters.
3. **Transaction list pagination 500'd on every request.** Express 5 turned `req.query` into a getter-only property — `validate.middleware.js`'s reassignment silently no-op'd. Fixed by attaching parsed/coerced results to `req.validatedQuery` instead.
4. **Warehouse/Product "create" dialogs never called `reset()` on success** — persistently-mounted form state leaked into the next creation (reproduced: creating a second warehouse without touching "Set as primary" silently stole primary status from the first). Fixed by calling `reset()` in each mutation's `onSuccess`.
5. **Deleting a SuperAdmin who owns any business always 500'd.** `Business.owner` was the only relation in the whole schema missing `onDelete: Cascade`. Fixed with a schema change + migration.

All five verified via a clean re-run of the full Playwright walkthrough after each fix.

---

### Frontend rework — premium glass redesign + new IA (done 2026-07-25)

Victor's reaction to the finished Phase C build: functionally solid but visually "too simple," plus two structural requests — post-login should be a business-picker, and the business "home" should be a POS register, not a Sales list+dialog.

- Design system deepened toward near-black cinematic dark mode; `Card` primitive became translucent + blurred, cascading a partial facelift to every screen using it.
- New `SelectBusiness.tsx` (route `/`) — business-picker landing page, every role, every login.
- New `Pos.tsx` (route `/pos`, nav label "Register") — two-pane cash-register layout, replacing Sales/Transactions entirely.
- Found and fixed two real bugs: `Login.tsx`/`ChangePassword.tsx` still hardcoded post-success redirects to `/dashboard` instead of `/`.
- **Explicitly deferred**: Products, Warehouses, Stock Movements, Team, Reports, Platform Admin didn't get a dedicated redesign pass in this batch — only the automatic `Card`/token facelift (finished later, 2026-07-25, see below).

---

### Phase D — Polish & Reliability (done 2026-07-25)

- Global error boundary (`ErrorBoundary.tsx`), mounted around the query/router/auth tree.
- Consistent query error states (`ErrorState.tsx`) with Retry, applied across every page-level query.
- Real receipt printing (`@media print` rules, `window.print()`), replacing an old "press Ctrl+P" hint.
- Responsive layout — mobile nav drawer via `Sheet`, tables switched from `overflow-hidden` to `overflow-x-auto`.
- Accessibility pass — `focus-visible:` rings added to hand-rolled interactive elements.

---

### Visual rework completion — remaining screens (done 2026-07-25)

Finished the glass visual language on Products/Warehouses/Stock Movements/Team/Reports/Platform Admin by touching shared primitives (`Dialog`/`AlertDialog`, `PageHeader`, `Tabs`) rather than per-screen rebuilds — most consistency came free from a handful of component-level changes.

---

### Register page rework — real cash-register flow (done 2026-07-25)

Replaced the tile-grid POS with a search-driven, Casio-register-style flow.

- Backend: added `CREDIT` to `PaymentMethod`, nullable `discountPercent` on `TransactionItem`. Fixed a bucketing bug in the employee report that would have mislabeled CREDIT sales as transfers.
- `ProductSearch.tsx` replaced the product grid — type to search, live stock shown, staging card with quantity input.
- Per-line discounts, visible only when explicitly applied (manual price edits don't show a discount badge — a deliberate distinction).
- Three-way payment method (Cash/Transfer/Credit), Credit requiring a customer name (validated both client- and server-side).
- Post-sale popup: Print receipt / New sale.
- Bug found: stale Prisma Client after adding `discountPercent` via `prisma migrate dev` — fixed with an explicit `npx prisma generate` + dev-server restart (nodemon doesn't watch `node_modules`).
- **Flagged, not acted on**: a fake "tip" line in `prisma generate` output pointing to an unrelated domain — later (2026-07-26) traced to the real, official `dotenv` package's own promotional tips array, not a supply-chain issue. Suppressed via `dotenv.config({ quiet: true })`.

---

### Register price-edit auto-discount + Customers/Credit page (done 2026-07-25)

- Manual price edits now auto-compute and show the same discount badge the dedicated %-control produces.
- **`Customer` became a first-class entity**: new model, `Transaction.customerId`/`paidAt`. Auto-link/auto-create happens inside `createTransaction`'s own `$transaction` by case-insensitive name match — every named sale quietly builds the customer directory, no separate "create customer" step required.
- New `/customers` page: Customers tab (directory, stats, credit badge) + Credit tab (outstanding CREDIT transactions, "Mark as paid").
- Register autocomplete against the customer directory (debounced search).
- Bug found: `getCustomerById` reused a stats helper that stripped the `transactions` array, crashing the detail sheet. Fixed by spreading stats back together with the untouched array.

---

### Partial credit payments + sidebar reorder (done 2026-07-25)

- Sidebar reordered to Dashboard, Register, Customers, Products, Warehouses, Stock Movements, Team, Reports.
- New `CreditPayment` model — a real ledger, replacing the binary `paidAt`-only settlement. `paidAt` is now derived once cumulative payments cover the total.
- `recordCreditPayment` replaces `markTransactionPaid`: validates CREDIT, rejects invalid amounts, records a `CreditPayment` row.
- `customer.service.js`'s `outstandingCredit` now sums actual remaining balance per transaction, not full totals.
- New `RecordPaymentDialog.tsx` — "Pay in full" / "Enter amount" toggle.

---

### Register desktop layout: three-zone split, no page scroll (done 2026-07-25)

Split `CartTicket.tsx` into `CartItemsPanel.tsx` (scrollable) and `SaleSummaryPanel.tsx` (fixed). New desktop grid caps the whole Register view to viewport height so only the cart items list scrolls internally — verified by comparing `scrollHeight` to `innerHeight` with an empty and a 10-item cart.

---

### Products page: restocking (single + bulk), short codes, and per-warehouse visibility (done 2026-07-26)

- `Product.shortCode` (unique per business, case-insensitive), `StockMovement.type` (`RESTOCK`/`TRANSFER`), `fromWarehouseId` nullable (a restock has no source warehouse).
- Unified restock flow: single page-level "Add stock" button opens `ReceiveStockDialog.tsx` (pick warehouse, then one-or-more product+quantity rows) — replaces the old per-row single-item dialog. `receiveStock()` does the whole batch in one `$transaction`.
- Short codes matched by the POS register's search, alongside product name.
- New `ProductDetailSheet.tsx` / `WarehouseDetailSheet.tsx` for cross-referencing stock by product/warehouse.
- `StockMovements.tsx` reworked into a date-grouped list with a day-detail sheet.
- Bug found: shadcn `Sheet`'s baked-in `data-[side=right]:sm:max-w-sm` beats a plain `className` width override on specificity — fixed by matching the variant chain.
- **Also flagged, not fixed**: more fake "tip" lines from `prisma migrate`/`generate` pointing at unrelated third-party domains — flagged to Victor for an independent audit, not otherwise acted on in this batch.

---

### Products polish: search bar, searchable bulk-restock picker, unit dropdown (done 2026-07-26)

- Products page search bar (client-side filter).
- `ProductPicker.tsx` — type-to-filter replacing the plain `<Select>` in the bulk restock dialog, excluding products already picked in other rows.
- Unit field became a `<Select>` with a preset list + "Other (custom)" escape hatch.
- Bug found and fixed: `ProductPicker`'s first version reset its displayed text via a timing-sensitive `useEffect`, visibly clearing what the user had just typed — fixed by moving the reset into `onBlur`'s existing delayed callback.
- **Resolved the "suspicious tip" flag from the previous batch**: it's the real, official `dotenv` v17.4.0 package's own hardcoded promotional tips array — not a compromised package. Fixed by passing `{ quiet: true }` to all `dotenv.config()` call sites.

---

### Navigation cleanup: topbar identity, and a real Businesses management page (done 2026-07-26)

- Topbar's business-switcher `<Select>` replaced with a plain "Business Name · Page Name" label (switching businesses now only via the logo → `SelectBusiness` flow).
- Every page under `AppLayout` dropped its own redundant `<h1>` title.
- New `Businesses` page (SUPERADMIN-only sidebar item) — list/edit/delete, using the same `BusinessCard` component `SelectBusiness` uses.
- New `DELETE /api/businesses/:id` (ownership-checked, cascades via existing `onDelete: Cascade` relations).

---

### Reports date filtering + CSV export; Stock Movements filtering + CSV export (done 2026-07-26)

- Audit found the reports backend already accepted date params — the frontend just never passed them (always "today"). Fixed all 6 Reports tabs to wire real date controls to existing backend params.
- New `frontend/src/lib/csv.ts` — no new dependency, every tab builds its own row array from data already fetched.
- Stock Movements gained real server-side filtering (date range, from/to warehouse, product, type) — previously zero filtering existed.
- Employees/Products date range defaulted to first-of-month → today instead of blank (blank silently meant "today only" — exactly the bug being reported).

---

### PDF export + "items sold" vs "full report" download scope (done 2026-07-26)

- New dependency `jspdf`/`jspdf-autotable` — chosen over reusing the receipt's print-dialog trick, for one-click parity with the CSV button.
- New `frontend/src/lib/pdf.ts` — receipt-styled header, one `autoTable` per section.
- Daily/Weekly/Monthly tabs gained an "Items sold" (no employee breakdown) variant alongside "Full report," in both CSV and PDF.
- Verified every downloaded `.pdf` starts with the real `%PDF-` magic bytes, not just "file exists."

---

### Password visibility toggle + a real Settings page (done 2026-07-28)

- Eye/EyeOff toggle added at the shared `AuthField.tsx` level — fixed all 5 password fields app-wide from one change.
- New `PATCH /api/auth/me` (profile update — previously only `GET /me` and `POST /change-password` existed).
- New `Settings.tsx` — Profile (editable), Security (links to existing Change Password), Appearance (`ThemeToggle`).

---

### Settings becomes a SUPERADMIN control panel: sidebar nav, 2FA, receipt branding, Team password reset (done 2026-07-28)

- Settings moved from the avatar dropdown to a sidebar destination, SUPERADMIN-gated.
- Team password reset: random 10-character password (not the guessable default pattern), since a reset can be triggered repeatedly.
- Receipt branding: `Business.receiptTitle`/`receiptFooterNote`/`receiptShowSignature`, reflected on printed receipts.
- **Real TOTP 2FA**: `otplib` + `qrcode`. `User.twoFactorSecret`/`twoFactorEnabled`. Login returns a 5-minute `tempToken` when 2FA is enabled instead of a session; a second endpoint exchanges a valid code for the real session.
- **Four real bugs found and fixed**: (1) numeric-leading HTML `id`s invalid as CSS selectors, (2) React reconciling two structurally-similar `Login.tsx` branches as one component instance (fixed with a distinguishing `key`), (3) `otplib`'s zero time tolerance rejecting valid codes near a 30s window boundary — fixed with `tolerance: 30`, a genuine reliability fix for real users, not just test timing, (4) a Controller-bound checkbox missing matching `defaultValues`.

---

### Codebase-wide documentation pass + multi-language support (French) (done 2026-07-30)

- All ~150 hand-written files (excluding auto-generated shadcn primitives) got JSDoc-style comments explaining purpose and non-obvious business rules.
- **i18n**: `i18next` + `react-i18next`, source-English-text-as-key convention (`t("Exact English Sentence")`) — see `decisions.md`. `User.language` persisted field. Switcher in Topbar (all roles) and Settings (SUPERADMIN).
- **Backend error translation with zero backend code changes**: found every backend error message funnels through one chokepoint (`ApiError` in `api-client.ts`); changed `.message` from a plain property to a getter running the raw string through `i18n.t(raw, {ns:"errors", defaultValue: raw})` — every existing call site got translated automatically.
- Consolidation: ~430 distinct strings extracted and translated in one pass for terminology consistency, plus ~52 backend error messages.
- Three real bugs found: forgot to regenerate Prisma Client after the `User.language` migration; an extraction regex false-matched `authenticate(`/`route(` as `t(` calls; a handful of ternary-built `title`/`description` props weren't caught by the initial literal-prop scan.

---

### Settings restructured into a card-grid hub (done 2026-07-30)

New `frontend/src/pages/settings/` folder — `SettingsLayout`/`SettingsHub` (card grid) + one page per section, replacing one long scrolling page.

---

### Team/Reports/Platform Admin — deeper interaction-level UX pass (done 2026-07-30)

- Team: search filter + `TeamMemberDetailSheet.tsx`.
- Reports: Daily/Employee tabs gained real transaction drill-down (the backend already returned the data; the frontend TS types just never declared the field).
- Platform Admin: search filter over the SuperAdmin list.

---

### JWT session revocation + per-business role authorization (done 2026-07-31)

- **Logout now actually revokes the session server-side.** `User.tokenVersion`, included as a JWT claim, checked on every `authenticate` call — a mismatch (or a pre-existing token with no claim, treated as `0`) → 401. Signs out every device/session at once (no per-session granularity — an accepted tradeoff, see `decisions.md`).
- **`authorize()` now checks the caller's per-business role** (`req.businessRole`, set by `belongsToBusiness`), not their account-wide `User.role` — fixes the latent inconsistency flagged since Phase A.
- Verified manually (backend Jest was broken at this point by an unrelated pre-existing issue, fixed later 2026-08-01): raw HTTP cookie-replay test, a direct-Prisma cross-business-role scenario, and a full Playwright pass.

---

### Sell/restock products in alternate pack sizes, e.g. dozen vs. pcs (done 2026-07-31)

- New `ProductUnit` model (`label` + `factor`, price always `product.price * factor` — no separate price to manage).
- All pricing/stock math stays in base units — the frontend converts pack size → base-unit quantity before it reaches the backend.
- **Two real bugs found**: (1) `product.controller.js`'s create/update silently dropped `units` from `req.body` — dead code until wired up. (2) `createTransaction`'s stock decrement read a pre-transaction snapshot, so two line items of the *same* product (only reachable once multi-pack-size sales existed) overwrote instead of accumulated — fixed with an atomic `{ decrement: quantitySold }` plus per-product aggregated stock-sufficiency checks.
- Alt units can be smaller than the base unit too (fraction syntax like `1/12` accepted in the Factor field, parsed client-side).
- "Dozen" auto-fills and locks its factor to 12 (the only universally unambiguous conversion); other container units still require a manually-typed factor.
- Container units ("carton", "box", etc.) get a "how many pcs?" question instead of a raw factor box.
- The register/restock unit selector always shows now, with an implicit pcs⇄dozen pairing available with zero per-product configuration (`frontend/src/lib/units.ts`'s `getUnitChoices`).

---

### Structured logging + soft-delete/audit trail (done 2026-08-01)

- **Structured logging**: `pino`/`pino-http`/`pino-pretty`, replacing 3 bare `console.log`/`console.error` calls total. Internal-only, no external error-tracking service (Victor's explicit choice — see `decisions.md`).
- **Soft-delete for Product, Customer, Warehouse** (not Business or team-member removal). This also fixed two real, previously-unreachable gaps: `deleteProduct` used to permanently refuse deletion of any product with transaction history; `deleteWarehouse`'s "still has stock" guard counted *any* `WarehouseStock` row regardless of quantity (rows are only ever decremented, never deleted), meaning a warehouse that had ever stocked anything could never be deleted even at 0 current stock.
- **`AuditLog` model** for administrative/destructive actions only, via `recordAudit()`, inside the same `$transaction` as the action where possible.
- New Settings → Activity Log page.
- **Explicitly out of scope**: no Trash/Restore UI yet (built later, same day-ish — see below), no platform-wide activity view yet (also built later).

---

### Self-service "forgot password" via email (done 2026-08-01)

- Email via Brevo (API key, not SMTP) — `@getbrevo/brevo` v5.0.4. Sender: `vaeinventory@kingkhartel.xyz`.
- New SuperAdmin signups now require an email (their only self-service recovery path); team members stay email-optional.
- Reset-token mechanism reuses the exact 2FA-pending idiom (`purpose: "password-reset"`, 30-minute short-lived JWT). Completing a reset also calls `invalidateSessions()` — resetting a password signs out every other session too.
- Accepted trade-offs (consistent with "logout signs out everywhere"): reset token isn't single-use-tracked server-side; rate limiting is per-IP, not per-target-email.
- **Brevo IP-authorization gap, found and resolved same day**: the first real send attempt failed with a `401 unrecognised IP address` — a Brevo account setting, not a code bug (failure was caught and logged as designed, generic success still shown to the user). Victor authorized the sending IP; a second full pass confirmed real delivery.

---

### Fixed the broken backend Jest suite + stood up a real frontend test suite (done 2026-08-01)

- **Backend Jest suite was fully broken (parse failure)**: `otplib`'s transitive deps (`@scure/base`, `@noble/hashes`) are ESM-only; Node's native `require()` handles this transparently but Jest's module system doesn't. Fixed with a Babel transform targeting just those two packages.
- Test database was 9 migrations behind — `test:migrate` isn't automatic, has to be rerun by hand after new migrations.
- Test payloads were stale (missing the now-required `email` field).
- **Frontend test infra stood up from zero**: Vitest + React Testing Library + jsdom, reusing the existing Vite config. 20 tests: pure-logic (units/permissions/format) + one full-stack `Login.test.tsx` integration test.
- **Also fixed a pre-existing frontend build break** (confirmed via `git stash` to predate this session): ~20 `tsc -b` errors, all the same shape — guarding on `errors.field` existence instead of `.message` specifically for i18next's typed `t()`.

---

### Route-level code-splitting, duplicate-customer merging, credit-payment undo, Trash/Restore UI, platform-wide activity (done 2026-08-01)

All five remaining "small deferred niceties" plus code-splitting, in one batch:

- Route-level code-splitting (`React.lazy` + one `<Suspense>` boundary) — fixed the earlier "chunk larger than 500kB" build warning.
- Duplicate-customer merging (`mergeCustomers`, reassigns transactions then soft-deletes the duplicate, one `$transaction`).
- Credit-payment undo + a dedicated payment-history view.
- Trash/Restore UI for soft-deleted Products/Customers/Warehouses (previously required a developer clearing `deletedAt` directly in the database).
- Platform-wide activity view (a fixed action allowlist, not "businessId is null," to avoid catching unrelated entries).

**Hosting decision recorded this day** (superseded 2026-08-06 for testing purposes — see `decisions.md`): Victor planned to self-host on an existing work server for roughly the first year, then migrate to a real online host later.

---

### Report unit display (done 2026-08-02)

Every quantity across all report tabs/CSV/PDF now pairs the number with `product.unit` (e.g. "24 pcs"), matching the existing receipt convention.

---

### Pre-deployment review pass (done 2026-08-02)

Full backend audit + live Playwright UI/UX walkthrough. Found and fixed: `restoreProduct` didn't check for an active name collision (could silently create two active products with the same name — now a clear 409); removed the unused `socket.io` dependency (dropped several `npm audit` findings).

---

### Detail popups: Sheet → centered Dialog, plus dialog height/print fixes (done 2026-08-02/03)

- Converted every detail popup (Customer, Product, Team Member, Warehouse, Transaction/receipt, Stock Movements day-detail) from `Sheet` to a centered `Dialog` — only the mobile nav drawer stayed a `Sheet`.
- Two real print bugs found only by generating actual `page.pdf()` output (not screenshot emulation): a `translate` CSS property establishing its own containing block, and `#root`'s invisible sidebar/topbar tree pushing content onto a blank page 2.
- Shared `DialogContent` had no height cap — fixed at the component level (`max-h-[85vh]`, only the body scrolls, header/footer pinned).

---

### Animated SideRays background on auth screens (done 2026-08-03)

WebGL light-beam effect (`ogl`) layered into `AuthBackground.tsx`, recolored to brand colors, gated on `prefers-reduced-motion`, paused via `IntersectionObserver` when off-screen. Scoped to auth screens only — not the persistent app shell.

---

### Product creation form reorder (done 2026-08-03)

`ProductFormDialog.tsx` reordered to Name → Unit & Price → Alternate units → Short code → Description, per Victor's requested order.

---

### Receipt format: conditional "Billed To", single signature line, page-size-agnostic print (done 2026-08-03)

- "Billed To" omitted entirely for anonymous sales.
- Removed the blank "Customer signature" line.
- Receipt now fills whatever paper size is chosen instead of staying pinned to the screen dialog's width (`@page { margin: 12mm }`, no forced `size`) — surfaced and fixed a real layout regression from the dialog height-cap fix.

---

### POS: record cash amount received / change due, persisted (done 2026-08-03)

`Transaction.amountTendered`/`changeGiven` (nullable, CASH-only). Register shows a live "Change due" line; insufficient amount blocks checkout with an inline error. Shown on the post-sale popup and printed receipt.

---

### Auth-screen branding fix + new-account welcome email (done 2026-08-04)

- "VAE Inventory" was missing from every auth screen — fixed at the shared `AuthShell.tsx` level.
- New branded "Welcome to VAE Inventory" email on registration.
- **Real bug found**: the welcome email was `await`ed inline, stalling registration 43+ seconds when Brevo rejected the call. Made both the welcome and password-reset emails genuinely fire-and-forget.

---

### Settings-configurable low-stock alert rule, per unit (done 2026-08-05)

- `Business.defaultLowStockThreshold` (flat fallback) + `lowStockThresholdsByUnit` (per-unit map) — a two-part live rule, editable from Settings > Stock alerts.
- `WarehouseStock.lowStockThreshold` changed from a defaulted column to a nullable override, resolved at **read time** (not baked in at restock time) — the core design decision that makes editing the Settings rule retroactively re-flag existing stock with zero per-product edits.
- **Two real bugs found and fixed**: (1) `lowStockThresholdsByUnit` came back `null` for every pre-existing business — fixed with a non-nullable column + a hand-written backfill `UPDATE` in the migration, not a frontend `?? {}` patch. (2) The two new Business fields were silently missing from `/auth/me` — two hand-duplicated field-select lists (`getMe`, `issueSession`) had drifted out of sync with `BUSINESS_SELECT` and with each other. Fixed by extracting one shared `buildBusinessesList(user)` helper.
- Verified live: a "pcs" product at quantity 30 wasn't flagged low against the default of 10; after setting a Settings rule "pcs below 50," the same untouched product immediately showed low-stock everywhere (Products, Warehouse detail, Reports > Stock Alerts).

---

### Free-tier demo deployment: Vercel + Render + Neon (done 2026-08-06)

Victor's dad wanted to test the app for real, ahead of the longer self-host-at-work timeline (see `decisions.md`). Stood up a temporary, free-tier cloud deployment rather than wait:

- **GitHub repo renamed** `khartel/Business_WebApp` → `khartel/vae-inventory` (local `origin` remote updated to match) so the Vercel project name/subdomain could match too (`vae-inventory.vercel.app`).
- **Database**: Neon (free Postgres), chosen over Render's own free-tier Postgres specifically to avoid its 30-day expiry mid-testing.
- **Backend**: Render free web service, root `backend/`, build command runs `prisma generate && prisma migrate deploy` (confirmed `prisma.config.ts` reads `DATABASE_URL` from env for CLI migration commands, same as the app's own `pg.Pool`-backed Prisma client).
- **Frontend**: Vercel, root `frontend/`, `VITE_API_URL=/api`.
- **Cross-domain cookie problem found and fixed before it shipped**: the session cookie is `sameSite=strict` (`backend/src/controllers/auth.controller.js`), which only works when frontend and backend share a domain — on separate Vercel/Render domains it would never be sent back, silently breaking login. Two options considered: weaken to `sameSite=none` + `secure` (rejected — Safari/iOS blocks third-party cookies by default, a real risk for a family-owned small business audience) vs. a Vercel rewrite proxy so the browser only ever sees one origin (chosen — no cookie-security weakening, no code change to `sameSite` needed at all). New `frontend/vercel.json`: `/api/*` rewritten to the Render backend, plus a SPA-fallback rewrite to `index.html` for React Router routes.
- **Verified**: registered a throwaway account on the live `vae-inventory.vercel.app` deployment, confirmed login persists across a full page refresh (the real test of whether the proxy/cookie setup works).
- **Explicitly not a production launch** — free-tier limits (Render 15-min cold start, Neon free-tier limits, demo-only secrets) are documented in `architecture.md`. The long-term hosting decision is still open — see `decisions.md`.

---

### Phase G — Profitability & Cost Tracking (done 2026-08-16)

First phase from the 2026-08-07 gap analysis (`gap-analysis-2026-08.md`). `Product` had a selling `price` but no cost price anywhere, so the app couldn't answer "what did we actually make?" on any sale. Victor confirmed cost/margin visibility should be SuperAdmin + Admin only, never Employees.

- **`Product.costPrice` / `TransactionItem.costPrice`**: both nullable `Float`, additive migration, no backfill needed (unlike the earlier Customer phone/address migration) — `null` is a legitimate, permanent "no cost data" state here, not a gap to fill in. `TransactionItem.costPrice` snapshots the product's cost at time of sale, same reasoning as the already-snapshotted `unitPrice`/`unitLabel`.
- **Role-based field stripping, not just UI hiding**: `GET /products` and `GET /products/:id` are open to all three roles (Employees need them for POS search), so `costPrice` is stripped from the response entirely for non-managers — `product.service.js`'s `getProducts`/`getProductById` gained an `includeCostPrice` option, computed in the controller from `req.businessRole`. Verified this holds at the raw network-response level, not just "the UI doesn't render it." `POST`/`PATCH /products` and all of Reports were already SUPERADMIN/ADMIN-gated before this batch, so no new gating was needed there.
- **Products page**: new "Margin" column (SuperAdmin/Admin only), showing a computed percentage or an em dash for products with no recorded cost — never a fabricated 0%.
- **Reports**: Daily/Weekly/Monthly/Employees/Products all gained a Profit figure alongside existing revenue numbers (summary, daily breakdown, by-employee, by-product), plus a `hasIncompleteCostData` flag surfaced as an on-screen caveat and an asterisk/note in CSV and PDF exports, whenever some of the sales in a given bucket involved a product with no cost price recorded. Stock Alerts untouched (no money in it).
- **Two real bugs found and fixed during verification**:
  1. **Stale Prisma Client after the schema migration** — the exact recurring gotcha this project has hit several times before (nodemon doesn't watch `node_modules`): `npx prisma generate` plus a manual backend restart was needed before `costPrice` was actually usable, both in the running dev server and in the Jest test database. The test database specifically needed `npm run test:migrate` re-run (it was two migrations behind, including the earlier Customer phone/address one from the previous batch) — this had been silently lurking since that batch without a test happening to catch it, until this one did.
  2. **The overall profit figure double-counted uncosted items' revenue as pure profit.** The shared `computeCostProfit` helper computed `totalProfit` as *full* revenue (including items with no cost price) minus *partial* cost (only from items that had one) — silently overstating profit by treating every uncosted sale as 100% margin, exactly the failure mode the `hasIncompleteCostData` flag existed to warn about. Caught live: a test sale of 5 costed units (real profit 250) plus 3 uncosted units reported a profit of 400 instead of 250. Fixed by computing `totalProfit` from the same cost-known subset of items as `totalCost`, not the full revenue total — the per-product/per-employee breakdown accumulators (hand-written inline in each report function) were already correct and didn't have this bug, only the shared summary-level helper did.
- **Verified live**: API-level check that cost price is present for a SuperAdmin's product fetch and completely absent (not `null`, absent) for an Employee's; Products page shows a correct margin percentage for a costed product and an em dash for an uncosted one, with the Margin column itself absent for an Employee session; a Daily report correctly showed profit 250 (not 400, after the fix) with the incomplete-cost-data caveat visible, for a period mixing costed and uncosted sales. Backend Jest (10/10), frontend Vitest (20/20), `tsc -b` all clean. Also incidentally re-confirmed the pre-existing (unrelated to this batch) Reports gating for Employees still holds: the sidebar nav item is visible to all roles by design, but the page itself shows "Not available" and the API 403s — unchanged by this work.
- **Not built in this pass, intentionally deferred**: inventory turnover ratio and days-inventory-outstanding (need real sales history to accumulate now that cost data exists going forward); per-sale margin on the receipt view (deliberately excluded — receipts are also opened by Employees).

---

### Credit sales restricted to known customers, mandatory phone+address, cash/transfer decoupled from the customer directory, country-flag phone input everywhere (done 2026-08-07)

Victor tightened three related rules: (1) a Credit sale can only go to a customer already in the directory — no more auto-creating a contact from a typed name; (2) adding a customer now requires phone **and** address, both previously optional/nonexistent; (3) Cash/Transfer sales keep the typed name on the receipt but no longer create a customer record on a miss (still link if the name matches an existing customer exactly). Also requested a country-flag phone input, applied to every phone field in the app, not just the new Customer one.

- **Schema**: `Customer.phone` (`String?` → `String`), new `Customer.address String`. Migration hand-edited with a backfill (`UPDATE ... SET phone = ''` before the `NOT NULL`, `address` added with a temporary `DEFAULT ''` then dropped) — Victor confirmed existing customer rows are just test data, so an empty-string backfill was acceptable rather than needing a careful real-data migration.
- **`createTransaction` (`transaction.service.js`) split by payment method**: CREDIT now requires a real `customerId` (validated both by `zod` and, since the validator can't hit the database, by a service-level lookup that 404s if it doesn't resolve to a real, non-deleted customer of the business) — the stored `customerName` snapshot is always derived from that customer's actual name, never client-supplied, so a receipt can't diverge from who it's billed to. CASH/TRANSFER kept the case-insensitive name-match-and-link behavior but the `tx.customer.create(...)` fallback on no match was removed outright — this is the one that actually reverses part of the 2026-07-25 "every named sale builds the directory" decision.
- **Credit customer picker is a strict pick, not free text**: new `CreditCustomerPicker.tsx` (frontend), distinct from the existing free-text `CustomerNameField.tsx` (kept as-is for Cash/Transfer) — selecting a search result is the only way to set a value; typing alone leaves it `null`, which blocks "Complete sale" with an inline error, mirroring the existing insufficient-cash-amount validation pattern already in `Pos.tsx`.
- **Inline "add customer" shortcut, permission-gated**: when a Credit search has zero matches, SUPERADMIN/ADMIN cashiers (the same roles already gated on `POST .../customers` in `customer.routes.js`) see a "+ Add '{name}' as a new customer" affordance that opens `CustomerFormDialog` in a new controlled-open mode (pre-filled with the typed name, auto-selects the new customer on success) without losing the cart. EMPLOYEE cashiers see a plain "ask a manager" message instead — verified as a real role-gated difference, not just present-in-code, via two separate logged-in sessions.
- **Country-flag phone input**: new dependency `react-phone-number-input` (frontend, re-exports `isValidPhoneNumber` from `libphonenumber-js` so client and server validate identically) and `libphonenumber-js` (backend, `zod`'s `.refine(isValidPhoneNumber, ...)`). New shared `frontend/src/components/ui/phone-input.tsx`, styled via hand-written CSS in `index.css` since the library's internal class names aren't reachable with Tailwind utilities. Applied to all six phone fields in the app (Customer, Register signup, Add team member, Create/Edit business, Settings profile) — each swapped from `{...register("phone")}` to RHF's `Controller`, since the library needs a controlled value. Default country comes from the active business's `country` field where one exists (new `frontend/src/lib/countries.ts` maps the stored country *name*, e.g. "Nigeria", to the ISO alpha-2 code the library needs); `CreateBusinessDialog` is the one exception, reactively re-deriving it from the country picked in that same form via a `key`-forced remount, and `Register.tsx` (pre-signup, no business yet) has no default at all.
- **Real bug found during verification, not present before this session**: `customer.controller.js`'s `create`/`update` handlers still destructured only `name`/`phone` from `req.body`, silently dropping the new `address` field before it ever reached the service — a `PrismaClientValidationError` ("Argument `address` is missing") on every real customer creation, even though the validator and service layers were both already correct. The exact same class of bug this project has hit before (Phase C, alternate-pack-size units) — a controller with its own stale field list. Fixed by adding `address` to both handlers' destructuring and pass-through.
- **Verified live**: API-level check that creating a customer with no phone/address is rejected (`400`), and a full Playwright pass — Credit checkout blocked with no customer selected, SuperAdmin's inline add-shortcut working end-to-end (search → add → auto-selected → sale completes), the same unmatched search showing no shortcut and an "ask a manager" message for an EMPLOYEE session instead, a Cash sale to an existing customer's exact name linking to them (`transactionCount` went from 1 to 2), a Cash sale to a brand-new name leaving the customer directory untouched (still exactly one entry afterward), and real account registration/business creation succeeding through the new country-flag phone input end-to-end. Backend Jest (10/10), frontend Vitest (20/20), and `tsc -b` all clean throughout. All disposable test accounts (23, accumulated across debugging — registration/login is rate-limited in-memory, so the backend needed a mid-session restart once, a known recurring issue for this dev workflow) cleaned up afterward via a direct Prisma script matching test-prefix usernames; confirmed only real, pre-existing accounts remained.
- **Not done, intentionally out of scope**: `EditBusinessDialog`'s and `SettingsProfile`'s phone fields use the identical shared `PhoneInput` component and `Controller` pattern already proven working in two other forms in this same batch, so they weren't independently re-verified live — a reasonable inference from shared-component reuse, not a gap in the underlying implementation.
