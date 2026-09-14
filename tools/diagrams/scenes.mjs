// Scene specs for docs/diagrams. Coordinates are canvas pixels. Nodes default to 180 wide and 140 tall with a 60px icon; arrow labels land at the route's middle point; `shape: 'diamond'` makes a decision.
const fill = { supabase: '#a5d8ff', app: '#d0bfff', storage: '#b2f2bb', external: '#ffc9c9', jobs: '#ffec99', neutral: '#e9ecef', white: '#ffffff' }
const S = { supabase: '#1971c2', app: '#7048e8', storage: '#2f9e44', external: '#e03131', jobs: '#f08c00', neutral: '#868e96', ink: '#1e1e1e' }
const I = {
  browser: { library: 'software-architecture', item: 5 }, microservice: { library: 'software-architecture', item: 0 },
  database: { library: 'software-architecture', item: 1 }, bus: { library: 'software-architecture', item: 3 },
  cdn: { library: 'system-design', item: 20 }, lock: { library: 'system-design', item: 14 }, objectStorage: { library: 'system-design', item: 7 },
  cloud: { library: 'system-design', item: 19 }, archive: { library: 'system-design', item: 21 }, webApp: { library: 'system-design', item: 23 },
  user: { library: 'architecture-diagram-components', item: 'User' }, client: { library: 'network-topology-icons', item: 'Client' },
  firewall: { library: 'network-topology-icons', item: 'Firewall' },
  postgres: { library: 'drwnio', item: 12 }, github: { library: 'drwnio', item: 13 }, code: { library: 'drwnio', item: 11 }, json: { library: 'drwnio', item: 3 },
  chip: { library: 'drwnio', item: 8 }, bucket: { library: 'drwnio', item: 0 },
  lightning: { library: 'system-icons', item: 'lightning' }, star: { library: 'system-icons', item: 'star' }, warn: { library: 'system-icons', item: 'warn' },
  document: { library: 'system-icons', item: 'document' }, gear: { library: 'system-icons', item: 'set up' }, broom: { library: 'system-icons', item: 'clean up' },
  notes: { library: 'icons', item: 'notes' }, documents: { library: 'icons', item: 'documents' }, paper: { library: 'icons', item: 'paper' },
  clipboard: { library: 'icons', item: 'clipboard' }, password: { library: 'icons', item: 'password' }, shredder: { library: 'icons', item: 'shredder' },
  del: { library: 'icons', item: 'delete' }, upload: { library: 'icons', item: 'upload' }, attachment: { library: 'icons', item: 'attachment' },
  search: { library: 'icons', item: 'search' }, zip: { library: 'icons', item: 'zip' }
}
const N = (id, label, x, y, extra = {}) => ({ id, label, x, y, ...extra })
const E = (from, to, extra = {}) => ({ from, to, ...extra })

