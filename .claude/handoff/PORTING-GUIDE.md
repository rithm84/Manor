# Manor native port: shared guide for every porting agent

> The port is complete; `app/` was deleted. Its sources are in git history on `main` before the `native-macos` branch (for example `git show main:app/src/...`). Keep this guide for its conventions.

Manor  is a personal productivity app for macOS. It is being rewritten
from a React + Tauri app (`app/`, `desktop/`) into a native Swift app (`macos/`). The Supabase backend
(`supabase/`: migrations, Edge Functions, `manor_command` RPC) does NOT change unless a change is truly needed;
if you believe one is, stop and report it instead of making it. The product owner wants: the same pages,
features, flows, and layouts as the React app, but native, efficient, Mac-optimized, and designed with craft.

## Read first (skim what is relevant to your module)

- `CLAUDE.md` (repo root): especially "Design Anti-Patterns (hard rules)" and "Domain Language". Binding.
- `docs/PRD.md`: the product rules. Your module's section and "Surfaces" are binding behavior.
- `docs/DESIGN.md`: the design charter (Mixpanel-like restraint, plum/gray, Outfit + DM Sans, light and dark).
- The React source for your module: `app/src/ui/pages/<Module>Page.tsx`, `app/src/ui/pages/<module>/`,
  its CSS, `app/src/web/services/<Module>Service.ts` (the exact reads and command inputs), and
  `app/src/shared/<module>.ts` (domain logic and its tests `*.test.ts`). The React app is the behavioral
  spec: port every feature, flow, state, and keyboard interaction, not just the happy path.
- Command semantics live in `supabase/migrations/*.sql` (search for the operation name inside
  `manor_private` functions) when the TS service is not enough.

## The native codebase (`macos/`)

Swift package, Swift 6.1 toolchain, Swift 5 language mode, macOS 15 deployment target, SwiftUI + AppKit.
Targets: `ManorKit` (library: backend, sync, domain logic) and `Manor` (the app), plus `ManorKitTests`.

### ManorKit core (do not edit; extend in your own files if you must)

- `Core/JSONValue.swift`: `JSONValue` enum, `Row = [String: JSONValue]`, `JSONObject` (command input),
  `ManorJSON.decoder` (snake_case → camelCase). `row.decode(MyStruct.self)`, `JSONValue.from(optional)`.
- `Core/Gateway.swift` (`@MainActor @Observable`), the only way to talk to the backend:
  - `rows(table, where: [RowFilter])` / `rows(table, as: T.self, where:)`: reads (local mirror once it
    serves, otherwise Postgres, owner-scoped). Decodable domain structs use camelCase properties.
  - `rowsFromServer(table, where:, columns:)`: force a server read (tables the mirror does not hold:
    `note_versions`, `note_attachments`, `action_events`, ...).
  - `command(operation, input, id:)` → `CommandReceipt` (`record`, `records`, `raw`). Runs `manor_command`
    with retries; publishes the affected tables afterward. Revision conflicts throw `ManorRequestError` with
    `isConflict` (code `PT409`). Inputs must match what the TS service sends, field for field.
  - `rpc(name, params)`, `derived(name, day:, params)` (cached account-derived RPCs), `function(name, body)`
    (Edge Functions), `client` (the `SupabaseClient` for storage or realtime if you really need it).
  - `changes(of: Set<String>)` → `AsyncStream<Set<String>>`: subscribe in a long-lived Task and reload
    when your tables change (own commands, mirror pulls from other devices, agents).
  - `isConnected`, `accountId`, `config`.
- `Core/Errors.swift`: `ManorRequestError` (reader-facing message), `ManorConnectionError`.
- `Core/Tables.swift`: table list, key order, `affected(by:)`.
- `Auth/ManorSession.swift`: sign-in state, `signOutGuards` (return a message to cancel sign-out),
  `signOutCleanups`, `mirrorFactory`.
- Put your module's pure domain logic (ported from `app/src/shared/*.ts`) in
  `macos/Sources/ManorKit/Domain/<Module>/` with Swift Testing tests in
  `macos/Tests/ManorKitTests/<Module>Tests.swift` (port the meaningful cases from the TS tests).

### The app target (`macos/Sources/Manor/`)

- `App/AppContext.swift`: `@Environment(AppContext.self) var context` in any signed-in view. Has
  `gateway`, `account` (`timezone`, `name`), `toasts` (`show(message, actionLabel:, action:)` for Undo,
  `showError`), `route`, `navigate(to:)`, `createRequests[route]` (Command-N; observe with `onChange`),
  `linkTarget` (deep-link path and query for a route), `calendar` and `today` in the account time zone,
  `openExternal(url)`. `LocalDate` converts `YYYY-MM-DD` strings.
