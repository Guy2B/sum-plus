# Cortex

Cortex is NEXT's sister app: where NEXT **decides** (Σ's three explained actions), Cortex **organises**: the day in time blocks, habits, a second brain (inbox, tasks, projects, linked notes) and writing projects (chapters, characters), plus an evening and a weekly review.

It is a second entry point of the same web app: `apps/web/cortex.html` → `src/cortex/main.tsx`.

## One product, one dataset

- **Same origin, same store.** Cortex is served next to NEXT (`/cortex.html`), so both read and write the same IndexedDB (`data/store.ts`), the same settings (language, theme, edition, work hours) and the same account and cloud sync. Nothing is copied between the apps.
- **Same engine.** Cortex reads NEXT's decisions (`data/actions.ts → visibleTop`) to offer Σ's three decisions as the day's priorities, with Σ's reason, and NEXT's day plan (`data/store.ts → dayBlocks`) for "Let Σ plan my day".
- **Same rules.** A task ticked in Cortex is done in NEXT; a habit logged in Cortex removes it from NEXT's decisions; NEXT's habit grid shows Cortex's quantities and passed days.
- **Same look.** Cortex imports NEXT's `styles/app.css` (tokens, buttons, cards, dialogs, toasts) and its shell markup (sidebar, top bar, bottom nav). `src/cortex/cortex.css` only adds Cortex pieces, prefixed `cx-`.

## Data model (shared, `domain/types.ts`)

| Collection   | What                                                                                                                           | New / extended |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| `habits`     | `days`, `target`, `unit`, `moment`, `icon`, `color`, `order` (all optional)                                                    | extended       |
| `habitLogs`  | `value` (quantity), `skipped` (passed day) (optional)                                                                          | extended       |
| `projects`   | `area` (`pro` / `writing` / `personal`), `color` (optional)                                                                    | extended       |
| `days`       | one per date (`id = YYYY-MM-DD`): intention, 3 priorities, time blocks, evening review; `id = routine` holds the saved routine | new            |
| `notes`      | title, body with `[[links]]`, kind (`note` / `idea`), project, tags, inbox                                                     | new            |
| `chapters`   | per writing project: title, status, words, order                                                                               | new            |
| `characters` | per writing project: name, role, notes                                                                                         | new            |

Old records keep their meaning: a habit without `days` follows its `cadence`, a log without `value` means "done". The habit rules live in `domain/habits.ts` and are used by NEXT (`wellbeing.ts`, `signals.ts`, Goals screen) and Cortex alike. The four new collections are synced (`firestore.rules → syncable`) and covered by the rules tests.

## Plans

Cortex is included in NEXT Pro and uses NEXT's upgrade dialog. Free keeps the existing limits (3 habits, 1 project) and adds 50 notes. Pro adds routines, the writing module (chapters, characters), unlimited notes and past weekly reviews (`domain/entitlements.ts`). While `config.openAccess` is on, everything is open, as in NEXT.

## Hosting

GitHub Pages serves one custom domain per repository (`next.algbr.eu`), so Cortex ships at **https://next.algbr.eu/cortex.html**. Keeping one origin is also what lets both apps share local data without an account.

To also answer on **cortex.algbr.eu**, point that name at a redirect to `https://next.algbr.eu/cortex.html` (e.g. a redirect rule at the DNS/CDN provider, or a one-file GitHub Pages site with a meta refresh). Serving Cortex directly from another origin would split local data: only signed-in users would see the same data, through cloud sync.

## Code map

```
src/cortex/
  main.tsx        boot: shared store, auth, service worker
  model.ts        pure logic: days, blocks, free slots, lanes, notes links, weekly review (unit tested)
  data.ts         writes through the shared store: days (debounced), tasks, habits, notes
  i18n.ts, i18n/  Cortex strings (fr reference + en/de/es, same locale as NEXT)
  router.ts       hash routes
  cortex.css      Cortex-only styles on NEXT tokens
  ui/             Shell, Timeline (drag), sheets, Focus, Σ bridge, screens/
```

Tests: `tests/cortex.test.ts` (habits, planning, notes, review), `e2e/cortex.spec.ts` (journey, notes, every view with axe), `e2e/mobile.spec.ts` (Cortex on a phone).
