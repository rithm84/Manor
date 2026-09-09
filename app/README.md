# Manor UI Foundation

_Last updated: 2026-09-09_

Reusable React routes, module components, rich Notes editor, styles, pure domain calculations, and validation tests for the web rebuild. This package builds a UI library; it is not a deployable Manor application yet.

`App` requires implemented `ManorServices`. These are view dependencies, not the final server or WebMCP contracts. There is no default adapter or mock backend. Individual components can receive their required services through `ManorServicesProvider`; missing services fail explicitly. Keep service instances stable for a mounted account session and remount the application when the account changes.

The future web entry point must supply authentication and signup gating, transactional commands and revisions, TanStack Query refresh, durable IndexedDB drafts and queued attachments, safe navigation/sign-out, Trash/purge, and the separate Journal link. The retained Notes screen's in-memory save queue does not supply offline or navigation durability. Do not deploy it before the [architecture acceptance checks](../docs/ARCHITECTURE.md#11-migration-and-verification) pass.

Run from the repository root:

```sh
npm --prefix app ci
npm --prefix app run typecheck
npm --prefix app test
npm --prefix app run build
```

The build writes `app/dist/`. Anonymous fixtures are in `src/ui/data/mock.ts`; account loaders never receive those fixtures. Database migrations are historical schema records, not evidence that the target backend is implemented. Existing cloud data and local user data are preserved; source cleanup does not alter either.
