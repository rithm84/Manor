# Manor (hi-fi UI shell)

The Electron shell for Manor: UI only, mock data, no backend, no network
calls at runtime. Design charter: `DESIGN.md` in this directory. Product
truth: `../docs/BRAINSTORM.md`.

## Run

```sh
npm install
npm run dev        # boots the Electron app (1520x940, hiddenInset titlebar)
```

While `npm run dev` is running, the renderer is also served at
`http://localhost:5173/` for browser preview (everything works there except
real window chrome and the draggable titlebar).

```sh
npm run typecheck  # tsc over main/preload and renderer
npm run build      # electron-vite production build into out/
```

## What is mock

Everything. `src/renderer/src/data/mock.ts` is the single typed source for
the canonical story (Wednesday, August 20, 2026): habits and streaks, tasks
and buckets, calendar events and scratch blocks, fitness, mood/focus,
LeetCode, jobs, bookmarks, notes, journal meta, and Alfred's briefing/audit.
Page agents import from it; nobody invents parallel data. There is no
persistence: interactions mutate local component state only.

## Layout

- `src/main/` window bootstrap (no IPC yet), `src/preload/` empty bridge.
- `src/renderer/src/styles/` design tokens (Atelier v2) + base styles.
- `src/renderer/src/components/ui/` shared primitives (Button, Pill, Card,
  Checkbox, Select, Modal, SidePeek, Tooltip, EmptyState, Input, Kbd).
- `src/renderer/src/app/` the frame: sidebar, titlebar strip, Alfred modal
  (Option+Space, thinking orb in `components/orb/`).
- `src/renderer/src/pages/` one file per route; placeholders until page
  agents land. Routes are registered in `src/renderer/src/App.tsx`.
