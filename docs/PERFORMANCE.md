# Manor performance

_Last updated: 2026-09-13_

This page records the performance criteria, the measurement method, the baseline, and the effect of each optimization. The design rules the optimizations implement are in the [architecture](ARCHITECTURE.md); this page holds the numbers.

## Criteria

Every run measures the signed-in app on the hosted staging site with the same populated showroom account (24 tasks, 5 habits with 28 days of history, 4 notes, 6 applications, 15 LeetCode attempts, 4 captures, one connected calendar with two events). Per page, from a fresh browser context:

| Criterion | Definition |
|---|---|
| Cold: last response | Milliseconds from navigation start to the last network response on a first visit (no cache, no service worker). |
| Cold: settled | Last response plus the harness's fixed 500 ms network-idle window. Deltas between runs are exact; the absolute value is 500 ms high. |
| Cold: LCP | Largest Contentful Paint reported by the browser. |
| Warm: last response, settled | The same, on a visit where the service worker controls the page. This is every visit after the first. |
| Requests, transfer, JS | Count and compressed bytes fetched on a cold visit, split out for JavaScript. |
| API calls | Requests to Supabase (REST, RPC, Edge Functions) during the load. |
| Heap | `JSHeapUsedSize` after the page settles. |
| Main-thread task time | Total task time reported by the browser through the load. |
| Navigation loop | Heap after three laps through every page with garbage collection forced, to expose retention. |
| Idle | Requests issued while sitting on Home for 65 seconds. |
| Throttled warm | Warm `settled` under 4x CPU slowdown, 1.6 Mbps down, 150 ms added latency. |

Cold numbers depend on the network at the moment of the run, so the harness records TTFB to show whether two runs are comparable (the baseline and round 1 ran at about 25 ms TTFB). Warm and throttled numbers are far more stable because assets come from the service worker and only API latency varies.

## Method

`tools/perf/bench.mjs` drives Chrome through Playwright's CDP session with a signed-in session file, `tools/perf/waterfall.mjs` prints the per-request timeline for one page (optionally throttled), and `tools/perf/report.mjs` renders comparison tables from the recorded runs in `docs/perf/*.json`. To reproduce a run:

```sh
npm --prefix tools/perf ci
node tools/perf/bench.mjs <session.json> https://mymanor-staging.vercel.app <label> 5
node tools/perf/waterfall.mjs <session.json> https://mymanor-staging.vercel.app /home throttle
node tools/perf/report.mjs baseline round1 round3
```

The session file holds a Supabase session for a synthetic staging account created the way the SQL tests create theirs: an `auth.users` row plus an admin-generated magic link verified with `token_hash`. The file is never committed, and the account is removed after a measurement campaign. Backend statistics come from `pg_stat_statements`, `pg_policies`, and `explain (analyze)` through the Management API.

## Baseline findings (2026-09-13)

- The service worker precached 147 files (about 8.5 MB, including 59 KaTeX fonts and 47 syntax grammars) on every first visit, and hashed assets were served with `Cache-Control: max-age=0, must-revalidate` because `vercel.json`'s catch-all header rule replaced Vercel's default immutable caching. Every warm load revalidated every chunk (25 to 80 ms each).
- Home's warm load was a serial chain: `index.js` → `profiles` → `App` chunk → page chunk plus 25 one-icon chunks → mount → four table reads → `functions/v1/integrations` (calendar accounts, 459 ms) → a second `integrations` call for events. Last response at about 1,080 ms.
- Bookmarks paid a 524 ms `integrations` round trip for X connection state.
- 35 row-level-security policies compared `user_id = auth.uid()` directly, so Postgres evaluated `auth.uid()` per row; `file_objects` and `note_attachments` had no index on `user_id`. Cache hit rates were 99.99 percent (index) and 100 percent (table).
- No memory growth: heap after three navigation laps stayed at 5.2 MB. No long tasks on any page.

## Optimizations

The following diagram contrasts the warm Home load before and after the boot changes; the tables later on this page hold the measurements.