- `App/MainView.swift` keeps visited pages alive (hidden, not destroyed), so page `@State` survives module
  switches. Keep module stores in `@State` on your page view (or a module-owned singleton keyed by account).
- `App/Route.swift`: routes, titles, SF Symbols.
- `Design/Palette.swift`: every color role (`Palette.ink`, `.inkBody`, `.inkMuted`, `.surfaceCanvas`,
  `.surfacePaper`, `.surfaceSoft`, `.surfaceHover`, `.surfaceSelected`, `.hairline`, `.primary`,
  `.primaryTint`, `.completion`, `.overdueError`, the `scale*` mood/focus roles, `pill*`, `streak*`, ...),
  generated from `app/src/ui/styles/tokens.css`, light and dark tuned independently. Never hard-code colors.
- `Design/Typography.swift`: `.font(.ui(size, weight:))` (DM Sans), `.font(.display(size))` (Outfit),
  `.font(.code())`, `Typography.Size.*` (12 minimum; 11 only for dense time-grid gutters), `.tabular()`.
- `Design/Metrics.swift`: `Space.s1...s12`, `Radius.*`, `Motion.press/fast/base/panel/settle`, `Layout.*`.
- `Design/Components/`: `ManorButtonStyle` (`.buttonStyle(.primary/.secondary/.ghost/.danger)`,
  `.manor(kind, size: .small)`), `IconButton`, `Pill`, `CompletionCheckbox`, `.textFieldStyle(.manor)`,
  `SearchField`, `SegmentedTabs`, `.rowBackground(selected:)`, `.manorDialog(isPresented:/item:)` +
  `DialogPanel` + `ConfirmPanel` (centered dialogs; the ONLY way to show object details), `PageHeader`,
  `EmptyState`, `ErrorBanner`, `Hairline`, `ManorLogo`, `ToastCenter`.
  Do not edit these shared files. Build module-specific components inside your module folder. If a shared
  component is missing something important, build a local version and say so in your report.

## Rules

1. **Ownership.** Edit only the files and folders your brief assigns. Other agents are editing the rest of
   `macos/` at the same time. Never touch another module's folder, the shared design or app files, or
   `app/`, `desktop/`, `supabase/`, docs. Never run git commands that change the tree (no checkout, reset,
   stash, commit, clean); `git status/diff/log` are fine.
2. **Builds.** From `macos/`, build with your own scratch path so you never block others:
   `swift build --scratch-path .build-<your-agent-name>` and test with
   `swift test --scratch-path .build-<your-agent-name> --filter <YourTests>`. Keep your folder compiling
   at all times (write in small compilable steps). If the build fails only because of errors in another
   agent's files, wait a minute and retry; do not edit their files. The first build of a scratch path
   takes a few minutes (dependencies).
3. **Native and Mac-optimized.** SwiftUI first, AppKit (`NSViewRepresentable`) where SwiftUI is weak
   (text editing, high-performance lists, precise drag and drop). Lazy stacks or `List`/`Table` for long
   collections; avoid recomputing derived data in `body`; keep main-thread work small. Native menus,
   context menus (`.contextMenu`), popovers, date pickers, `.help` tooltips, keyboard shortcuts, focus
   rings, hover states, and drag and drop where the React app has them.
4. **Design with craft.** Follow the charter and the hard rules: UI copy in product voice (no spec or
   mechanism captions), **no em dashes in UI copy**, no text below 12 pt, tabular numerals for stats and
   times, state shown through color, weight, and emphasis rather than label chips, compact rows for growing
   collections, content edge to edge (no padded card around a whole page), object details as centered
   dialogs (never `.sheet`, drawers, inspectors, or side panels), no emoji as icons (SF Symbols), no
   mascots. Light and dark must both look deliberate. Motion is quick and purposeful (use `Motion`).
   Every surface ships its flows: create, edit, delete or archive, empty states, loading, errors.
5. **Data rules.** Never invent data or substitute mock data for real account data. Reads come from the
   gateway; writes go through `gateway.command` with the exact operation names and input shapes the TS
   services use, including `expected_revision` and stable command IDs where the TS code reuses one.
   Business dates use the account time zone (`context.calendar`, `context.today`), never the Mac's zone.
6. **Remove nothing outside your scope.** The old React code stays until the integrator deletes it.
7. **Report.** When done, reply with: what you ported (by feature), what is missing or simplified and why,
   any shared-file or backend change you need (exact description), how you verified it (build, tests),
   and anything that needs signed-in verification on staging.
