# Phase K — Smart Reorder Suggestions

**Status: ⬜ Not started, deliberately sequenced last in the new feature track.** See `gap-analysis-2026-08.md`.

## Objective
Move low-stock alerting from a manually-set number (what exists today, see the Settings-configurable per-unit rule from 2026-08-05) toward a *suggested* reorder point derived from actual sales velocity — "you sell about 12 of these a week, you're down to 3, reorder soon" — without removing the existing manual rule, which stays as the fallback/override for products with too little history to forecast.

## Why it exists
This is the checklist's "demand forecasting" and "automated replenishment" items. Deliberately last because a forecast is only as good as the data behind it: it needs (a) enough real sales history per product to compute a meaningful velocity, and (b) Phase J's supplier lead-time data to know how far ahead to plan the suggestion. Building this first would produce a feature with nothing real to base its numbers on.

## Dependencies
Phase G (cost data, for "reorder this much to hit a cost-effective order size") and Phase J (supplier lead times, for "reorder this many days before you'd actually run out").

## Deliverables
- A computed suggested-reorder signal per product (average sales velocity over a trailing window, e.g. last 30/60 days) shown alongside the existing manual low-stock rule — additive, not a replacement.
- Where lead-time data exists (Phase J), factor it into the suggestion ("reorder now to arrive before you run out," not just "you're low").
- Products with insufficient sales history (new products, slow movers) fall back to the existing manual threshold rule entirely — no fabricated forecast from thin data.

## Risks
- Forecasting from short/sparse histories can produce misleadingly confident numbers — the UI needs to make clear when a suggestion is low-confidence (little data) vs. well-supported.
- Real scope discipline needed here: this is "a helpful suggestion," not a full demand-planning system with seasonality models, promotions handling, etc. — those are enterprise-shaped and not warranted at this scale.

## Expected outcome
The owner gets a genuinely useful "reorder this soon" nudge instead of just a static threshold, without losing the simple, always-understandable manual rule for anything the forecast doesn't have enough data to speak to.