![What a page load waits for: before, a single chain from index.js through the profile, the App chunk, the page chunk and 25 icon chunks, mount, four table reads, and two integrations-function calls; after, index.js starts the profile, the App chunk, and the grouped route chunk together, the route reads and today's events begin as soon as the profile returns, and the page mounts with data already in flight.](diagrams/boot.svg)

1. **Immutable assets and a smaller precache.** `vercel.json` serves `/assets/*` with `public, max-age=31536000, immutable`. The Workbox precache covers the shell and page chunks only (61 entries, 3.9 MB); syntax grammars (`assets/lang/`) and KaTeX fonts (`assets/katex/`) are routed to their own folders, excluded from the precache, and cached on first use by a `CacheFirst` runtime rule.
2. **Fewer chunks.** `lucide-react` icons ship as one `icons` chunk and the shared controls as one `ui` chunk instead of one request per icon. Cold Home dropped from 44 requests and 149 KB of JS to 29 requests and 72 KB.
3. **Parallel boot.** `ManorApplication` starts the `App` chunk, the current route's chunk, and the route's first reads together with the account load instead of after it; `routes.ts` and `prefetch.ts` own the maps. Opening Notes also fetches the editor chunk alongside the page.
4. **Direct calendar and X reads.** `CalendarService` reads `calendar_accounts`, `calendars`, and `calendar_events` from the owner-scoped tables and projects days client-side with `calendarDays` (moved from the Edge Function to `app/src/shared`); `manor_x_status` is a `security definer` RPC that returns connection state without tokens. The `integrations` function keeps only OAuth, visibility, disconnect, and manual sync. The Today panel makes one read per refresh instead of two chained function calls, and the day's events are shared through the query cache so the prefetch and the panel do not fetch twice.
5. **Policy InitPlans and indexes.** Migration `20260913220000_policy_initplans` rewrites the 35 policies as `user_id = (select auth.uid())`, which the planner evaluates once per statement, and adds the two missing `user_id` indexes. On 138 habit entries the filtered read went from 0.45 ms to 0.27 ms; the gap grows with row count.
6. **Cached account and an early splash.** A device that has opened the account before renders the app from the cached account at once and reconciles the name and time zone when the profile returns, so the profile round trip leaves the critical path. `index.html` carries the splash markup, the mark, and the saved theme, so the first paint no longer waits for the JavaScript bundle.

## Results

**Cold: last response (ms)**

| Page | Baseline | Round 1 | Round 3 |
|---|---:|---:|---:|
| home | n/a | n/a | 1528 |
| habits | n/a | n/a | 1109 |
| notes | n/a | n/a | 1246 |
| jobs | n/a | n/a | 1182 |
| leetcode | n/a | n/a | 863 |
| mood | n/a | n/a | 738 |
| bookmarks | n/a | n/a | 865 |

**Cold: settled (ms)**

| Page | Baseline | Round 1 | Round 3 |
|---|---:|---:|---:|
| home | 2037 | 1005 | 2030 |
| habits | 1216 | 1155 | 1611 |
| notes | 1611 | 1463 | 1748 |
| jobs | 1267 | 1162 | 1684 |
| leetcode | 1242 | 1127 | 1364 |
| mood | 1178 | 1024 | 1238 |
| bookmarks | 2066 | 1853 | 1365 |

**Cold: LCP (ms)**

| Page | Baseline | Round 1 | Round 3 |
|---|---:|---:|---:|
| home | 736 | 528 | 1448 |
| habits | 560 | 536 | 984 |
| notes | 1044 | 900 | 1212 |
| jobs | 736 | 568 | 1100 |
| leetcode | 760 | 648 | 880 |
| mood | 548 | 540 | 768 |
| bookmarks | 808 | 560 | 764 |

**Warm: last response (ms)**

| Page | Baseline | Round 1 | Round 3 |
|---|---:|---:|---:|
| home | n/a | n/a | 479 |
| habits | n/a | n/a | 644 |
| notes | n/a | n/a | 773 |
| jobs | n/a | n/a | 472 |
| leetcode | n/a | n/a | 561 |
| mood | n/a | n/a | 449 |
| bookmarks | n/a | n/a | 528 |

**Warm: settled (ms)**

| Page | Baseline | Round 1 | Round 3 |
|---|---:|---:|---:|
| home | 1827 | 964 | 982 |
| habits | 1094 | 1052 | 1145 |
| notes | 1462 | 1296 | 1275 |
| jobs | 1130 | 963 | 972 |
| leetcode | 1077 | 1044 | 1062 |
| mood | 1072 | 948 | 949 |
| bookmarks | 1784 | 1452 | 1028 |

**Cold: requests**

| Page | Baseline | Round 1 | Round 3 |
|---|---:|---:|---:|
| home | 44 | 29 | 33 |
| habits | 33 | 26 | 28 |
| notes | 41 | 32 | 33 |
| jobs | 40 | 30 | 28 |
| leetcode | 33 | 29 | 29 |
| mood | 24 | 25 | 24 |
| bookmarks | 25 | 23 | 24 |

**Cold: transfer (KB)**

| Page | Baseline | Round 1 | Round 3 |
|---|---:|---:|---:|
| home | 233.4 | 124.7 | 158.6 |
| habits | 129.6 | 44.4 | 113.1 |
| notes | 648 | 560.2 | 560.9 |
| jobs | 283.6 | 211.5 | 180.6 |
| leetcode | 164.5 | 79.8 | 80.4 |
| mood | 149.7 | 70.5 | 35 |
| bookmarks | 151.2 | 32.5 | 70.1 |

**Cold: JS (KB)**

| Page | Baseline | Round 1 | Round 3 |
|---|---:|---:|---:|
| home | 148.9 | 71.8 | 70.8 |
| habits | 86.7 | 31.3 | 30.3 |
| notes | 527.6 | 460.5 | 459.6 |
| jobs | 203.8 | 131.6 | 130.7 |
| leetcode | 83 | 29 | 27.8 |
| mood | 75.1 | 27.6 | 26.3 |
| bookmarks | 75.6 | 25.4 | 24.4 |

**Cold: API calls**

| Page | Baseline | Round 1 | Round 3 |
|---|---:|---:|---:|
| home | 6 | 6 | 8 |
| habits | 4 | 5 | 6 |
| notes | 3 | 3 | 4 |
| jobs | 3 | 3 | 4 |
| leetcode | 5 | 6 | 7 |
| mood | 2 | 2 | 3 |
| bookmarks | 3 | 3 | 4 |

**Heap after load (MB)**

| Page | Baseline | Round 1 | Round 3 |
|---|---:|---:|---:|
| home | 8.9 | 9.6 | 10 |
| habits | 8.5 | 9.3 | 9.6 |
| notes | 12.5 | 12.8 | 15 |
| jobs | 10.2 | 10.7 | 9.2 |
| leetcode | 8.6 | 9.5 | 9.7 |
| mood | 7.1 | 7.8 | 7.9 |
| bookmarks | 7.3 | 7.8 | 8 |

**Main-thread task time (ms)**

| Page | Baseline | Round 1 | Round 3 |
|---|---:|---:|---:|
| home | 115 | 88 | 198 |
| habits | 96 | 89 | 125 |
| notes | 183 | 166 | 127 |
| jobs | 120 | 103 | 107 |
| leetcode | 85 | 84 | 95 |
| mood | 73 | 71 | 80 |
| bookmarks | 87 | 67 | 62 |

**Navigation loop (heap MB after 3 laps, GC forced)**

| Run | First Home | Lap 1 | Lap 2 | Lap 3 |
|---|---:|---:|---:|---:|
| baseline | 4.7 | 5.2 | 5.2 | 5.2 |
| round1 | 4.8 | 5.3 | 5.3 | 5.3 |
| round3 | 4.9 | 5.4 | 5.4 | 5.4 |

**Idle (requests in 65 s on Home)**

| Run | Requests | Endpoints |
|---|---:|---|
| baseline | 1 | functions/v1/integrations |
| round1 | 2 | rest/v1/profiles, rest/v1/calendars |
| round3 | 3 | rest/v1/calendars, rest/v1/profiles, rest/v1/calendar_events |

**Throttled warm (4x CPU, 1.6 Mbps, 150 ms), settled ms**

| Page | Baseline | Round 1 | Round 3 |
|---|---:|---:|---:|
| home | 2491 | 1066 | 1223 |
| habits | 1811 | 1353 | 1368 |
| notes | n/a | 1680 | 1472 |
| bookmarks | n/a | n/a | 1367 |

Round 3 adds a connected calendar to the showroom account, so its Home loads include a `calendar_events` read the baseline never made. Its cold run coincided with degraded network (median TTFB 113 ms on Home against 24 to 29 ms in the baseline and round 1), which inflates every cold figure in that column; the warm and throttled columns are the comparable ones for round 3.

## Not changed, and why

- `select *` on `note_pages` loads every note's content for the list. At the current note counts it is a few kilobytes; it becomes the dominant read past a few hundred notes and should move to a list projection with content loaded on open.
- The `pg_timezone_names` scan in `save_profile` and review validation costs about 66 ms per call but runs only on profile and review saves.
- The Notes editor chunk (406 KB gzipped) is BlockNote plus its extensions and is loaded only on Notes.

### Cached account and early splash

Warm loads on staging with the same synthetic account, three runs each, before and after the cached-account boot and the `index.html` splash (`docs/perf/boot-before.json` and `boot-after.json`). First paint now comes from the shell itself, and the profile round trip no longer sits between the session check and the first render.

| Page | FCP before | FCP after | LCP before | LCP after | Last response before | Last response after | Settled before | Settled after |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| home | 64 | 36 | 488 | 372 | 477 | 372 | 977 | 872 |
| habits | 64 | 28 | 584 | 464 | 577 | 460 | 1079 | 960 |
| notes | 36 | 12 | 488 | 368 | 473 | 366 | 974 | 869 |
| jobs | 40 | 24 | 484 | 348 | 471 | 345 | 972 | 845 |
| leetcode | 36 | 16 | 572 | 464 | 566 | 449 | 1067 | 951 |
| mood | 36 | 16 | 436 | 356 | 434 | 354 | 935 | 854 |
| bookmarks | 36 | 16 | 472 | 356 | 578 | 451 | 1079 | 952 |

Cold loads moved within network variance in both directions and are not shown; a first visit still pays the profile read because there is nothing to cache yet.
