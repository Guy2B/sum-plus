# Security policy

## Reporting a vulnerability

Email the support address shown on `/legal/support.html` with **SECURITY** in the subject. Include the affected version, reproduction steps and a minimal example **without personal data**. We acknowledge within 72 hours and aim to fix critical issues within 7 days. Please do not open public issues for vulnerabilities.

## Threat model (summary)

| Asset                 | Threat                                    | Control                                                                                                                 |
| --------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Synced user data      | Cross-tenant access                       | Firestore rules scoped to `request.auth.uid`, collection allow-list, rules tests in CI                                  |
| Pro entitlement       | Self-granting                             | `entitlements/*` is server-write only; granted solely by the HMAC-verified payment webhook or an audited admin action   |
| Connector credentials | Theft / reuse                             | AES-256-GCM with Secret Manager key, owner-bound AAD, never readable by clients, deleted on disconnect/account deletion |
| OAuth flows           | CSRF, open redirect, code interception    | One-time server-side `state` (15 min), PKCE, return URL allow-list                                                      |
| Web client            | XSS, clickjacking                         | JSX-only rendering (lint-enforced), strict CSP, `frame-ancestors 'none'`, COOP                                          |
| Backend               | Abuse / quota exhaustion                  | App Check enforcement, per-user rate limits, bounded inputs (zod), SSRF guard for custom IMAP hosts                     |
| Supply chain          | Vulnerable or leaked dependencies/secrets | Lockfile, Dependabot, `npm audit` and gitleaks in CI, release gate scanning the bundle                                  |
| Observability         | PII in logs                               | Client and server scrubbing of emails, tokens and OAuth codes                                                           |

## Rules for contributors

- Never commit secrets. Public identifiers belong in `VITE_*`; secrets belong in Secret Manager.
- Never render HTML from data. Use JSX.
- Any new Firestore path must be added explicitly to `firestore.rules` **with tests**.
- Any external action (send, publish, delete, pay) requires explicit user confirmation.
