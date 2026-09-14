# Manor web app

_Last updated: 2026-09-13_

This package runs the Manor React application with real Supabase services, account-scoped query state, durable Notes drafts, and the shared tool catalog. The architecture's [status section](../docs/ARCHITECTURE.md#status) records what is verified and what remains.

Run from the repository root:

```sh
npm --prefix app ci
npm --prefix app run dev
npm --prefix app run typecheck
npm --prefix app test
npm --prefix app run build
```

The development server binds `127.0.0.1:5173` for unauthenticated UI work, typecheck, and tests. Localhost is not an authorized staging origin, so sign-in and end-to-end flows are tested on the hosted staging site. Supply `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` through the app's local environment or deployment configuration, using staging for preview builds. The build writes the static web app to `app/dist/`.

**Warning:** `VITE_` variables are compiled into the public bundle. Only browser connection values belong there, never service-role, database, OAuth-client, or provider secrets.

`App` receives stable `ManorServices` instances for the active account. Web adapters send mutations through the shared transactional command boundary and preserve edited revisions for conflict detection. Account changes reset session-scoped state. Anonymous fixtures remain in `src/ui/data/mock.ts`; signed-in loaders never substitute them for account records.

The Notes draft layer protects unfinished edits and pending attachments across reloads, navigation, and sign-out attempts. File and agent-host behavior is verified against the deployed environment rather than inferred from unit tests; the checks are in the architecture's [migration and verification](../docs/ARCHITECTURE.md#migration-and-verification) section.
