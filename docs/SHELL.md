# v2 shell: the grid button, a personal left bar, and Ctrl/⌘+K search

2026-10-28, branch `v2-shell` (from `v2` at cb4b56e). Local only: the v2
database in `dev/v2db`. Nothing here touches production.

## What the owner asked for

- Not everyone has every module. A **grid button** (four rounded squares) at
  the top of the left rail opens a screen with **all the modules** that
  person may open.
- The **left bar keeps the modules a team uses most**. For example,
  marketing people see Marketing and Insights there. Every other module they
  may open is one click away through the grid.
- **Ctrl/⌘+K searches everything**. The AI "ask" mode comes later and is
  built last. There is no trace of it on screen now.

## What was built

| Piece | Where |
| --- | --- |
| Grid button: the rail's first item, labelled "Apps" / "التطبيقات" | `src/components/layout/Rail.jsx` |
| All-modules screen = Home: one tile per section, now with a pin | `src/pages/home/index.jsx` |
| Pin rules (defaults, toggling, what the rail draws) | `src/lib/shell/pins.js` (+ tests) |
| Pins, read once and shared by the rail and Home | `src/components/layout/usePins.js` |
| Pins table, one row per person per company | `supabase/migrations/20261127_shell_1_pins.sql` |
| Search: one `search(query, who, ctx)` entry, one provider per module | `src/lib/shell/search.js` (+ tests) |
| One SQL search function per module | `supabase/migrations/20261127_shell_2_search.sql` |
| The palette (↑ ↓ Enter Esc) and a Search button in the top bar | `SearchPalette.jsx`, `Topbar.jsx`, `AppLayout.jsx` |
| Database rules test | `supabase/shell.test.js` |

### The left bar

- **What it shows:** the logo, the grid button, the person's pinned
  sections, and then the global pages at the foot (Tasks, Assistant,
  Requests, Settings).
- **Default pins** (for someone who never chose): the sections where they
  hold work or manage level. If that leaves nothing, all their sections. The
  access admin manages everything, so gets everything.
- **Losing access:** a pinned section is not drawn once the person loses
  access to it. The pin is kept, so it comes back if the grant does.
- **One section only:** someone with a single section always has it, and
  sees no pin toggles.
- **The open section shows while you're in it:** a section you opened from
  the grid appears on the rail until you leave, so you can always see where
  you are. It is not saved as a pin.
- The hover panels and badges work as before.

### The search

- **Pages** come from the browser at once (`ALL_PAGES` with `canVisit`), in
  both languages whatever the app's language.
- **Records** appear from the second letter on:
  - leads
  - CRM opportunities
  - Contacts organisations and people
  - HR employees
  - tasks
  - requests
- **Who sees what:**
  - A module is asked only when the person can open it.
  - Each SQL function is SECURITY INVOKER, so the module's own RLS decides
    what comes back: a salesperson's own leads, a request's people, and so
    on.
  - Each function also filters by `workspace_id`.
- **Arabic:** letter forms are folded the same way as in Contacts (أ إ آ → ا,
  ة → ه, ى → ي, diacritics out): `shell_fold()` in SQL, `normalizeSearch` in
  the browser. "ابراج" finds "أبراج".
- **Ranking:**
  1. the exact name
  2. a name that starts with the query
  3. a word that starts with it
  4. the query anywhere
  
  Closed, archived and done records come after open ones. A page found
  under its section's name comes after pages named for the query.
- **When a part fails,** the palette says which part ("Some parts could not
  be searched: CRM") instead of showing "Nothing found".
- **Where results open:**

  | Result | Opens |
  | --- | --- |
  | Lead in the pipeline | `/sales/leads?view=pipeline&lead=<id>` |
  | Lead still in the inbox | the Leads list, searched for it (`?q=`, now read by the board) |
  | Person | their organisation's page |
  | Person with no organisation | the People list, searched |

## Decisions taken (safe, reversible; the owner can change any)

1. **The grid opens Home, not a second screen.** Home already had a tile per
   section, so it is the all-modules screen, and each tile now has a pin.
   Two near-identical screens would drift apart. On the rail, the grid
   button replaces the old Home icon.
2. The open section shows on the rail while you're in it, even if it isn't
   pinned (see above).
3. Pins live in the database (`shell_pins`), per person per company, so they
   follow the person across devices. A failed read draws the defaults. A
   failed save says so and re-reads.
4. Records need two letters, because one letter matches half the book.
   Pages need one.
5. There are no recent searches, as the brief preferred.

## Left for the AI mode (not built, nothing shown)

`MODES` in `src/lib/shell/search.js` holds the palette's runners. Today it
has only `search`. The assistant's "ask" mode would be added like this:

1. Add a second runner to `MODES` over the same input.
2. Add a two-option switch above the input in `SearchPalette.jsx`, drawn only
   when `MODES` has more than one entry.

To add a new module to the search:

1. Add one provider to `PROVIDERS`.
2. Add one `shell_search_<module>` SQL function with the same return shape.

## How it was checked

- `npx vitest run`: the full suite passes, including 36 shell logic tests
  and 9 PGlite database tests (pins RLS, folding, ranking, grants).
- `npx eslint src`: no errors in the new code.
- `npx vite build --mode v2`: passes.
- In the running app on :5185:
  - **As `staff.admin@` (access admin):**
    - All 8 sections show on the rail by default.
    - Unpinning HR and Admin takes them off the rail, and the change
      survives a reload.
    - Opening HR from its tile shows HR on the rail while you're there.
    - ⌘K "najd" returns organisations and people. ↓ then Enter opens the
      organisation.
    - In Arabic, "ابراج" finds "شركة أبراج نجد" under "الجهات", and the whole
      palette is in Arabic.
  - **As `staff.marketing@` (Marketing and Insights at work level, CRM
    view-only):**
    - The rail shows Marketing and Insights. Home shows CRM with "Pin to the
      left bar".
    - The search returns CRM opportunities ("lighting", "مسجد"). It returns
      no contacts, leads or employees.
    - Esc closes the palette.
  - **At phone width (375 px):** Home tiles and their pins work, with no
    sideways scroll. The search button stays in the top bar.
  - The test pin row was deleted afterwards, and `shell_pins` is empty again.

The migrations were applied to the local v2 database with
`dev/v2db/apply-migrations.sh`.
