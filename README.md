# Σ Life OS

Σ Life OS turns the signals you authorise (tasks, calendar, mail, social, money, energy, learning) into **at most three explained actions a day**. It is local-first, works offline, speaks French, English, German and Spanish, and never acts externally without confirmation.

## Repository layout

| Path                               | What it is                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `apps/web`                         | The product: PWA (Vite + Preact + TypeScript), landing page and legal pages                           |
| `apps/web/src/domain`              | Pure, tested business logic: decision engine, planning, coach, finance, ICS, backup, legacy migration |
| `apps/web/src/data`                | IndexedDB persistence and reactive state (signals)                                                    |
| `apps/web/src/services`            | Firebase, sync, connectors (Google, Microsoft, IMAP, social), AI, payments, monitoring                |
| `functions`                        | Cloud Functions (TypeScript, europe-west1): GDPR, billing webhook, IMAP, social OAuth, admin          |
| `firestore.rules`, `storage.rules` | Security rules (deny by default)                                                                      |
| `mobile`                           | Capacitor iOS/Android shells with Apple Health and Health Connect plugins                             |
| `services/local-ai-gateway`        | Optional self-hosted rephrasing gateway (Ollama)                                                      |
| `tests/rules`                      | Firestore rules tests (emulator)                                                                      |
| `docs`                             | Architecture, deployment, connectors, privacy, security, migration, mobile                            |

## Quick start

Requirements: Node 22+, npm 10+. Optional: Java 21 + Firebase CLI for the emulators.

```bash
npm ci
npm run dev            # http://localhost:5173/app.html — fully usable offline, no backend needed
```

Cloud features (account, sync, Pro, connectors) need a Firebase project: copy `apps/web/.env.example` to `apps/web/.env.local` and see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Quality gates

```bash
npm run verify         # lint + types + unit tests (web, functions, gateway) + builds
npm run test:e2e       # Playwright: journeys, offline PWA, legacy migration, axe accessibility, mobile
npm run test:rules     # Firestore rules against the emulator (needs Java 21)
npm run release:check  # commercial launch gate (live payments, legal identity, no secrets in bundle)
```

CI runs all of the above plus Lighthouse budgets, gitleaks and `npm audit` on every push (`.github/workflows/ci.yml`). Tags `vX.Y.Z` deploy to staging, then to production after approval (`deploy.yml`).

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — data model, sync, decision engine, security model
- [Deployment & operations](docs/DEPLOYMENT.md) — Firebase, secrets, CI/CD, monitoring, rollback
- [Connectors](docs/CONNECTORS.md) — Google, Microsoft, IMAP, LinkedIn, X, TikTok, Meta, Lemon Squeezy
- [Privacy & DPIA](docs/PRIVACY.md) — processing register, health data, retention, rights
- [Security](SECURITY.md) — policy and threat model
- [Migration from V1–V8](docs/MIGRATION.md)
- [Mobile](docs/MOBILE.md)
- [Changelog](CHANGELOG.md)
