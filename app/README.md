# Manor frontend

_Last updated: 2026-09-13_

This package is the React application that the desktop shell in [`desktop/`](../desktop/README.md) packages as the macOS app: real Supabase services, account-scoped query state, durable Notes drafts, and the shared tool catalog. The architecture's [status section](../docs/ARCHITECTURE.md#status) records what is verified and what remains.

Run from the repository root:

```sh
npm --prefix app ci
npm --prefix app run typecheck
npm --prefix app test
npm --prefix app run build
```

`npm --prefix app run dev` starts the Vite development server on `127.0.0.1:5173`; `npm --prefix desktop run dev` opens the app window against it for unauthenticated interface work with hot reloading. The dev origin is not an authorized backend origin, so sign-in and end-to-end flows are tested on a staging desktop bundle. `npm --prefix app run build` writes the static bundle to `app/dist/`, which a desktop build embeds; the desktop scripts run it with the right Vite mode, reading `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from `app/.env.staging` or `app/.env.production`.

**Warning:** `VITE_` variables are compiled into the bundle. Only connection values belong there, never service-role, database, OAuth-client, or provider secrets.

`App` receives stable `ManorServices` instances for the active account and the desktop shell that opens authorization pages and delivers deep links. Adapters send mutations through the shared transactional command boundary and preserve edited revisions for conflict detection. Account changes reset session-scoped state. Anonymous fixtures remain in `src/ui/data/mock.ts`; signed-in loaders never substitute them for account records.

The Notes draft layer protects unfinished edits and pending attachments across relaunches, navigation, and sign-out attempts. File and agent-host behavior is verified against the deployed environment rather than inferred from unit tests; the checks are in the architecture's [migration and verification](../docs/ARCHITECTURE.md#migration-and-verification) section.
