# Manor

_Last updated: 2026-08-23_

The Electron app for Manor. Design charter: `docs/DESIGN.md` at the repo
root. Product truth: `../docs/PRD.md`.

## Run

```sh
npm install
npm run dev        # boots the Electron app (1520x940, hiddenInset titlebar)
```

While `npm run dev` is running, the renderer is also served at
`http://localhost:5173/` for visual browser preview. Functional Home testing
must use Electron because task persistence is exposed through the preload
bridge.

```sh
npm run typecheck  # tsc over main/preload and renderer
npm test           # task/domain and persistence tests
npm run build      # electron-vite production build into out/
```

## Data state

`src/renderer/src/data/mock.ts` remains the single typed seed story. Home is
the first functional vertical slice: tasks, contexts, scratch blocks, and
saved Master views are persisted in SQLite from the Electron main process after first launch. The
remaining modules still use the canonical mock story.

## Layout

- `src/main/` window bootstrap and main-process stores; `src/preload/` the
  typed renderer bridge.
- `src/renderer/src/styles/` design tokens (Paper Violet) + base styles.
- `src/renderer/src/components/ui/` shared primitives (Button, Pill, Card,
  Checkbox, Select, Modal, DetailDialog, Tooltip, EmptyState, Input, Kbd).
- `src/renderer/src/app/` the frame: sidebar, titlebar strip, Alfred modal
  (Option+Space, thinking orb in `components/orb/`).
- `src/renderer/src/pages/` one file per route; placeholders until page
  agents land. Routes are registered in `src/renderer/src/App.tsx`.
