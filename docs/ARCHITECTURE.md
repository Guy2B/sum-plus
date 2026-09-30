# Architecture

## Principles

1. **Local-first.** IndexedDB on the device is the source of truth. The app is complete without any backend; the cloud only adds sync, Pro connectors and billing.
2. **One runtime.** A single Vite bundle; heavy dependencies (Firebase, MSAL, Transformers.js) load on demand.
3. **Deterministic and explainable.** Every recommendation carries a score, the rules that fired, the dimensions that mattered and its uncertainties. AI can only route a question or rephrase an answer — a rephrasing that changes any number is rejected.
4. **Server-authoritative money and security.** Pro is written only by the signed payment webhook; Firestore rules and Cloud Functions enforce it.
5. **Honest integrations.** A connector is shown as "not configured", "Pro", "sign-in required" or "awaiting approval" — never simulated.

## Web app (`apps/web/src`)

```
domain/     pure logic, no I/O — unit tested
  types.ts        canonical model (21 collections, all records are Doc with id/createdAt/updatedAt/deletedAt)
  signals.ts      snapshot → normalised Signals (respects domain permissions)
  decision.ts     knowledge → facts → rules → behaviour → score → edition → explanation; arbitration (≤3, capacity, diversity, cross-source merge)
  planning.ts     capacity (work window, meetings, measured energy), day blocks, attention groups, conflicts
  coach.ts        grounded answers; cites only sources that were read and contained data
  editions.ts     5 editions × 4 languages; decision profiles
  finance.ts · wellbeing.ts · learning.ts · ics.ts · capture.ts · search.ts · backup.ts · legacy.ts · entitlements.ts
data/
  db.ts           IndexedDB: docs [collection,id], outbox (pending sync), kv
  store.ts        Preact signals + derived state (decisions, capacity, plan); all writes go through here
  actions.ts      done / later / dismiss → record update + feedback (feeds behaviour learning)
services/       Firebase (lazy), auth, sync, connectors, AI, payments, reminders, monitoring, health bridge
ui/             shell, router (hash), components, 20 screens
i18n/           fr (reference) + en/de/es; TypeScript enforces identical keys; non-FR locales lazy-loaded
```

### Scoring

`priority = base(importance, urgency, impact, cost of inaction, effort, confidence) + rules + behaviour (±12, only after ≥5 feedback) + edition (±30) − confidence penalty`, then `score = 100·(1 − e^(−priority/70))`. Bands: critical ≥85, high ≥70, medium ≥50. Promotions are forced to "ignore". Health signals are used only after explicit consent.

## Sync

- Path: `users/{uid}/{collection}/{id}`, settings at `users/{uid}/meta/settings`.
- Local writes enqueue in the outbox; `flush()` pushes settings first (rules read consent there), then batches of 400 with `serverUpdatedAt = serverTimestamp()`. A rejected record is retried alone and reported; it never blocks the queue.
- Pull: one listener per collection on `serverUpdatedAt > cursor`; conflicts resolve per record, last writer wins on `updatedAt`. Deletions are tombstones (`deletedAt`), purged locally after 45 days once synced.
- Never synced: `mailMessages`, `socialItems`, `coachMessages`. `health` requires recorded consent.

## Backend (`functions`)

| Function                                                                      | Type                                     | Purpose                                                                                               |
| ----------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `deleteMyAccount`, `onAuthUserDeleted`                                        | callable / auth trigger                  | Erase data, credentials, OAuth states, entitlement, auth user                                         |
| `exportMyData`                                                                | callable                                 | Portable server-side copy (credentials excluded)                                                      |
| `reportClientError`                                                           | callable                                 | Scrubbed client errors → Cloud Logging                                                                |
| `lemonSqueezyWebhook`                                                         | HTTPS (`/api/billing/lemonsqueezy`)      | HMAC-verified → `entitlements/{uid}`, out-of-order safe                                               |
| `imapConnect` / `imapSync` / `imapDisconnect`                                 | callable, Pro                            | App password encrypted (AES-256-GCM, AAD = uid:account); messages returned, never stored              |
| `socialStartAuth` / `socialOAuthCallback` / `socialSync` / `socialDisconnect` | callable + HTTPS (`/api/oauth/callback`) | LinkedIn, X, TikTok OAuth with one-time state, PKCE, return-URL allow-list, encrypted tokens, refresh |
| `adminDiagnostics`, `adminSetEntitlement`                                     | callable, `admin` claim                  | Readiness and manual grants (audited)                                                                 |
| `housekeeping`                                                                | scheduled hourly                         | Expired OAuth states and rate-limit windows                                                           |

All callables enforce App Check in production and rate-limit expensive operations.

## Security model (summary)

- Firestore: deny by default; owner-only paths; sync writes require Pro, valid shape, server timestamp; no client deletes; entitlements/credentials/audit are server-only.
- Hosting headers: strict CSP (no inline scripts), HSTS, COOP, frame-ancestors none, Permissions-Policy.
- Rendering: JSX only; ESLint forbids `dangerouslySetInnerHTML` and unsanitised DOM sinks.
- Secrets live in Secret Manager; the web bundle only contains public identifiers (checked by `release:check`).
