# ADR-0005: Additional guardian payment — store billing (Google Play + Apple IAP) + granted seats

- **Status**: Accepted (open decision 1; amended 2026-11-22 by ADR-0017 — Apple IAP is MVP scope)
- **Date**: 2026-11-22

## Context

Business rule: the primary guardian adds and pays for extra guardians inside the app. Both stores
generally require their own in-app purchase system for digital access to app features/services:
Google Play's Payments policy (Google Play Billing) and Apple's App Review Guidelines §3.1.1 (In-App
Purchase). Both platforms ship in the MVP (ADR-0017). Business rule: HomeBell never processes or
automates refunds.

## Options

1. **(a) Store billing on each platform** — matches the in-app flow; store fees apply; each store may
   refund under its own policy.
2. **(b) School buys guardian add-ons** — no in-app purchase at all; simplest compliance; contradicts
   "primary guardian pays in app".
3. **(c) Payment outside the app, no in-app link/steering** — breaks the in-app add-and-pay UX; fragile
   with respect to store policies and regional rules.

## Decision

**(a) on both platforms, plus seat grants from (b) as a second entitlement source.**

- Product `guardian_seat_term`: a one-time consumable product on both stores, one per seat per tenant
  term. A verified purchase grants one `LicenseSeat` expiring at the tenant's term end (ADR-0011).
- Flow (same API on both platforms):
  `POST /v1/me/license-purchases` (intent) → store purchase sheet →
  `POST /v1/me/license-purchases/{intentId}/complete` → server-side verification → seat.
  - **Google Play**: pass `obfuscatedAccountId` / `obfuscatedProfileId`; client sends the `purchaseToken`;
    server verifies with the Google Play Developer API, then acknowledges/consumes.
  - **Apple (StoreKit 2)**: pass `appAccountToken` (UUID from the intent); client sends the signed
    transaction (JWS) as `purchaseToken`; server verifies the JWS chain and the transaction with the App
    Store Server API, checks `appAccountToken`, then the client finishes the transaction.
  - Unverified purchases never grant access.
- Seats can also be granted by the school (`guardians.school_granted_seats`) or platform operators
  (charity/pilot/offline-paid deals).
- Billing is behind `IBillingProvider` (`google_play`, `apple_app_store`) server-side and
  `BillingService` client-side.

## Refund rule interaction

HomeBell **never initiates, calls or automates refunds**. Google or Apple may refund a purchase under
their own policies (user request, chargeback). Such refunds are _external events_:
Google Real-Time Developer Notifications / Voided Purchases API and Apple App Store Server Notifications V2
(`REFUND`, `REVOKE`) mark the purchase `voided`, the seat `voided`, the linked guardian `expired`, and
write audit entries. Any goodwill refund a family asks HomeBell for is handled manually by the business
team outside the app (a support note records it). This is consistent with the manual-refund rule.

## Consequences

- Store fees on both platforms (verify current Play and App Store fee schedules / small-business programs
  at Phase 5).
- Re-verify both stores' payment policies for the launch countries before Phase 5 (policies are
  region-specific and have changed recently).
- App Store review needs a demo account/flow for the purchase; the IAP product must be approved before
  the iOS release.
- Contract: `LicenseSeatSource` = `purchase | school_grant | platform_grant`; `BillingProvider` =
  `google_play | apple_app_store`; `PurchaseIntent.appAccountToken`; webhooks
  `/v1/webhooks/google-play` and `/v1/webhooks/app-store`; error codes `PURCHASE_VERIFICATION_FAILED`,
  `PURCHASE_ALREADY_PROCESSED`, `PURCHASE_PENDING`.
