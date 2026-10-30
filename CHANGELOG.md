# Changelog

## Unreleased · Cortex

- **Cortex** (`/cortex.html`), NEXT's sister app on the same data, account and engine: Today dashboard (Σ's decisions as priorities, agenda, habits, tasks, evening review), Planning (drag-and-drop time blocks, calendar events, "Let Σ plan my day", routines, focus mode), Habits (quantities, chosen days, moments, passed days, streaks, 20-week history, trends), inbox, tasks, projects, linked notes with backlinks, writing (chapters, characters), weekly review. Four languages, light and dark, phone layout.
- Shared model: habits gain days, quantity, moment, icon, colour; habit logs gain value and passed days; projects gain area and colour; new synced collections `days`, `notes`, `chapters`, `characters`. NEXT's engine and habit grid honour the new habit rules (`domain/habits.ts`).
- NEXT sidebar links to Cortex; Pro lists Cortex.

## 1.0.0 — 2026-09-30 · Production rebuild

Complete rebuild of Σ Life OS on a single, tested runtime, replacing the V1–V8 layered app (111 scripts) and the unused "engine" modules.

### Product

- Today, Attention, Plan, Σ Coach, Sources, Tasks (today/inbox/week/matrix), Projects, Calendar (ICS import/export, Google & Outlook sync), Goals & habits, Journal, Learning (spaced review), Finance, Health & energy, Household & school, Career, Mail (Gmail, Outlook, IMAP), Social (YouTube, LinkedIn, X, TikTok), My context (permissions, weekly review), Account, Admin QA.
- Five editions × four languages; natural-language quick capture; command palette (Ctrl+K); reminders; dark mode; installable offline PWA.
- Decision engine ported to TypeScript and recalibrated (soft-saturating score, edition influence capped, low-priority fill).
- Coach answers only from real data and cites the sources actually used.
- Legacy workspace migrated automatically on first launch.

### Security & privacy

- Pro granted only by the signed payment webhook; client-side licence codes removed.
- Deny-by-default Firestore rules with Pro, shape, timestamp and health-consent checks; no client deletes.
- Strict CSP and security headers; JSX-only rendering enforced by lint.
- Connector credentials encrypted server-side; OAuth with one-time state, PKCE and return-URL allow-list.
- Explicit, separate health consent; GDPR export and account deletion; EU region.

### Engineering

- Vite + Preact + TypeScript (strict); Firebase Functions in TypeScript; npm workspaces.
- 58 unit tests, 22 end-to-end tests (journeys, offline, migration, axe accessibility, mobile), Firestore rules tests.
- CI (lint, types, tests, E2E, rules, Lighthouse, gitleaks, audit); tag-based staging → production deployment with release gate.
- Capacitor 7 apps with Apple Health and Health Connect plugins.
