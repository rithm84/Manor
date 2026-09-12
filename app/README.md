# Manor web app

_Last updated: 2026-09-11_

This package runs the Manor React application with real Supabase services, account-scoped query state, durable Notes drafts, and the shared WebMCP catalog. Production release acceptance is still pending; [ARCHITECTURE §1](../docs/ARCHITECTURE.md#1-status-and-scope) records the verified boundaries and remaining work.

Run from the repository root:

```sh
npm --prefix app ci
npm --prefix app run dev
npm --prefix app run typecheck
npm --prefix app test
npm --prefix app run build
```

The development server binds `127.0.0.1:5173` for unauthenticated UI work, typecheck, and tests. Localhost is not an authorized staging origin, so sign-in and end-to-end flows are tested on the hosted staging site ([ARCHITECTURE §1](../docs/ARCHITECTURE.md#1-status-and-scope)). Supply `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` through the app's local environment or deployment configuration, using staging for preview builds. These are browser connection values; never put service-role, database, OAuth-client, or provider secrets in a `VITE_` variable. The build writes the static web app to `app/dist/`.

`App` receives stable `ManorServices` instances for the active account. Web adapters send mutations through the shared transactional command boundary and preserve edited revisions for conflict detection. Account changes reset session-scoped state. Anonymous fixtures remain in `src/ui/data/mock.ts`; signed-in loaders never substitute them for account records.

The Notes draft layer protects unfinished edits and pending attachments across reloads, navigation, and sign-out attempts. File and agent-host behavior must still be verified against the deployed environment rather than inferred from unit tests. See the [architecture acceptance checks](../docs/ARCHITECTURE.md#11-migration-and-verification).

The Journal has its own package and build under `journal/`, its own Google session, and a required separate browser origin. Do not import Journal state, keys, or adapters into this application. Run its typecheck, tests, and build independently with the corresponding `npm --prefix journal` commands.