export const scenes = {
  runtime: {
    title: 'Runtime and deployment',
    subtitle: 'One Vercel-hosted web app, one Supabase project per environment, and agents that reach the same commands over remote MCP.',
    zones: [
      { id: 'z-client', label: 'Browser', x: 0, y: 90, w: 440, h: 210, stroke: S.app, fill: '#f3f0ff' },
      { id: 'z-agent', label: 'Agent hosts', x: 0, y: 640, w: 440, h: 220, stroke: S.neutral },
      { id: 'z-supabase', label: 'Supabase project (staging or production)', x: 540, y: 90, w: 560, h: 770, stroke: S.supabase, fill: '#e7f5ff' },
      { id: 'z-external', label: 'External services', x: 1200, y: 90, w: 230, h: 940, stroke: S.external, fill: '#fff5f5' }
    ],
    nodes: [
      N('vercel', 'Vercel', 30, 130, { note: 'immutable assets, service worker shell', icon: I.cdn, fill: fill.neutral, stroke: S.neutral }),
      N('web', 'Manor web app', 240, 130, { note: 'React, TanStack Query, IndexedDB drafts', icon: I.browser, fill: fill.app, stroke: S.app }),
      N('chatgpt', 'ChatGPT or Codex', 30, 680, { note: 'remote MCP client', icon: I.client, fill: fill.neutral, stroke: S.neutral }),
      N('scheduled', 'Scheduled review task', 240, 680, { note: 'ChatGPT Work, Sunday 22:00', icon: I.lightning, fill: fill.neutral, stroke: S.neutral }),
      N('auth', 'Auth', 570, 130, { note: 'Google sign-in, hooks, OAuth server', icon: I.lock, fill: fill.supabase, stroke: S.supabase }),
      N('db', 'Postgres', 570, 300, { note: 'RLS, commands, history, cron', icon: I.postgres, fill: fill.supabase, stroke: S.supabase }),
      N('files', 'Storage', 570, 470, { note: 'private manor-files bucket', icon: I.objectStorage, fill: fill.storage, stroke: S.storage }),
      N('workers', 'Workers', 900, 300, { note: 'integrations, jobs, embeddings', icon: I.microservice, fill: fill.supabase, stroke: S.supabase }),
      N('mcp', 'manor-mcp', 900, 680, { note: 'Edge Function, 113 operations', icon: I.code, fill: fill.supabase, stroke: S.supabase }),
      N('google', 'Google', 1230, 130, { note: 'identity, Calendar (read-only)', icon: I.cloud, fill: fill.external, stroke: S.external }),
      N('x', 'X bookmarks', 1230, 300, { icon: I.star, fill: fill.external, stroke: S.external }),
      N('simplify', 'SimplifyJobs', 1230, 470, { note: 'listings.json on GitHub', icon: I.github, fill: fill.external, stroke: S.external }),
      N('openai', 'OpenAI embeddings', 1230, 660, { note: 'text-embedding-3-small', icon: I.chip, fill: fill.external, stroke: S.external }),
      N('canvas', 'Canvas feed', 1230, 850, { note: 'saved link, read on demand', icon: I.cloud, fill: fill.external, stroke: S.external })
    ],
    edges: [
      E('vercel', 'web', { color: S.neutral }),
      E('web', 'auth', { label: 'sign in', color: S.supabase }),
      E('web', 'db', { label: 'REST, RPC, Realtime', color: S.supabase, both: true }),
      E('web', 'files', { label: 'signed uploads', color: S.storage, via: [[330, 540], [450, 540]] }),
      E('chatgpt', 'mcp', { label: 'OAuth 2.1', color: S.neutral, via: [[110, 880], [990, 880]] }),
      E('scheduled', 'mcp', { color: S.neutral, style: 'dashed' }),
      E('mcp', 'db', { color: S.supabase, via: [[990, 520]] }),
      E('db', 'workers', { label: 'cron ticks, queues', color: S.jobs, both: true }),
      E('auth', 'google', { label: 'OAuth', color: S.external, style: 'dashed' }),
      E('workers', 'google', { color: S.external, via: [[1180, 340], [1180, 240]] }),
      E('workers', 'x', { color: S.external }),
      E('workers', 'simplify', { color: S.external, via: [[1150, 400], [1150, 540]] }),
      E('workers', 'openai', { color: S.external, via: [[1120, 420], [1120, 730]] }),
      E('mcp', 'canvas', { label: 'deadlines', color: S.external, via: [[1150, 750], [1150, 920]] })
    ]
  },
  commands: {
    title: 'The command boundary',
    subtitle: 'Every write from the UI or an agent is one named, idempotent, revision-checked transaction.',
    nodes: [
      N('caller', 'UI or MCP caller', 0, 120, { note: 'command id, operation, input, expected revision', icon: I.user, fill: fill.app, stroke: S.app }),
      N('validate', 'Validate and authorize', 260, 120, { note: 'schema, ownership, actor (user, codex, background)', icon: I.lock, fill: fill.supabase, stroke: S.supabase }),
      N('revision', 'Revision matches?', 520, 130, { shape: 'diamond', w: 190, h: 120, fill: fill.jobs, stroke: S.jobs }),
      N('apply', 'Apply in one transaction', 800, 120, { note: 'rows, field-level action_events, receipt', icon: I.postgres, fill: fill.supabase, stroke: S.supabase }),
      N('committed', 'Committed', 1070, 120, { note: 'record and new revision', icon: I.document, fill: fill.storage, stroke: S.storage }),
      N('conflict', 'Conflict', 520, 360, { note: 'current state returned; caller resolves', icon: I.warn, fill: fill.external, stroke: S.external }),
      N('receipt', 'Receipt replay', 800, 360, { note: 'same command id returns the original outcome', icon: I.clipboard, fill: fill.neutral, stroke: S.neutral })
    ],
    edges: [
      E('caller', 'validate', { color: S.app }), E('validate', 'revision', { color: S.supabase }), E('revision', 'apply', { label: 'yes', color: S.storage }),
      E('apply', 'committed', { color: S.storage }), E('revision', 'conflict', { label: 'no', color: S.external }),
      E('caller', 'receipt', { label: 'retry after an uncertain response', color: S.neutral, style: 'dashed', via: [[85, 560], [890, 560]] }),
      E('receipt', 'committed', { color: S.neutral, style: 'dashed', via: [[1155, 430]] })
    ]
  },
  auth: {
    title: 'Sign-in and agent authorization',
    subtitle: 'People sign in with Google behind a signup gate; agents get a scoped OAuth token. Both end at the same row-level policies.',
    zones: [
      { id: 'z-person', label: 'Person', x: 0, y: 90, w: 940, h: 210, stroke: S.app, fill: '#f3f0ff' },
      { id: 'z-agent', label: 'Agent client', x: 0, y: 340, w: 940, h: 210, stroke: S.neutral }
    ],
    nodes: [
      N('google', 'Google sign-in', 30, 130, { note: 'verified email identity', icon: I.cloud, fill: fill.external, stroke: S.external }),
      N('gate', 'Signup gate', 260, 130, { note: 'shared password, single-use grant bound to the email', icon: I.firewall, fill: fill.jobs, stroke: S.jobs }),
      N('hook', 'before-user-created hook', 490, 130, { note: 'rejects creation without a grant', icon: I.lock, fill: fill.supabase, stroke: S.supabase }),
      N('session', 'Browser session', 720, 130, { note: 'custom access token claims', icon: I.browser, fill: fill.app, stroke: S.app }),
      N('client', 'ChatGPT or Codex', 30, 380, { icon: I.client, fill: fill.neutral, stroke: S.neutral }),
      N('discovery', 'OAuth 2.1 discovery', 260, 380, { note: 'protected-resource metadata, PKCE', icon: I.json, fill: fill.supabase, stroke: S.supabase }),
      N('consent', 'Manor consent screen', 490, 380, { note: 'read or read-write scope, revocable', icon: I.webApp, fill: fill.supabase, stroke: S.supabase }),
      N('token', 'Scoped token', 720, 380, { note: 'client_id claim, refresh, revocation', icon: I.password, fill: fill.app, stroke: S.app }),
      N('rls', 'Row-level security', 1040, 255, { note: 'user_id = (select auth.uid()) and MCP scope policies', icon: I.postgres, fill: fill.supabase, stroke: S.supabase }),
      N('ops', '113 operations', 1290, 255, { note: '47 reads, 66 writes, one catalog', icon: I.code, fill: fill.storage, stroke: S.storage })
    ],
    edges: [
      E('google', 'gate', { color: S.external }), E('gate', 'hook', { color: S.jobs }), E('hook', 'session', { color: S.supabase }),
      E('client', 'discovery', { color: S.neutral }), E('discovery', 'consent', { color: S.supabase }), E('consent', 'token', { color: S.supabase }),
      E('session', 'rls', { color: S.app }), E('token', 'rls', { color: S.app }), E('rls', 'ops', { color: S.supabase })
    ]
  },
  'notes-drafts': {
    title: 'Notes drafts and saves',
    subtitle: 'Typing is protected on the device before any network call; saves replay one at a time and re-base on the committed revision.',
    nodes: [
      N('editor', 'Editor', 0, 120, { note: 'BlockNote document with stable block ids', icon: I.notes, fill: fill.app, stroke: S.app }),
      N('draft', 'IndexedDB draft', 250, 120, { note: 'title, content, base revision, mutation id', icon: I.database, fill: fill.jobs, stroke: S.jobs }),
      N('queue', 'Per-note save queue', 500, 120, { note: 'one save in flight per note', icon: I.bus, fill: fill.neutral, stroke: S.neutral }),
      N('save', 'update_note', 750, 120, { note: 'expected revision equals the base', icon: I.postgres, fill: fill.supabase, stroke: S.supabase }),
      N('ok', 'Committed?', 1000, 130, { shape: 'diamond', w: 190, h: 120, fill: fill.storage, stroke: S.storage }),
      N('rebase', 'Re-base or clear', 1250, 120, { note: 'same mutation id: clear the draft; newer typing: adopt the new revision', icon: I.broom, fill: fill.storage, stroke: S.storage }),
      N('changed', 'Same block changed on both sides?', 980, 340, { shape: 'diamond', w: 230, h: 130, fill: fill.jobs, stroke: S.jobs }),
      N('conflict', 'Compare versions', 750, 360, { note: 'another device changed the note; you choose, then save again', icon: I.documents, fill: fill.external, stroke: S.external }),
      N('attach', 'Attachment bytes', 0, 360, { note: 'kept as blobs until the upload is finalized', icon: I.attachment, fill: fill.jobs, stroke: S.jobs }),
      N('storage', 'Resumable upload', 250, 360, { note: 'TUS, 6 MiB chunks, server-side checksum', icon: I.upload, fill: fill.storage, stroke: S.storage })
    ],
    edges: [
      E('editor', 'draft', { label: 'edits', color: S.app }), E('draft', 'queue', { color: S.jobs }), E('queue', 'save', { color: S.neutral }), E('save', 'ok', { color: S.supabase }),
      E('ok', 'rebase', { label: 'yes', color: S.storage }),
      E('ok', 'changed', { label: 'revision moved', color: S.jobs }),
      E('changed', 'rebase', { label: 'no: merge by block', color: S.storage, via: [[1340, 405]] }),
      E('changed', 'conflict', { label: 'yes', color: S.external }),
      E('rebase', 'draft', { label: 'next save uses the committed revision', color: S.storage, style: 'dashed', via: [[1340, 80], [800, 80], [340, 80]] }),
      E('conflict', 'queue', { color: S.external, style: 'dashed', via: [[835, 330], [590, 330]] }),
      E('editor', 'attach', { color: S.app }), E('attach', 'storage', { color: S.jobs }),
      E('storage', 'draft', { label: 'finalized file id', color: S.storage, style: 'dashed' })
    ]
  },
  purge: {
    title: 'Trash, purge, and scrubbed history',
    subtitle: 'Seven days of recovery, then a purge that waits for an independent backup of its own ledger; an explicit permanent delete skips the wait.',
    nodes: [
      N('record', 'Task, application, or note', 0, 120, { icon: I.documents, fill: fill.app, stroke: S.app }),
      N('trash', 'Trash', 250, 120, { note: 'deleted_at set, subpages included', icon: I.del, fill: fill.jobs, stroke: S.jobs }),
      N('restore', 'Restore', 250, 360, { note: 'parent and child relationships kept', icon: I.archive, fill: fill.storage, stroke: S.storage }),
      N('ledger', 'Purge ledger', 530, 120, { note: 'content-free tombstones', icon: I.clipboard, fill: fill.neutral, stroke: S.neutral }),
      N('ack', 'Backup acknowledged?', 790, 130, { shape: 'diamond', w: 200, h: 120, fill: fill.jobs, stroke: S.jobs }),
      N('purge', 'Purge', 1080, 120, { w: 220, note: 'rows, versions, unreferenced files, search chunks, receipt payloads', icon: I.shredder, fill: fill.external, stroke: S.external }),
      N('history', 'Action history', 1080, 360, { note: 'structure kept, titles and text scrubbed', icon: I.paper, fill: fill.neutral, stroke: S.neutral })
    ],
    edges: [
      E('record', 'trash', { label: 'delete', color: S.app }), E('trash', 'restore', { label: 'within 7 days', color: S.storage }), E('restore', 'record', { color: S.storage, via: [[85, 430]] }),
      E('trash', 'ledger', { label: 'after 7 days', color: S.jobs }), E('ledger', 'ack', { color: S.neutral }), E('ack', 'purge', { label: 'yes', color: S.external }),
      E('ack', 'ledger', { label: 'no: wait', color: S.neutral, style: 'dashed', via: [[890, 95], [620, 95]] }), E('purge', 'history', { color: S.neutral }),
      E('trash', 'purge', { label: 'Delete permanently: tombstone and purge now', color: S.external, via: [[400, 310], [1100, 310]] })
    ]
  },
  background: {
    title: 'Background work',
    subtitle: 'Postgres cron drives short worker steps; nothing here needs an open Manor tab.',
    nodes: [
      N('cron', 'Cron', 0, 370, { note: 'pg_cron schedules with Vault-held worker URLs', icon: I.gear, fill: fill.jobs, stroke: S.jobs }),
      N('integrations', 'Integration worker', 300, 100, { note: 'every minute, up to 16 accounts per tick', icon: I.microservice, fill: fill.supabase, stroke: S.supabase }),
      N('embeddings', 'Embedding worker', 300, 280, { note: 'every minute, changed notes and captures', icon: I.microservice, fill: fill.supabase, stroke: S.supabase }),
      N('jobs', 'Jobs ingest', 300, 460, { note: 'every 6 hours', icon: I.microservice, fill: fill.supabase, stroke: S.supabase }),
      N('maintenance', 'Maintenance', 300, 640, { note: 'hourly: recurrence, streaks, purge', icon: I.postgres, fill: fill.supabase, stroke: S.supabase }),
      N('calendar', 'Google Calendar', 620, 40, { note: 'one page per calendar, resync at the next minute', icon: I.cloud, fill: fill.external, stroke: S.external }),
      N('xb', 'X bookmarks', 620, 210, { note: 'every 10 minutes', icon: I.star, fill: fill.external, stroke: S.external }),
      N('openai', 'OpenAI', 620, 380, { note: 'text-embedding-3-small, 1,536 dims', icon: I.chip, fill: fill.external, stroke: S.external }),
      N('simplify', 'SimplifyJobs', 620, 550, { note: 'listings.json, standing filters', icon: I.github, fill: fill.external, stroke: S.external }),
      N('review', 'Weekly review', 620, 720, { note: 'ChatGPT Work task saves through MCP, Sunday 22:00', icon: I.lightning, fill: fill.neutral, stroke: S.neutral })
    ],
    edges: [
      E('cron', 'integrations', { color: S.jobs }), E('cron', 'embeddings', { color: S.jobs }), E('cron', 'jobs', { color: S.jobs }), E('cron', 'maintenance', { color: S.jobs }),
      E('integrations', 'calendar', { label: 'read-only', color: S.external }), E('integrations', 'xb', { color: S.external }), E('embeddings', 'openai', { color: S.external }), E('jobs', 'simplify', { color: S.external })
    ],
    notes: [{ text: 'The weekly review is scheduled by the ChatGPT host, not by cron; it reads inputs and writes the review through the same MCP operations.', x: 0, y: 900, size: 13 }]
  },
  recovery: {
    title: 'Backups and isolated restore',
    subtitle: 'Daily database and file recovery points with seven-day retention; restores land in a separate project with workers off.',
    zones: [
      { id: 'z-source', label: 'Production', x: 0, y: 90, w: 470, h: 460, stroke: S.supabase, fill: '#e7f5ff' },
      { id: 'z-offsite', label: 'Independent backup store', x: 560, y: 90, w: 300, h: 460, stroke: S.storage, fill: '#ebfbee' },
      { id: 'z-restore', label: 'Recovery project', x: 950, y: 90, w: 470, h: 460, stroke: S.neutral }
    ],
    nodes: [
      N('pg', 'Postgres', 30, 130, { note: 'Supabase daily backup, 7-day retention', icon: I.postgres, fill: fill.supabase, stroke: S.supabase }),
      N('objects', 'Storage objects', 30, 370, { note: 'repeatable-read manifest with checksums', icon: I.objectStorage, fill: fill.storage, stroke: S.storage }),
      N('ledger', 'Purge ledger', 270, 130, { note: 'manor-ledger snapshot', icon: I.clipboard, fill: fill.neutral, stroke: S.neutral }),
      N('restic', 'restic + rclone', 270, 370, { note: 'encrypted snapshots, manor-daily tag', icon: I.zip, fill: fill.storage, stroke: S.storage }),
      N('bucket', 'S3-compatible bucket', 620, 250, { note: 'ledger retained independently of daily pruning', icon: I.bucket, fill: fill.storage, stroke: S.storage }),
      N('rpg', 'Restored database', 980, 130, { note: 'managed backup, then tombstones newer than it', icon: I.postgres, fill: fill.neutral, stroke: S.neutral }),
      N('rfiles', 'Matched files', 980, 370, { note: 'copied only when the checksum matches a surviving reference', icon: I.objectStorage, fill: fill.neutral, stroke: S.neutral }),
      N('verify', 'Verify', 1220, 250, { note: 'counts, ownership, relationships; no workers, no users', icon: I.search, fill: fill.neutral, stroke: S.neutral })
    ],
    edges: [
      E('pg', 'ledger', { color: S.supabase }), E('ledger', 'restic', { label: 'acknowledge before purge', color: S.neutral }), E('objects', 'restic', { color: S.storage }),
      E('restic', 'bucket', { color: S.storage }), E('bucket', 'rpg', { label: 'ledger', color: S.neutral }), E('bucket', 'rfiles', { label: 'daily snapshot', color: S.neutral }),
      E('pg', 'rpg', { label: 'managed backup', color: S.supabase, style: 'dashed', via: [[120, 72], [1160, 72]] }), E('rpg', 'verify', { color: S.neutral }), E('rfiles', 'verify', { color: S.neutral })
    ]
  },
  boot: {
    title: 'What a page load waits for',
    subtitle: 'Warm load of Home. Boxes are the requests on the critical path; the second lane is the shipped design.',
    zones: [
      { id: 'z-before', label: 'Before: one chain', x: 0, y: 90, w: 1400, h: 150, stroke: S.external, fill: '#fff5f5' },
      { id: 'z-after', label: 'After: independent work starts together', x: 0, y: 290, w: 1400, h: 300, stroke: S.storage, fill: '#ebfbee' }
    ],
    nodes: [
      N('b1', 'index.js', 30, 140, { w: 150, h: 60, fill: fill.white }), N('b2', 'profile', 210, 140, { w: 150, h: 60, fill: fill.white }), N('b3', 'App chunk', 390, 140, { w: 150, h: 60, fill: fill.white }),
      N('b4', 'page chunk + 25 icon chunks', 570, 140, { w: 250, h: 60, fill: fill.white }), N('b5', 'mount', 830, 140, { w: 120, h: 60, fill: fill.white }), N('b6', 'four table reads', 980, 140, { w: 170, h: 60, fill: fill.white }),
      N('b7', 'integrations function, twice', 1170, 140, { w: 220, h: 60, fill: fill.external, stroke: S.external }),
      N('a1', 'index.js', 30, 400, { w: 150, h: 60, fill: fill.white }),
      N('a2', 'profile', 260, 330, { w: 150, h: 60, fill: fill.white }), N('a3', 'App chunk', 260, 400, { w: 150, h: 60, fill: fill.white }), N('a4', 'route chunk, icons and controls grouped', 260, 470, { w: 340, h: 60, fill: fill.white }),
      N('a5', 'route reads + today\'s events', 480, 330, { w: 230, h: 60, fill: fill.storage, stroke: S.storage }), N('a6', 'mount with data in flight', 790, 400, { w: 220, h: 60, fill: fill.white }),
      N('a7', 'render', 1090, 400, { w: 140, h: 60, fill: fill.storage, stroke: S.storage })
    ],
    edges: [
      E('b1', 'b2', { color: S.external }), E('b2', 'b3', { color: S.external }), E('b3', 'b4', { color: S.external }), E('b4', 'b5', { color: S.external }), E('b5', 'b6', { color: S.external }), E('b6', 'b7', { color: S.external }),
      E('a1', 'a2', { color: S.storage }), E('a1', 'a3', { color: S.storage }), E('a1', 'a4', { color: S.storage }), E('a2', 'a5', { color: S.storage }),
      E('a3', 'a6', { color: S.storage, via: [[640, 430]] }), E('a4', 'a6', { color: S.storage, via: [[640, 500], [640, 430]] }), E('a5', 'a6', { color: S.storage }), E('a6', 'a7', { color: S.storage })
    ],
    notes: [{ text: 'Assets come from the service worker after the first visit, so the chain is dominated by round trips, not bytes.', x: 30, y: 620, size: 13 }]
  },
  streaks: {
    title: 'How a habit day resolves',
    subtitle: 'Per-habit streaks, a shared monthly freeze pool spent by hand, and one recovery path.',
    nodes: [
      N('day', 'Day ends', 0, 140, { w: 150, h: 60, fill: fill.neutral, stroke: S.neutral }),
      N('done', 'Habit complete?', 220, 120, { shape: 'diamond', w: 200, h: 110, fill: fill.jobs, stroke: S.jobs }),
      N('streak', 'Streak +1', 500, 140, { w: 150, h: 60, fill: fill.storage, stroke: S.storage }),
      N('perfect', 'Every active habit done?', 720, 120, { shape: 'diamond', w: 240, h: 110, fill: fill.jobs, stroke: S.jobs }),
      N('earn', 'Perfect day: a spent freeze returns', 1030, 140, { w: 250, h: 60, fill: fill.storage, stroke: S.storage }),
      N('gold', 'Seven freeze-free days: gold', 1030, 240, { w: 250, h: 60, fill: fill.jobs, stroke: S.jobs }),
      N('next', 'Next day: backfill or spend a freeze?', 220, 330, { shape: 'diamond', w: 240, h: 130, fill: fill.jobs, stroke: S.jobs }),
      N('covered', 'Streak intact', 660, 355, { note: 'one freeze per habit per day; a later backfill refunds it', w: 260, h: 80, fill: fill.storage, stroke: S.storage }),
      N('broken', 'Streak breaks', 220, 560, { w: 150, h: 60, fill: fill.external, stroke: S.external }),
      N('earnback', 'Two clean days within 48 hours?', 460, 540, { shape: 'diamond', w: 260, h: 120, fill: fill.jobs, stroke: S.jobs }),
      N('restored', 'Earn-Back restores it', 800, 550, { note: 'once per habit per month', w: 220, h: 80, fill: fill.storage, stroke: S.storage }),
      N('reset', 'Streak starts over', 800, 660, { w: 200, h: 60, fill: fill.external, stroke: S.external })
    ],
    edges: [
      E('day', 'done', { color: S.neutral }), E('done', 'streak', { label: 'yes', color: S.storage }), E('streak', 'perfect', { color: S.storage }),
      E('perfect', 'earn', { label: 'yes', color: S.storage }), E('streak', 'gold', { color: S.jobs, style: 'dashed', via: [[575, 270]] }),
      E('done', 'next', { label: 'no', color: S.external }), E('next', 'covered', { label: 'yes, yesterday only', color: S.storage }),
      E('next', 'broken', { label: 'no', color: S.external }), E('broken', 'earnback', { color: S.external }), E('earnback', 'restored', { label: 'yes', color: S.storage }),
      E('earnback', 'reset', { label: 'no', color: S.external, via: [[590, 690]] })
    ],
    notes: [{ text: 'LeetCode keeps its own streak and a pool of five freezes a month, with no Earn-Back.', x: 0, y: 760, size: 13 }]
  }
}
