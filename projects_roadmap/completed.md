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

---

### Phase I — Returns & Stock Adjustments (done 2026-08-16)

Second phase from the 2026-08-07 gap analysis, picked over Phase H (barcode scanning, deferred — not every business has a scanner) since it has no dependencies and addresses a bigger day-to-day trust gap: there was no honest way to reverse a sale or reconcile a physical stock count, only a raw warehouse-to-warehouse transfer standing in for both. Victor confirmed via `AskUserQuestion` that Reports stay untouched in this pass (gross sales, not netted for returns) — deferred to a later pass once this lands and is tested live.

- **Schema**: new `Return`/`ReturnItem` models (which transaction, which line items, refund method/amount, reason, who processed it) hold the money side. `StockMovement` gained two new `MovementType`s — `RETURN` (shaped exactly like a `RESTOCK`: no source warehouse, a real destination, always-positive quantity, plus an optional `returnId` FK back to the `Return` record) and `ADJUSTMENT` (reusing `toWarehouseId` to mean "the warehouse being corrected," not a literal transfer destination, with new nullable `previousQuantity`/`newQuantity`/`adjustmentReason` columns so direction is read from those two counts rather than needing a signed `quantity` — preserves the existing "always positive magnitude" invariant every other movement type relies on). All additive, no backfill needed.
- **Refund methods, deliberately narrow**: `CASH` (money or transfer handed back, no further bookkeeping) or `CREDIT_BALANCE` (reduces what's owed on an outstanding CREDIT sale — deliberately *not* recorded as a `CreditPayment`, since that table means money the customer actually paid in; `withCreditStats` instead subtracts `CREDIT_BALANCE` returns from `balanceDue` directly, computed fresh each time from `payments` + `returns` so nothing can drift out of sync). `CREDIT_BALANCE` is rejected outright (not silently split) if the sale is already fully paid, or if the return is worth more than what's still owed — the operator records a cash refund instead. A customer-wide "store credit" concept was explicitly not built — real scope-creep risk the phase doc itself flagged, and nothing today lets a future sale draw down a balance like that.
- **`createReturn` (`transaction.service.js`)**: each item's returnable quantity is `quantitySold` minus whatever's already been returned against it, computed fresh from existing `ReturnItem` rows (not a stored running total) — supports a product being returned across more than one visit without any risk of drifting out of sync with the return history. Refund amount per line is proportional to the item's actual `subtotal`/`quantitySold`, so a sale-time discount is inherently respected without recomputing discount logic. Restocking, the `Return`+`ReturnItem` write, and the `AuditLog` entry all happen inside one `$transaction`.
- **`adjustStock` (`product.service.js`)**: sets `WarehouseStock.quantity` directly to the counted `actualQuantity` (a reconciliation to an absolute count, unlike `receiveStock`/`moveStock`'s increments), rejects a no-op adjustment (count already matches) to avoid noise entries, and requires one of four reasons (`DAMAGED`/`MISCOUNTED`/`THEFT`/`OTHER`).
- **Role gating**: creating a return or an adjustment is SUPERADMIN/ADMIN only, same tier as `receiveStock`/`moveStock`/`undoCreditPayment` — corrections, not routine operations. Viewing a transaction's returns is open to whoever can already view that transaction (nothing sensitive in a return record, unlike cost price). Both actions get an explicit `AuditLog` entry on top of their own detail record, following the `undoCreditPayment` precedent rather than the "routine sales/stock activity" exemption plain RESTOCK/TRANSFER get.
- **Frontend**: new `ReturnDialog.tsx` (opened from a "Process return" button in `TransactionDetailSheet`'s footer, only shown when `canManage` and at least one item still has returnable quantity) and `AdjustStockDialog.tsx` (opened from Stock Movements' page header, mirroring `MoveStockDialog`'s structure, with a live "System count → actual" delta readout). `TransactionDetailSheet` gained a "Returns" section (same visual pattern as the existing "Payments recorded" block). Stock Movements' type filter, badges, CSV/PDF export, and day-detail table all extended for the two new movement types — no changes needed to `csv.ts`/`pdf.ts` themselves (already generic).
- **Real bug found during verification**: `TransactionDetailSheet`'s `DialogFooter` (`flex-row justify-end` above the `sm` breakpoint) now had two buttons ("Process return" + "Print receipt"), both still carrying the `w-full` class copied from when there was only one — two elements each demanding 100% of the footer's width in a flex row pushed the whole group off-screen to the left (`Process return`'s bounding box rendered at `x: -184`), so the button was unclickable (Playwright's overlay-intercepts-pointer-events error was a symptom, not the cause) even though it was present, visible-per-the-accessibility-tree, and correctly gated. Found by comparing an isolated single-button repro (worked) against the real two-button footer (didn't), then inspecting actual computed bounding boxes rather than trusting "element is visible" in the Playwright trace. Fixed by matching the established two-button footer pattern already used elsewhere in this codebase (`ConfirmDialog.tsx`'s Cancel/Confirm pair): `w-full sm:w-auto` instead of a bare `w-full`, so a single button still fills the footer on mobile (`flex-col-reverse`) but two buttons size to content once laid out in a row.
- **Verified live**: a 30-check API+browser Playwright pass — partial return (1 of 2) then the remaining unit (capping correctly, a third attempt on 0-remaining rejected), a CREDIT sale returned via `CREDIT_BALANCE` (balance dropping correctly), the same sale's balance paid down and a larger return then correctly rejected as over-balance and successfully re-recorded as a CASH refund instead, EMPLOYEE 403s on both new endpoints, a stock count corrected both up and down with the right `previousQuantity`/`newQuantity` on the movement record, and a Daily report total confirmed unchanged (gross, not netted) across all of the above. Backend Jest (10/10) and frontend `tsc -b` both clean. All disposable test data (business/user prefix `__pi_`, plus incidental `__dbg*` accounts from bisecting the footer bug) cleaned up via a direct Prisma script afterward. Hit the in-memory rate-limiter gotcha from this project's own documented list multiple times across the debugging iterations — each time fixed by restarting the dev backend, exactly as documented in `instructions.md`.
- **Not built in this pass, intentionally deferred**: netting returns into Reports' revenue/profit figures (Victor's explicit call — a later, separate pass); a standalone returns-list/audit page (returns surface inside the receipt view and Stock Movements, which covers this scale); customer-wide store credit as a spendable balance.


---

### Login landing redesign from supplied desktop/mobile references (done 2026-10-22)

- Replaced Login's centered aurora card with a dedicated `LoginShell`: pale mint background, emerald brand marks and buttons, serif inventory headline, three feature highlights, supplied dashboard imagery, and a translucent sign-in card beside the hero on desktop. On screens up to 900px the card sits prominently above a blurred decorative background using the supplied mobile reference. Both PNG assets are bundled under `frontend/public/images/`; no remote image or font service was added.
- Kept the existing username/password, remember-me, error/loading, redirect, and two-factor handlers. The credential field remains labelled Username because email sign-in is not implemented by this change. Marketing copy describes existing stock/sales features rather than promising planned purchasing functionality. The dashboard in the supplied reference is decorative sample imagery, not live data.
- Scoped presentation CSS to `.login-landing` and kept other auth pages on their existing `AuthShell`. Both login steps use the new shell. Retained theme/language controls and added French translations for all new copy.
- Verified: frontend TypeScript/production build passes (existing large-chunk warning remains), all 20 frontend tests pass, and all 10 backend Jest tests pass against the dedicated test database. The backend suite initially hit sandbox socket restrictions and passed when rerun with local network access.
- Browser checks: desktop and 390px mobile light layouts; 390px dark mode; 320px narrow layout with no horizontal overflow; empty-submit validation and password visibility toggle; French layout at 320px. Existing frontend tests verify login success, rejection and transition to 2FA; no real-user login or production deployment was performed. Preview screenshots saved under `/tmp/vae-login-preview/`.


### Login viewport fit (2026-11-11)

- Fixed vertical overflow in `components/auth/login.css`. The illustration's minimum height and the main section's independent viewport calculation forced the page beyond shorter screens. The page now uses header/content/footer grid rows; the decorative illustration flexes into the remaining height.
- Added height-aware card spacing and reduced secondary copy/branding on short screens while retaining all sign-in, recovery, remember-me and registration controls. On small phones the hero hides first. Extremely short viewports (including keyboard/zoom scenarios) can still scroll when required to keep form controls reachable; content is not clipped to hide overflow.
- Browser measurements confirmed document height equals viewport height at 1280x720, 1366x768, 390x844, 375x667 and 320x568. Validation messages also fit at 375x667 and 320x568; checked 1024x600 with validation in light and dark modes. Screenshots: `/tmp/vae-login-fit-desktop.jpg`, `/tmp/vae-login-fit-mobile.jpg`.
- Frontend production build and all 20 Vitest tests pass. Backend Jest: 8/10 initially, with two authentication tests exceeding the existing 15-second timeout; all 10 pass on retry with a 60-second test timeout (no configuration change). No authentication or backend behavior changed; no real-account login performed.


### Login imagery depth and blending (2026-11-11)

- Made the desktop dashboard illustration more prominent: expanded its decorative layer, adjusted its crop to reveal the dashboard header, increased saturation/contrast and added a soft shadow with an emerald glow behind it. Two intersecting gradient masks feather all four edges into the landing background.
- Mobile imagery is less blurred and more visible; its crop and top fade keep the reference image's baked-in branding/text behind the real interface. Increased decorative visibility in dark mode as well. All changes are scoped to `components/auth/login.css`.
- Verified desktop 1366x768 and mobile 390x844 in the browser; document heights still match viewport heights. Frontend production build and 20 frontend tests pass. No backend or authentication code changed. Screenshots: `/tmp/vae-login-blended-desktop.jpg`, `/tmp/vae-login-blended-mobile.jpg`.


### Pre-push codebase checks and hook-order fixes (2026-11-12)

- Fixed conditional `useMemo` calls in Products and Team by moving each no-business early return below the search-filter hook. Hooks now run in the same order when the active business changes.
- Verification: production TypeScript/Vite build, frontend Vitest (20/20), backend Jest (10/10 against the dedicated test database). Frontend lint rechecked after the fixes; non-blocking dependency/fast-refresh warnings and the build bundle-size warning remain. No new browser walkthrough or production database migration was performed during this check.


### Restore upper-right warehouse illustration (2026-11-12)

- The desktop dashboard crop excluded the warehouse photograph and floating stock-value card in the supplied reference. Added a separate decorative `.login-warehouse-image` layer in `LoginShell`, cropping that specific portion of the same bundled image, with a fade at its base. This keeps it visible independently of the dashboard's height-dependent crop.
- Reserved space beside the introductory copy and adjusted headline/image sizing for smaller desktop widths. Kept the existing mobile background and viewport-fit behavior. Decorative reference figures remain sample imagery, hidden from accessibility tools.
- Browser checked at 1280x720 in dark mode, 1366x768 and 1024x600 in light mode, plus 390x844 mobile. The measured desktop/mobile document heights equal their viewport heights; no scrolling added. Frontend build and all 20 frontend tests pass. No backend/authentication behavior changed. Screenshot: `/tmp/vae-login-warehouse-desktop.jpg`.


### Soften the login dashboard illustration in dark mode (2026-11-12)

- The supplied dashboard is a light-mode screenshot; its white panels were overpowering the dark login background. Added a dark-only brightness/saturation filter and lowered the decorative group's opacity slightly. Charts and silhouette remain visible while the sign-in card keeps visual priority. Light-mode styling and layout are unchanged.
- Verified the result in the browser at 1280x720. Screenshot: `/tmp/vae-login-soft-dark.jpg`. Frontend production build and all 20 frontend tests pass. No backend or auth behavior changed.


### Neutral charcoal login dark theme (2026-11-12)

- User clarified that the overall dark-green tint felt artificial; dimming the illustration alone did not address it. Replaced the login's dark theme with charcoal page/card/input surfaces, neutral gray text and borders, desaturated illustrations, and a flat muted-sage primary button. Removed the dark-mode emerald glow and saturated gradients; brand marks and feature icons now use neutral surfaces. Focus, hover and checkbox colors follow the restrained palette.
- Scoped changes to `.dark` login styles; light-mode styling and viewport layout are unchanged. Mobile decorative imagery is desaturated as well.
- Browser verified desktop 1280x720 and mobile 390x844 dark mode; document height equals viewport height. Switched back to light mode and confirmed the existing mint design remains. Frontend production build and all 20 frontend tests pass. No backend/auth behavior changed. Screenshots: `/tmp/vae-charcoal-desktop.jpg`, `/tmp/vae-charcoal-mobile.jpg`.


### Dashboard/workspace redesign + Sales and Phase J purchasing (2026-11-12)

Victor asked to turn the dashboard pictured on the login page into the actual app experience, including Inventory, Sales, and Purchases. Clarified the previously unimplemented Purchases scope: he chose full supplier/purchase-order management, then explicitly selected latest received unit cost.

- **Dashboard / chrome:** emerald sidebar and active-item treatment in light mode; neutral charcoal in dark mode; restrained cards, real daily sales bars, stock-health donut, active catalog/warehouse counts, inventory preview, recent sales and per-warehouse alerts. Includes a warehouse-photo banner cropped from the provided reference without its baked-in sample figures. There are no invented accuracy percentages, growth metrics or dashboard amounts. Sales are explicitly labelled gross before returns (ADR-23). Stock health counts warehouse/product positions, not mixed-unit quantities. Products/warehouses use active resource lists rather than legacy business counts that include trash. Query errors have retry states and empty data has honest empty states.
- **Navigation and Sales:** added Inventory (existing products route), Purchases, Sales and Suppliers destinations alongside existing operational pages; desktop/mobile share the same navigation. New Sales history has payment/date filtering, pagination and working receipt drill-down. Cash/transfer balances display as settled; outstanding balances are shown for CREDIT only. Fixed access visibility in the touched nav/dashboard/new pages to use the active-business role.
- **Suppliers:** business-scoped CRUD, E.164 phone + address + optional email, search/pagination, archive and restore, audit entries. No hard deletion through the UI; historical orders retain their supplier-name snapshot.
- **Purchases:** paginated/filterable order list and detail, editable drafts, explicit ordering, cancellation of unreceived remainder, expected delivery and completed-order lead time. Partial/full receipt dialogs show remaining quantities and keep a delivery history. Receipt processing writes stock, latest product cost, order state, RESTOCK history, receipt items and audit events atomically. Historic sale costs are not rewritten. Existing manual restock remains available. No supplier payments/payables ledger, messaging, forecasting or approval chain was added.
- **Concurrency / precision:** optimistic versions protect drafts/transitions; serializable transactions retry serialization conflicts; receipt references are idempotent and payload-checked. Over-receipts, duplicate lines, negative/non-finite values, foreign-business references and inactive products/warehouses are rejected. Decimal(16,4) quantities/costs and Decimal-computed totals (rounded to two places) avoid accumulating float error in purchase values. Existing WarehouseStock/Product numeric storage remains compatible.
- **Schema / rollout:** additive migration `20261112100000_add_purchasing` adds Supplier, PurchaseOrder, PurchaseOrderItem, PurchaseReceipt, PurchaseReceiptItem and PurchaseStatus. Applied to local `business_webapp` and `business_webapp_test` only, with regenerated Prisma Client and a separately restarted verification backend. Cloud demo/production were not migrated or deployed. Deployment must apply migrations, generate Prisma Client and restart the API.
- **Automated verification:** backend Jest 14/14 (4 new purchasing tests covering receipt lifecycle, cost/stock/history/audit effects, idempotency, concurrent deliveries, role and business scoping, foreign references, stale draft edits, archived suppliers and cancellation). Frontend Vitest 23/23 (new Dashboard tests for actual/empty data and per-business employee report restrictions; new Sales test for cash-versus-credit balances). TypeScript/production build clean apart from the existing large-chunk warning. Added French strings for the new navigation, dashboard and purchasing flow.
- **Live verification:** a disposable `__dashboard_*` business/account in the local dev database, with preview-only inventory and sales. Through the real UI: login, business selection, dashboard data/charts, supplier creation, ten-unit purchase draft at unit cost 33, mark ordered, receive 4 then 6, completed order with two receipts, Sales history and receipt opening. Direct scoped DB verification confirmed Main store stock 120→130, cost 30→33, status RECEIVED and two delivery records. No real business records were edited.
- **Visual verification:** 1440x900 desktop light/dark; 390x844 mobile dark/dashboard, mobile nav and Purchases table. A hidden chart tooltip initially caused a 14px horizontal overflow on phones; edge anchoring plus hiding hover-only tooltips on small screens fixed it (main scrollWidth == clientWidth). Tabular chart data remains available to keyboard/screen-reader users. Screenshots: `/tmp/vae-dashboard-light.jpg`, `/tmp/vae-dashboard-dark.jpg`, `/tmp/vae-dashboard-mobile-dark.jpg`, `/tmp/vae-purchase-received.jpg`. The disposable preview business/account is cleaned up after verification.


### Refresh the stale local API after purchasing rollout (2026-11-12)

- User's Suppliers screenshot showed the generic load error at localhost:5173. Traced the frontend configuration to localhost:5000 and identified the API process as having started at 09:00, before the purchasing implementation and regenerated Prisma Client.
- Reproduced on the actual port 5000 with a disposable `__supplier_check_*` account/business: authenticated GETs to both purchasing/suppliers and purchasing/orders returned 404 Route not found. The initial unauthenticated probe returned 401 because the parent business router authenticates requests before unmatched subroutes; an unauthenticated 401 alone does not prove a new route is mounted.
- Restarted that specific local backend with the current checkout under nodemon, preserving port 5000 and the existing .env/database/session configuration. The backend is intentionally left running for the user's frontend.
- Repeated the same authenticated checks after restart: both endpoints return 200 with the expected empty paginated result and the correct localhost:5173 CORS origin. Temporary accounts/businesses were removed immediately after each check. No product code, production deployment, or real business records changed.


### Pocket Register implementation (2026-11-13)

Victor selected the third of three interactive register concepts, Pocket Register, for implementation in the existing app.

- Replaced the search/staging-card layout with a browsable catalog, short-code/name search and pack/quantity dialog. Catalog availability subtracts all quantities already reserved on this ticket, across pack sizes. Product initials and a package mark use actual catalog data; no product-photo storage or invented product imagery was added.
- Added Products → Basket → Payment navigation. Larger screens retain the product catalog beside the basket/payment panel. Phones show one step with an always-reachable basket dock; lists and payment fields scroll within their panes. Basket editing supports fractional quantities, selling-price overrides, discounts, removal and quantity controls. Shared totals keep discounts visible before payment.
- Preserved the business-scoped transaction endpoint, base-unit conversion, optional cash received/change, transfer notes, saved-customer-only credit and receipt workflow. Recent sales opens without unmounting the current ticket. Active-business changes explicitly remount the register to prevent a ticket from leaking between businesses. Submission is locked while pending; errors retain the ticket for retry.
- Fixed the existing frontend's line-only stock checks: add, edit and increment now consider the same product in every selected pack size. The backend remains the final atomic stock guard. No schema, backend endpoint, hosting or production data changes.
- Added scoped opaque light surfaces and neutral charcoal dark styling, and French labels for the new flow.
- **Automated verification:** TypeScript/Vite production build passed; frontend Vitest 31/31 and backend Jest 14/14 passed. Eight new Register integration tests cover aggregate pack stock on add/edit/increment, discounted base-unit submission and receipt opening, strict saved-customer credit and payment-mode resets, insufficient/exact cash (including floating-point noise), duplicate-submit blocking, failed-sale retry, business switching/history preservation, and the Enter/quantity workflow. The keyboard test emits a non-failing React act/suspense warning; the production build retains the existing large-chunk warning.
- **Live verification:** a disposable `__pocket_*` account/business on the existing local app. Completed a cash sale of two rice bags, one oil bottle and one discounted dozen of soap (434.20 GHS, received 500, change 65.80); opened its saved receipt and verified pack/discount display. Completed credit of 75 GHS to a selected saved customer (checkout was blocked before selection) and a 1.5 kg flour transfer sale of 52.50 GHS with its reference. Direct scoped database reads confirmed all three transactions, credit customer linkage, 12 soap base units at 21.60, and stock rice 120→118, oil 72→71, soap 25→13, coffee 36→35, flour 20.5→19. Only disposable data was written and all of it was removed after signing out.
- **Browser findings/fixes:** Enter in product search initially fell through to native submission of the newly opened dialog; preventing the original key default keeps the pack/quantity dialog open until the cashier confirms. At 320px the step navigation caused overflow; reduced narrow-screen spacing and an accessible icon-only recent-sales button fixed it. Payment totals round consistently to currency precision so exact tender does not show missing change due to binary floating-point noise. Vite hot replacement temporarily mixed old/new AuthContext module instances during test runs; a fresh app load after testing had no console errors, without changing auth code.
- **Responsive verification:** desktop 1440×900 light/dark, tablet 768×1024, compact desktop 1024×600, phone 390×844, and 320×568 including French browsing/payment. Measured main scrollWidth == clientWidth and scrollHeight == clientHeight; only the intended catalog/cart/payment content panes scroll. Screenshots: `/tmp/vae-pocket-desktop-light.jpg` and `/tmp/vae-pocket-mobile-payment.jpg`. No production deployment, commit or push was performed.


### Expanded countries and searchable phone selector (2026-11-13)

- Supplier phone country metadata already included India, but its native flag dropdown had no search field. Replaced the shared phone selector with a searchable, keyboard-accessible picker covering all 245 supported countries and territories. Matches English/French names, aliases, ISO codes and calling codes (India / IN / +91), including on supplier, customer, business, team, profile and signup forms. Number formatting and E.164 validation remain handled by the existing phone library.
- Expanded business-country options to the same 245 regions with bundled Unicode CLDR 49.0.0 currency defaults as of 2026-11-13; retained existing country display names and aliases. Existing businesses retain their stored currency. Country-name-to-ISO lookup now derives from the full metadata instead of a small manual list. Business setup also uses the searchable picker.
- Flags, localized labels and country/currency data are bundled locally; no third-party request is needed to open/search the picker. Added French copy and popup styles for light/dark/mobile layouts. No database schema changes or migrations.
- **Automated verification:** TypeScript/Vite production build passed; frontend Vitest 35/35 and backend Jest 16/16 passed. Four new frontend tests cover India name/ISO/calling-code lookup, French search/cancellation, new and legacy country defaults, and submitting the actual supplier form without accidental form submission on country selection. Two backend tests exercise the full 245-row country API, uniqueness, currency fields, selected current currency mappings and aliases/fallbacks. Existing build chunk-size, Register test act/suspense and pg deprecation warnings remain non-blocking.
- **Live verification:** disposable local `__countries_*` account/business. Saved and reopened an Indian supplier with +919876543210; confirmed search by India, IN and +91, keyboard Enter/ArrowDown selection and return focus to the phone input. French form resolves English India to Inde. Business setup renders all 245 choices, finds Nepal (NPR), and selecting India sets +91; creating a disposable Indian business persists country India, currency INR and the complete E.164 phone. Scoped Prisma reads confirmed both supplier and business values. All temporary businesses, supplier, audit entries and account were removed after logout.
- **Responsive verification:** desktop dark, tablet business setup, phone 390×844 light and narrow phone 320×568. Picker remains inside viewport with no horizontal document overflow; no browser console errors. Flags render as bundled SVGs. Screenshots: `/tmp/vae-countries-desktop.jpg`, `/tmp/vae-countries-mobile.jpg`. No production deployment, commit or push performed.


### Suppress browser-added receipt print details (2026-11-13)

- User reported unwanted username/title, time and localhost text around printed receipts. The receipt already isolates its contents with print CSS, but its 12mm `@page` margins leave room for Chromium's automatic title/URL/time/page decorations. Changed page margins to zero and moved a 12mm frame into the receipt itself, with fragment padding for long receipts. Paper size still follows the print dialog. Updated the old CSS comment that incorrectly said CSS could never suppress browser decorations; Chromium documents the zero-margin behavior at https://developer.chrome.com/blog/print-margins.
- Removed the dialog's screen padding/glass styling and hidden header/footer/close controls from print layout. The old direct-child display override could leave invisible screen-only header/footer space. Released Radix's body scroll lock/scrollbar compensation for printing, and receipt table rows avoid splitting across pages.
- Added a screen-only English/French hint explaining the browser's "Headers and footers" setting for browsers or user overrides that still add those details. No attempt to change the user's global browser preferences. Existing receipt data, branding and intentional "Served by" content are unchanged.
- **Automated verification:** TypeScript/Vite production build passed, frontend Vitest 35/35 and backend Jest 16/16 passed. Existing build bundle-size, Register test act/suspense and pg deprecation warnings remain non-blocking. Preserved the touched files' CRLF style; whitespace check passes with `core.whitespace=cr-at-eol`. No schema or backend changes.
- **Live screen verification:** disposable local `__receipt_*` account/business with a short cash receipt and a 60-row sample receipt. Opened both through Sales, checked desktop dark/light and 390px mobile, including French print guidance. Runtime stylesheet contains `@page { margin: 0px; }`; long receipt retains all 60 rows and print controls remain reachable on screen. No browser console errors. Saved screen preview `/tmp/vae-receipt-print-guidance.jpg`. Logged out and removed the temporary account, business, products, warehouse and both transactions.
- **Verification limit:** invoking Print receipt in the in-app browser timed out in the browser control call; its native print dialog is not exposed to the available UI tools. Actual print/PDF output, pagination and hardware margins are therefore not verified in this run. The user should refresh, check their browser's print preview and disable "Headers and footers" under More settings if it still adds decorations. Browser print preferences can override page CSS. No production deployment, commit or push.


### Reports workspace redesign (2026-11-13)

- Modernized all six Reports views to match the emerald light/neutral charcoal workspace, with a clear page header, responsive icon navigation, grouped date/export controls, summary cards, actual-data charts and consistent panels/lists/tables. Added current-day/week/month shortcuts, hourly sales on Daily, calendar-day charts on Weekly/Monthly, employee revenue rankings, product quantities/cost notes and a current warehouse-stock snapshot. Existing CSV/PDF export callbacks and receipt drill-down remain in place; receipt links now have explicit accessible button names.
- Shared report presentation components keep revenue/product/employee breakdowns consistent. Chart data remains available in an accessible table. No invented trends or percentage growth. Gross-sales and credit-sales labels distinguish sale value from cash collected; incomplete cost information remains visible.
- Reports now uses the active-business role for frontend access, matching the existing backend checks and workspace navigation. Switching businesses remounts report state so filters and selected receipts cannot carry into another business.
- Fixed the weekly UI/export average displaying zero because the API omits `avgDailySales`: the fallback divides existing gross sales by all seven calendar days, matching the monthly report's full-period denominator. Incomplete/reversed date ranges now keep their controls visible, disable export and pause report requests rather than sending invalid dates or showing stale data. Empty warehouse stock is identified separately from healthy stock.
- **Automated verification:** TypeScript/Vite production build passed, frontend Vitest 43/43 and backend Jest 16/16 passed. Seven new Reports integration tests cover totals/payment split/cost warnings, date filters and CSV export, weekly average/zero-day chart data, monthly PDF payload/units, invalid ranges, employee receipt drill-down/business reset, empty sales/stock and active-business role restrictions. An eighth new test verifies actual multi-page PDF bytes including branding, the final product row, units and footer. One full run hit the existing phone test's five-second timeout and leaked pending typing into its next test; all 43 pass with a 15-second test timeout, without changing those tests or production phone code. Lint has only existing warnings outside the Reports changes. Existing non-failing Register act/suspense and pg deprecation warnings remain.
- **Live verification:** disposable local `__reports_*` owner and staff, a populated business and an empty business. Checked all six populated views against 28 sample sales and six warehouse stock positions. Daily shows 686 GHS from five transactions; weekly 1,508 GHS / seven days = 215.43, and monthly 4,925 GHS. Stock correctly shows one out, two low and three healthy entries. Opened real receipts from Daily and expanded Team transactions; the sample 75 GHS transfer receipt has the correct product/unit. Verified the empty-date guard and Today reset. Weekly and team CSV downloads contain the expected totals, units, cost caveats and average. Both generated CSV files were removed after inspection.
- **Responsive verification:** desktop 1440×1000 light/dark, tablet 768×1024, phone 390×844, and all six views at 320×568 in French. Measured main scrollWidth == clientWidth in each narrow view. Charts scroll within their own frame where necessary and exact data is keyboard-accessible through View chart data. Compact stock counters and two-column navigation below 360px keep long translated labels usable. Screenshots: `/tmp/vae-reports-light.jpg`, `/tmp/vae-reports-desktop-dark.jpg`, `/tmp/vae-reports-mobile.jpg`.
- CSV and PDF now share a connected native download link and delayed blob-URL cleanup. The export menu reports caught generation errors with an English/French toast. Added real multi-page PDF generation coverage for branding, the last product row, units and footer. The browser confirmed CSV saving; PDF generation produced a valid 18KB blob without caught JavaScript errors, but a PDF download event/file has not been observed in the embedded browser. Live PDF saving remains unverified.
- **Final walkthrough limit/cleanup:** the configured LAN frontend address (10.170.20.63:5173) stopped responding near the end while localhost:5173 still returned 200. The browser stalled on the final switch to the empty business, so live empty-business confirmation and manual tab/viewport cleanup could not finish; automated empty-sales/empty-stock checks passed. No network configuration was changed. A guarded local Prisma cleanup removed both temporary users, both businesses and all associated sales/products/stock/customer records; verified user/business/transaction/product counts are zero. No real business records were edited. No schema, backend reporting logic, production deployment, commit or push changes.


### Critical security fixes: team takeover, stock-move IDOR, and `/auth/me` password-change gate (2026-11-20)

Fixed three critical security vulnerabilities found during a full codebase audit:

- **Cross-tenant account takeover via `addTeamMember` + `resetTeamMemberPassword` (`backend/src/services/team.service.js`, `team.controller.js`, `superadmin.service.js`)**:
  - `addTeamMember` previously allowed linking *any* existing username in the database (including another tenant's `SUPERADMIN` or staff) into the caller's business, after which `resetTeamMemberPassword` only checked `businessUser.role === "SUPERADMIN"` (not global role or owner boundary) and overwrote the user's global password.
  - Now `addTeamMember` rejects linking any global `SUPERADMIN` or any user who does not exclusively belong to another business owned by the same owner (`409 Username is already taken`), preserving the legitimate multi-business owner workflow.
  - `resetTeamMemberPassword` adds defense-in-depth checks against global `SUPERADMIN` and foreign-owner memberships (`403`), atomically bumps `tokenVersion` (revoking existing sessions immediately), and records a `team.password_reset` `AuditLog` entry (mapped in `SettingsActivity.tsx`). `resetSuperAdminPassword` also bumps `tokenVersion`. `team.controller.js` no longer fabricates `username + "123"` in the success message when attaching an existing user.
- **Cross-tenant stock IDOR & non-atomic stock writes in `moveStock` (`backend/src/services/product.service.js`)**:
  - `moveStock` never validated that `fromWarehouseId`, `toWarehouseId`, or `productId` belonged to `businessId` or were not soft-deleted (`belongsToBusiness` only checks `:businessId` in the URL).
  - Now validates all three against `businessId` and `deletedAt: null` (`404` on mismatch) and performs an atomic conditional `updateMany({ where: { quantity: { gte: quantity } }, data: { quantity: { decrement: quantity } } })` + `upsert` increment inside `$transaction`.
- **Forced password change bypassed on reload (`backend/src/services/auth.service.js`)**:
  - `getMe` (`GET /api/auth/me`) omitted `mustChangePassword` from its Prisma `select`, so reloading `/change-password` returned `undefined` and bypassed `ProtectedRoute`'s redirect. Added `mustChangePassword: true` to `getMe` so it matches `issueSession`.
- **Translations**: added French translations for the new error strings in `frontend/src/locales/fr/errors.json`.
- **Automated verification**: backend Jest 19/19 passed (3 new regression tests in `tests/business-scoping.test.js` and `tests/auth.test.js` covering cross-tenant team attachment/reset, legacy cross-owner defense-in-depth, legitimate multi-business attachment + session revocation + audit log, cross-tenant/soft-deleted stock moves, and `mustChangePassword` persistence across `/auth/me` before and after password change). Frontend Vitest 43/43 and `tsc -b` + Vite production build passed cleanly. No schema changes, commits, or deployments performed.


### Log redaction, credit-balance settlement after returns, and duplicate-item return guard (2026-11-20)

Fixed priorities #4–#6 from the codebase audit:

- **Redact sensitive HTTP headers from Pino logs (`backend/src/utils/logger.js`)**:
  - Added Pino `redact` paths (`req.headers.cookie`, `req.headers.authorization`, `req.headers["x-master-key"]`, `res.headers["set-cookie"]`) censored as `"[Redacted]"`. Verified live in `pino-http` request/response output that session JWTs are no longer logged in plaintext.
- **`CREDIT_BALANCE` returns now flow into credit payment settlement and customer balances (`backend/src/utils/creditBalance.js`, `transaction.service.js`, `customer.service.js`)**:
  - Extracted a single shared `computeCreditStats` / `withCreditStats` helper so transactions, credit payment settlement, and customer credit summaries can never drift apart.
  - `recordCreditPayment` now runs its lookup, validation, payment creation, and `paidAt` update inside a single `$transaction`, loading both `payments` and `returns` — so paying the remaining balance after a partial `CREDIT_BALANCE` return properly settles the sale (`paidAt` set) and overpaying past the reduced balance is rejected (`400`).
  - `customer.service.js`'s `getCustomers` and `getCustomerById` now select `returns` and compute `outstandingCredit`, `amountPaid`, and `balanceDue` through `computeCreditStats`, so the Customers directory and detail sheet match the Transactions/Credit view without lumping `CREDIT_BALANCE` returns into `amountPaid`.
- **Duplicate `transactionItemId` guard & atomic return checks (`backend/src/validators/transaction.validators.js`, `transaction.service.js`)**:
  - Rejected duplicate `transactionItemId` entries in `POST .../returns` at both the Zod validator and `createReturn` service layer (`400 "Each item can only appear once in a return"`), added French translation in `frontend/src/locales/fr/errors.json`, and moved `createReturn`'s read/cap/balance validation inside `$transaction` with atomic `warehouseStock.upsert` increments.
- **Automated verification**: backend Jest 22/22 passed across 5 suites (3 new tests in `backend/tests/credit-returns-and-logging.test.js` covering Pino redaction, full `CREDIT_BALANCE` return → customer balance → overpayment rejection → exact settlement flow, and duplicate-item return rejection at both HTTP and service layers). Frontend Vitest 43/43, `oxlint` (0 errors), and `tsc -b` + Vite production build all passed. No schema changes, commits, or deployments performed.


### Codebase audit completion: per-business roles, soft-delete filtering, proxy/timezone/atomic fixes, and UI polish (2026-11-20)

Completed the remaining High and Medium fixes (#7–#15) from the codebase audit:

- **Per-business role gating across the entire frontend (`useActiveBusinessRole` in `hooks/useActiveBusiness.ts`)**:
  - Added a single shared `useActiveBusinessRole()` hook (`activeBusiness?.roleInBusiness ?? user?.role`) and updated all 8 remaining screens/components that still read global `user?.role`: `Products.tsx`, `Warehouses.tsx`, `Team.tsx`, `Customers.tsx` (both tabs), `StockMovements.tsx`, `TransactionDetailSheet.tsx`, `CreditCustomerPicker.tsx`, `CreditPaymentHistoryDialog.tsx`, plus `Topbar.tsx`'s role label. Staff promoted to `ADMIN` in a business now immediately get management controls across every screen without `User.role` needing to change.
- **Soft-delete filtering across Stock Alerts, Warehouses, Products, and Business summaries**:
  - `report.service.js`: `getStockAlertReport` now filters `warehouse: { businessId, deletedAt: null }` and `product: { deletedAt: null }`; `getProductReport` filters active warehouses.
  - `warehouse.service.js`: `getWarehouses` and `getWarehouseById` filter `product: { deletedAt: null }` on both `stock` and `_count.stock`.
  - `product.service.js`: `getProducts` and `getProductById` filter `warehouse: { deletedAt: null }` on `stock`.
  - `business.service.js`: consolidated duplicated detail includes into `BUSINESS_DETAIL_INCLUDE` and filtered `deletedAt: null` on `warehouses` and `_count.warehouses`/`_count.products`.
- **Proxy, date/timezone, email, and transactional safety fixes**:
  - `app.js`: enabled `app.set("trust proxy", 1)` for Vercel/Render proxy rate limiting.
  - `transaction.service.js`: fixed the Sunday week-start bug in `getTransactionSummary` using `date-fns`'s `startOfWeek(..., { weekStartsOn: 1 })`, and moved `createTransaction`'s stock check + conditional decrement (`quantity: { gte: totalRequested }`) atomically inside `$transaction` (sorted by `productId`).
  - `backend/src/utils/parseDate.js`: parses `YYYY-MM-DD` strings as local calendar dates (preventing UTC-midnight off-by-one shifts on non-UTC hosts) across `report.service.js`, `transaction.service.js`, and `product.service.js`. Same midday fix applied to `Dashboard.tsx`'s chart dates (`parseIsoDay`).
  - `email.utils.js` & `auth.service.js`: `getPrimaryClientUrl()` extracts the first origin from comma-separated `CLIENT_URL` for reset/welcome email links, `escapeHtml()` escapes `fullName` in `welcomeEmailHtml`, and `sendEmail` no-ops in `NODE_ENV=test` (stopping outbound Brevo 401s during Jest runs).
  - `business.service.js`: fixed `updateBusiness` to throw `AppError(..., 404)` instead of bare `Error` (`500`).
  - `auth.controller.js`: `res.clearCookie("token", AUTH_COOKIE_OPTIONS())` now passes matching cookie attributes.
  - `warehouse.service.js`: wrapped `createWarehouse` and `setPrimaryWarehouse` primary promotion/demotion in `$transaction`.
  - `product.validators.js`, `product.service.js`, `product.service.ts`, `ProductFormDialog.tsx`: editing a product now supports explicitly clearing `shortCode` and `costPrice` back to `null`.
- **Frontend reliability & UX fixes**:
  - `PurchaseForms.tsx`: added RFC-4122 v4 `generateRequestId()` fallback (`crypto.getRandomValues`) for plain HTTP LAN access where `crypto.randomUUID` is unavailable; added `audit-log` invalidation in `usePurchaseRefresh`; debounced supplier picker search; passed active business `defaultCountry` from `Suppliers.tsx` into `SupplierForm`.
  - `Purchases.tsx` & `Suppliers.tsx`: debounced search inputs (`250ms`) and remounted inner views on `activeBusinessId` change so dialogs/pagination reset cleanly.
  - `SettingsActivity.tsx` & `locales/fr/common.json`: added human-readable English/French labels and details for `transaction.returned`, `stock.adjusted`, `team.password_reset`, `SUPPLIER_*`, and `PURCHASE_*`.
  - `sonner.tsx`: switched `useTheme` from unused `next-themes` to `@/context/ThemeContext` so toast styling follows the app's theme toggle.
  - `Pos.tsx`: invalidated `dashboard-sales`, `report-stock-alerts`, `warehouses`, `stock`, and `customers` after completing a sale.
  - Removed dead empty `backend/src/socket/` directory and stale `backend/backend.log`.
- **Automated verification**: backend Jest 26/26 passed across 6 suites (4 new tests in `backend/tests/reliability-and-filters.test.js`); frontend Vitest 45/45 passed across 11 suites (2 new tests in `frontend/src/pages/Products.test.tsx`); `oxlint` (0 errors) and `tsc -b` + Vite production build passed cleanly. No schema changes, commits, or deployments performed.

### Pair-debug security, concurrency, and inventory-operations hardening (2026-11-23 — verified locally)

Joint audit and fix pass conducted across Antigravity and Codex (Codex session `01a2080a-87f7-75a0-9fc4-f6dc24a59100`):

- **Session token boundary** (`auth.middleware.js`, `auth.service.js`): ordinary authentication now rejects non-session `purpose` claims and non-session `tokenType` claims before looking up the account. Both completed login paths issue `tokenType: "session"`. Existing session tokens without either claim remain valid subject to the existing token-version and expiry checks. Closes pending-2FA/password-reset token use as bearer/cookie sessions for accounts whose `tokenVersion` is still `0`.
- **Cost snapshot visibility** (`utils/transactionResponse.js`, `transaction.*`, `customer.*`, `product.*`): one shared non-mutating response helper (`canViewCostPrice`, `stripItemCostPrice`, `withTransactionCostVisibility`) hides `TransactionItem.costPrice` by default and enables it only for per-business `SUPERADMIN`/`ADMIN` roles across sale creation, list/detail, payment creation/undo, returns, customer detail/restore/merge, and product detail's nested `transactionItems`.
- **Sale ledger serialization** (`transaction.service.js`): `recordCreditPayment`, `undoCreditPayment`, and `createReturn` acquire a parameterized `SELECT ... FOR UPDATE` lock scoped by transaction id and business id before reading any ledger state. Undo validates the payment inside the transaction and recomputes `paidAt` from remaining payments plus credit-balance returns.
- **Primary warehouse serialization** (`warehouse.service.js`): creation, primary promotion, and deletion lock the `Business` row (`FOR UPDATE`) and recheck primary status inside the transaction so concurrent first-warehouse creation or delete-vs-promote cannot violate single-primary invariants. No schema migration added.
- **Stock service concurrency & deadlock hardening** (`product.service.js`):
  - `receiveStock`: sorted items by `productId` and switched from read-then-write (`existingStock.quantity + quantity`) to atomic `tx.warehouseStock.upsert` with `{ increment: quantity }` + deadlock retry, eliminating lost updates under concurrent restocks/sales.
  - `adjustStock`: moved `WarehouseStock` lookup inside `prisma.$transaction` with `FOR NO KEY UPDATE` on `Product` and `FOR UPDATE` on `WarehouseStock` before reading `previousQuantity` and upserting.
  - `moveStockBatch`: acquired canonical sorted `FOR NO KEY UPDATE` locks on the two involved `Warehouse` rows inside `prisma.$transaction` (serializing opposing `A -> B` and `B -> A` transfers without blocking `FOR KEY SHARE` FK checks from concurrent sales) plus bounded deadlock retry.
- **Frontend build, timeline, exports, cache & i18n fixes**:
  - `MoveStockDialog.test.tsx`: removed invalid `exact: true` on `ByRoleOptions` so `tsc -b && vite build` passes cleanly.
  - `vite.config.ts`: capped `test.maxWorkers: 2` to prevent worker pool startup timeouts under local load.
  - `StockMovementTimeline.tsx`, `lib/stock-movements.ts`, `locales/fr/stock.json`: displayed localized `adjustmentReason` on `ADJUSTMENT` items, formatted time with `i18n.language`, and added missing French translations (`Yesterday`, `Pending`, adjustment reasons, transfer validation messages).
  - `StockMovements.tsx`: added `Previous quantity`, `New quantity`, `Delta`, and `Reason` columns to CSV export, added adjustment reason to PDF export, and fixed origin labels (`Customer return` for `RETURN`, `—` for `ADJUSTMENT`, `External` for `RESTOCK`).
  - Centralized `invalidateStockQueries()` in `lib/stock-movements.ts` (`stock-movements`, `products`, `warehouses`, `warehouse`, `stock`, `report-stock-alerts`) and wired it into `MoveStockDialog`, `AdjustStockDialog`, and `ReceiveStockDialog`.
  - `AdjustStockDialog.tsx`: disabled submit while `mutation.isPending` (preventing double submits).
  - `MoveStockDialog.tsx`: added inline requested base-unit quantity and exceeds-available warning alongside available stock.
  - Fixed `react-hooks/exhaustive-deps` warnings in `StockMovements.tsx`, `Team.tsx`, and `PlatformAdmin.tsx`.
- **Automated verification (verified locally against live PostgreSQL `_test` DB)**:
  - Backend Jest: **10/10 suites passed, 70/70 tests passed** (52.6s), including `tests/session-and-cost-unit.test.js` (17 unit checks), `tests/session-and-cost-visibility.test.js` (7 HTTP/DB tests), `tests/ledger-and-warehouse-concurrency.test.js` (9 PostgreSQL locking concurrency tests), and `tests/stock-batches.test.js` (11 HTTP/DB tests including opposing `A->B`/`B->A` transfers, concurrent restocks, foreign warehouses, deleted products, and employee `costPrice` stripping on product detail).
  - Frontend: `npm run build` (`tsc -b && vite build`) clean; `oxlint` 0 errors (14 warnings, down from 17); Vitest **15/15 files passed, 61/61 tests passed** (15.4s).
- **Scope**: no new schema migrations, commits, pushes, or deployments were performed. Live browser walkthrough of the updated StockMovements timeline/dialogs has not yet been run in this pass. Request idempotency for stock operations and DB partial unique index for primary warehouses remain documented follow-up suggestions.

### Second paired hardening, CI, and readiness batch (2026-11-23 — verified locally, Codex sign-off)

Follow-up cross-review and hardening pass in the same Codex session (`01a2080a-87f7-75a0-9fc4-f6dc24a59100`, Turns 3–5):

- **Warehouse deletion & cross-service lock coordination** (`warehouse.service.js`, `product.service.js`, `purchase.service.js`):
  - `warehouse.service.js`: `Business` serialization switched to `FOR NO KEY UPDATE` (preventing deadlocks against stock-audit `FOR KEY SHARE` FK checks), and `deleteWarehouse` takes a business-scoped `FOR UPDATE` lock on the target `Warehouse` before checking active/primary status or positive stock.
  - `product.service.js`: `moveStockBatch`, `receiveStock`, and `adjustStock` recheck `deletedAt IS NULL` inside `$transaction` under `Warehouse FOR NO KEY UPDATE`. `adjustStock` removed its `Product` lock (eliminating a `Product -> WarehouseStock` vs `WarehouseStock -> Product` lock-order inversion with `purchase.service.js`) and now inserts any missing `WarehouseStock` row via `INSERT ... ON CONFLICT DO NOTHING` before `SELECT ... FOR UPDATE` (so a no-op throw rolls back any inserted zero row cleanly).
  - `purchase.service.js`: `receive` joined the same `Warehouse FOR NO KEY UPDATE` + active-status check inside `atomic()`. Live deterministic race testing caught a Prisma 7 + `@prisma/adapter-pg` bug where PostgreSQL `40001` conflicts on `$queryRaw` surface as `P2010` with `meta.driverAdapterError.cause.originalCode === "40001"` rather than `P2034`; updated conflict retry checks in both `purchase.service.js` (`isSerializationConflict`) and `product.service.js` (`isRetryableTxConflict`).
- **Temporary-password enforcement & 2FA setup guard** (`auth.middleware.js`, `auth.service.js`, `tests/helpers.js`, `tests/auth.test.js`):
  - `authenticate()` selects `mustChangePassword` from the database on every request and returns `403 Password change required before continuing` for every route except `GET /api/auth/me`, `POST /api/auth/logout`, and `POST /api/auth/change-password`. `addAndLoginTeamMember` now completes onboarding by default (with `{ skipPasswordChange: true }` for temporary-password tests).
  - `setupTwoFactor` rejects accounts with `twoFactorEnabled: true` (`409`) and conditions the write on `twoFactorEnabled: false`, closing a bypass where `/2fa/setup` could disable 2FA without passing `/2fa/disable`'s password check.
- **Database readiness probe & HTTP compression** (`utils/health.js`, `app.js`, `backend/package.json`):
  - Preserved fast DB-independent `GET /api/health` liveness and added `GET /api/ready` using a short-lived `pg.Client` running `SELECT 1` with a single 3-second total deadline, returning `200` when healthy and generic `503` on failure/timeout.
  - Installed and mounted `compression` middleware (`app.use(compression())`) in `backend/src/app.js`.
- **Frontend polish & GitHub Actions CI** (`lib/stock-movements.ts`, `lib/format.ts`, `StockMovementTimeline.tsx`, `StockMovements.tsx`, `locales/fr/stock.json`, `.github/workflows/ci.yml`):
  - Added `"product"` to `invalidateStockQueries()`, added optional `locale` parameter to `formatDate`/`formatDateTime`, and localized `StockMovementTimeline` date headings plus `StockMovements` CSV/PDF headers, times, reasons, and origin labels.
  - Added `.github/workflows/ci.yml` running disposable PostgreSQL 16, `prisma generate`, `npm run test:migrate`, backend Jest, and frontend `oxlint`, `npm run build`, and Vitest (`--maxWorkers=2`).
- **Automated verification (verified locally against live PostgreSQL `_test` DB)**:
  - Backend Jest: **12/12 suites passed, 104/104 tests passed** (96.7s), including deterministic PostgreSQL lock-barrier concurrency tests across `tests/ledger-and-warehouse-concurrency.test.js` and `tests/stock-batches.test.js` (missing-row adjustment vs first receipt, adjustment vs PO receipt, deletion vs transfer, deletion vs PO receipt), plus `tests/health.test.js`, `tests/health-unit.test.js` (fixed `finally { jest.useRealTimers(); }` before `setup.js` `afterEach`), `tests/session-and-cost-unit.test.js`, and `tests/session-and-cost-visibility.test.js`.
  - Frontend: `npm run build` (`tsc -b && vite build`) clean; `oxlint` 0 errors (14 warnings); Vitest **15/15 files passed, 61/61 tests passed** (19.7s).
  - Codex Turn 5 read-only cross-review sign-off: no remaining blockers found.
- **Remaining pre-closure / deployment items**: no new schema migration added in this hardening batch (existing `20261123100000_add_stock_movement_batches` migration + `prisma generate` + backend restart remain deployment prerequisites); no commits or pushes performed; light/dark/mobile browser walkthrough of the updated Stock Movements UI and first GitHub Actions CI run after push remain to be completed.
