// Scene specs for docs/diagrams. Coordinates are canvas pixels. Nodes default to 180 wide and 140 tall with a 60px icon; arrow labels land at the route's middle point; `shape: 'diamond'` makes a decision.
const fill = { supabase: '#a5d8ff', app: '#d0bfff', storage: '#b2f2bb', external: '#ffc9c9', jobs: '#ffec99', neutral: '#e9ecef', white: '#ffffff' }
const S = { supabase: '#1971c2', app: '#7048e8', storage: '#2f9e44', external: '#e03131', jobs: '#f08c00', neutral: '#868e96', ink: '#1e1e1e' }
const I = {
  browser: { library: 'software-architecture', item: 5 }, microservice: { library: 'software-architecture', item: 0 },
  database: { library: 'software-architecture', item: 1 }, bus: { library: 'software-architecture', item: 3 },
  cdn: { library: 'system-design', item: 20 }, lock: { library: 'system-design', item: 14 }, objectStorage: { library: 'system-design', item: 7 },
  cloud: { library: 'system-design', item: 19 }, archive: { library: 'system-design', item: 21 }, webApp: { library: 'system-design', item: 23 },
  user: { library: 'architecture-diagram-components', item: 'User' }, client: { library: 'network-topology-icons', item: 'Client' },
  firewall: { library: 'network-topology-icons', item: 'Firewall' }, computer: { library: 'network-topology-icons', item: 'Computer w/ keyboard and mouse (3D)' },
  postgres: { library: 'drwnio', item: 12 }, github: { library: 'drwnio', item: 13 }, code: { library: 'drwnio', item: 11 }, json: { library: 'drwnio', item: 3 },
  chip: { library: 'drwnio', item: 8 }, bucket: { library: 'drwnio', item: 0 },
  lightning: { library: 'system-icons', item: 'lightning' }, star: { library: 'system-icons', item: 'star' }, warn: { library: 'system-icons', item: 'warn' },
  document: { library: 'system-icons', item: 'document' }, gear: { library: 'system-icons', item: 'set up' }, broom: { library: 'system-icons', item: 'clean up' },
  notice: { library: 'system-icons', item: 'notice' }, filter: { library: 'system-icons', item: 'filter' },
  notes: { library: 'icons', item: 'notes' }, documents: { library: 'icons', item: 'documents' }, paper: { library: 'icons', item: 'paper' },
  clipboard: { library: 'icons', item: 'clipboard' }, password: { library: 'icons', item: 'password' }, shredder: { library: 'icons', item: 'shredder' },
  del: { library: 'icons', item: 'delete' }, upload: { library: 'icons', item: 'upload' }, attachment: { library: 'icons', item: 'attachment' },
  search: { library: 'icons', item: 'search' }, zip: { library: 'icons', item: 'zip' }, share: { library: 'icons', item: 'share' },
  download: { library: 'icons', item: 'download' }
}
const N = (id, label, x, y, extra = {}) => ({ id, label, x, y, ...extra })
const E = (from, to, extra = {}) => ({ from, to, ...extra })

export const scenes = {
  runtime: {
    title: 'Runtime and deployment',
    subtitle: 'One React app inside the Tauri desktop shell, one Supabase project per environment, signed updates from GitHub Releases, and agents that reach the same commands over remote MCP.',
    zones: [
      { id: 'z-client', label: 'Desktop app', x: 0, y: 90, w: 440, h: 400, stroke: S.app, fill: '#f3f0ff' },
      { id: 'z-agent', label: 'Agent hosts', x: 0, y: 640, w: 440, h: 220, stroke: S.neutral },
      { id: 'z-supabase', label: 'Supabase project (staging or production)', x: 540, y: 90, w: 560, h: 770, stroke: S.supabase, fill: '#e7f5ff' },
      { id: 'z-external', label: 'External services', x: 1200, y: 90, w: 230, h: 940, stroke: S.external, fill: '#fff5f5' }
    ],
    nodes: [
      N('desktop', 'Tauri shell', 30, 130, { note: 'window, deep links, updater, SQLite mirror', icon: I.computer, fill: fill.neutral, stroke: S.neutral }),
      N('web', 'Manor app', 240, 130, { note: 'React, TanStack Query, IndexedDB drafts', icon: I.browser, fill: fill.app, stroke: S.app }),
      N('releases', 'GitHub Releases', 30, 320, { note: 'signed builds, latest.json', icon: I.github, fill: fill.external, stroke: S.external }),
      N('chatgpt', 'ChatGPT or Codex', 30, 680, { note: 'remote MCP client', icon: I.client, fill: fill.neutral, stroke: S.neutral }),
      N('scheduled', 'Scheduled review task', 240, 680, { note: 'ChatGPT Work, Sunday 22:00', icon: I.lightning, fill: fill.neutral, stroke: S.neutral }),
      N('auth', 'Auth', 570, 130, { note: 'Google sign-in, hooks, OAuth server', icon: I.lock, fill: fill.supabase, stroke: S.supabase }),
      N('db', 'Postgres', 570, 300, { note: 'RLS, commands, history, cron', icon: I.postgres, fill: fill.supabase, stroke: S.supabase }),
      N('files', 'Storage', 570, 470, { note: 'private manor-files bucket', icon: I.objectStorage, fill: fill.storage, stroke: S.storage }),
      N('workers', 'Workers', 900, 300, { note: 'integrations, jobs, embeddings', icon: I.microservice, fill: fill.supabase, stroke: S.supabase }),
      N('mcp', 'manor-mcp', 900, 680, { note: 'Edge Function, 121 operations', icon: I.code, fill: fill.supabase, stroke: S.supabase }),
      N('google', 'Google', 1230, 130, { note: 'identity, Calendar (read-only)', icon: I.cloud, fill: fill.external, stroke: S.external }),
      N('x', 'X bookmarks', 1230, 300, { icon: I.star, fill: fill.external, stroke: S.external }),
      N('simplify', 'SimplifyJobs', 1230, 470, { note: 'listings.json on GitHub', icon: I.github, fill: fill.external, stroke: S.external }),
      N('openai', 'OpenAI embeddings', 1230, 660, { note: 'text-embedding-3-small', icon: I.chip, fill: fill.external, stroke: S.external }),
      N('canvas', 'Canvas feed', 1230, 850, { note: 'saved link, read on demand', icon: I.cloud, fill: fill.external, stroke: S.external })
    ],
    edges: [
      E('desktop', 'web', { color: S.neutral }),
      E('releases', 'desktop', { label: 'updates', color: S.external }),
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
  releases: {
    title: 'Releases and updates',
    subtitle: 'One script builds, signs, and publishes; the installed app watches the feed, checks the signature, and restarts into the new bundle.',
    zones: [
      { id: 'z-publish', label: 'Publishing', x: 0, y: 90, w: 900, h: 260, stroke: S.storage, fill: '#ebfbee' },
      { id: 'z-installed', label: 'The installed app', x: 0, y: 410, w: 1260, h: 420, stroke: S.app, fill: '#f3f0ff' }
    ],
    nodes: [
      N('script', 'Release script', 30, 135, { note: 'version from app/package.json', icon: I.code, fill: fill.neutral, stroke: S.neutral }),
      N('archive', 'Signed archive', 250, 135, { note: 'minisign key kept outside the repository', icon: I.lock, fill: fill.jobs, stroke: S.jobs }),
      N('feed', 'latest.json', 470, 135, { note: 'darwin-aarch64: version, signature, URL', icon: I.json, fill: fill.supabase, stroke: S.supabase }),
      N('published', 'GitHub Releases', 690, 135, { note: 'v<version>, marked as the latest release', icon: I.github, fill: fill.external, stroke: S.external }),
      N('check', 'Update check', 30, 455, { note: 'launch, hourly, focus after an hour', icon: I.gear, fill: fill.neutral, stroke: S.neutral }),
      N('notice', 'Update notice', 250, 455, { note: 'names the version, offers a restart', icon: I.notice, fill: fill.jobs, stroke: S.jobs }),
      N('guard', 'Dialog open or an edit unprotected?', 470, 465, { shape: 'diamond', w: 250, h: 150, fill: fill.jobs, stroke: S.jobs }),
      N('install', 'Download and install', 800, 455, { w: 220, note: 'only with a valid signature for the shipped public key', icon: I.download, fill: fill.storage, stroke: S.storage }),
      N('relaunch', 'Relaunch', 1070, 455, { note: 'macOS runs the new bundle only after a restart', icon: I.lightning, fill: fill.storage, stroke: S.storage }),
      N('wait', 'Wait', 470, 700, { w: 250, note: 'the notice stays until it is safe', fill: fill.neutral, stroke: S.neutral })
    ],
    edges: [
      E('script', 'archive', { color: S.storage }), E('archive', 'feed', { color: S.storage }), E('feed', 'published', { color: S.storage }),
      E('published', 'check', { label: 'the feed', color: S.external, via: [[780, 370], [230, 370]] }),
      E('check', 'notice', { color: S.jobs }), E('notice', 'guard', { color: S.jobs }),
      E('guard', 'wait', { label: 'yes', color: S.neutral }), E('guard', 'install', { label: 'no', color: S.storage }),
      E('install', 'relaunch', { color: S.storage })
    ],
    notes: [
      { text: 'The staging script publishes the same three files to one rolling prerelease, which staging builds watch instead.', x: 0, y: 900, size: 13 },
      { text: 'An installed app trusts only the key it shipped with, so a build signed with any other key is refused.', x: 0, y: 925, size: 13 }
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
      { id: 'z-agent', label: 'Agent client', x: 0, y: 340, w: 940, h: 240, stroke: S.neutral }
    ],
    nodes: [
      N('google', 'Google sign-in', 30, 130, { note: 'verified email identity, in the system browser', icon: I.cloud, fill: fill.external, stroke: S.external }),
      N('gate', 'Signup gate', 260, 130, { note: 'shared password, single-use grant bound to the email', icon: I.firewall, fill: fill.jobs, stroke: S.jobs }),
      N('hook', 'before-user-created hook', 490, 130, { note: 'rejects creation without a grant', icon: I.lock, fill: fill.supabase, stroke: S.supabase }),
      N('session', 'App session', 720, 130, { note: 'returned by deep link, custom access token claims', icon: I.browser, fill: fill.app, stroke: S.app }),
      N('client', 'ChatGPT or Codex', 30, 380, { icon: I.client, fill: fill.neutral, stroke: S.neutral }),
      N('discovery', 'OAuth 2.1 discovery', 260, 380, { note: 'protected-resource metadata, PKCE', icon: I.json, fill: fill.supabase, stroke: S.supabase }),
      N('consent', 'Consent in the app', 490, 380, { note: 'from the browser; read or read-write, revocable', icon: I.webApp, fill: fill.supabase, stroke: S.supabase }),
      N('token', 'Scoped token', 720, 380, { note: 'client_id claim, refresh, revocation', icon: I.password, fill: fill.app, stroke: S.app }),
      N('rls', 'Row-level security', 1040, 255, { note: 'user_id = (select auth.uid()) and MCP scope policies', icon: I.postgres, fill: fill.supabase, stroke: S.supabase }),
      N('ops', '121 operations', 1290, 255, { note: '48 reads, 73 writes, one catalog', icon: I.code, fill: fill.storage, stroke: S.storage })
    ],
    edges: [
      E('google', 'gate', { color: S.external }), E('gate', 'hook', { color: S.jobs }), E('hook', 'session', { color: S.supabase }),
      E('client', 'discovery', { color: S.neutral }), E('discovery', 'consent', { color: S.supabase }), E('consent', 'token', { color: S.supabase }),
      E('session', 'rls', { color: S.app }), E('token', 'rls', { color: S.app }), E('rls', 'ops', { color: S.supabase })
    ]
  },
  'deep-links': {
    title: 'Leaving for the browser and coming back',
    subtitle: 'An embedded webview cannot serve an authorization page, so anything that needs a real browser opens in one and returns on the build\'s URL scheme.',
    zones: [
      { id: 'z-signin', label: 'Google sign-in', x: 0, y: 90, w: 730, h: 250, stroke: S.app, fill: '#f3f0ff' },
      { id: 'z-consent', label: 'Agent consent', x: 0, y: 380, w: 730, h: 250, stroke: S.neutral },
      { id: 'z-connect', label: 'Integration connections', x: 0, y: 670, w: 730, h: 250, stroke: S.external, fill: '#fff5f5' },
      { id: 'z-back', label: 'Back in the app', x: 790, y: 90, w: 900, h: 830, stroke: S.supabase, fill: '#e7f5ff' }
    ],
    nodes: [
      N('start1', 'Sign in', 30, 135, { note: 'skipBrowserRedirect', icon: I.user, fill: fill.app, stroke: S.app }),
      N('browser1', 'System browser', 250, 135, { note: 'Supabase Auth, then Google', icon: I.browser, fill: fill.external, stroke: S.external }),
      N('link1', 'manor://auth/callback', 470, 135, { w: 220, note: 'authorization code', icon: I.share, fill: fill.jobs, stroke: S.jobs }),
      N('start2', 'Agent asks', 30, 425, { note: 'ChatGPT or Codex', icon: I.client, fill: fill.neutral, stroke: S.neutral }),
      N('server2', 'OAuth server', 250, 425, { note: 'its site URL is the app scheme', icon: I.lock, fill: fill.supabase, stroke: S.supabase }),
      N('link2', 'manor:/oauth/consent', 470, 425, { w: 220, note: 'authorization_id', icon: I.share, fill: fill.jobs, stroke: S.jobs }),
      N('start3', 'Settings', 30, 715, { note: 'connect Google or X', icon: I.gear, fill: fill.app, stroke: S.app }),
      N('browser3', 'Provider consent', 250, 715, { note: 'Google or X, in the browser', icon: I.cloud, fill: fill.external, stroke: S.external }),
      N('link3', 'manor://settings', 470, 715, { w: 220, note: 'connection_code from integration-callback', icon: I.share, fill: fill.jobs, stroke: S.jobs }),
      N('inbox', 'Route inbox', 810, 425, { w: 200, note: 'a link that arrives before the router waits for it', icon: I.bus, fill: fill.app, stroke: S.app }),
      N('which', 'Which route?', 1060, 440, { shape: 'diamond', w: 210, h: 130, fill: fill.jobs, stroke: S.jobs }),
      N('session', 'Session opens', 1420, 135, { w: 220, note: 'exchangeCodeForSession', icon: I.password, fill: fill.storage, stroke: S.storage }),
      N('consent', 'Consent page', 1420, 425, { w: 220, note: 'approve, then the agent\'s callback opens in the browser', icon: I.webApp, fill: fill.supabase, stroke: S.supabase }),
      N('settings', 'Back in Settings', 1420, 715, { w: 220, note: 'the connection completes', icon: I.gear, fill: fill.app, stroke: S.app })
    ],
    edges: [
      E('start1', 'browser1', { color: S.app }), E('browser1', 'link1', { color: S.external }), E('link1', 'inbox', { color: S.jobs }),
      E('start2', 'server2', { color: S.neutral }), E('server2', 'link2', { color: S.supabase }), E('link2', 'inbox', { color: S.jobs }),
      E('start3', 'browser3', { color: S.app }), E('browser3', 'link3', { color: S.external }), E('link3', 'inbox', { color: S.jobs }),
      E('inbox', 'which', { color: S.app }),
      E('which', 'session', { label: 'auth/callback', color: S.storage }),
      E('which', 'consent', { label: 'oauth/consent', color: S.supabase }),
      E('which', 'settings', { label: 'settings', color: S.app })
    ],
    notes: [
      { text: 'Only the sign-in callback is handled before the router exists; every other link is a route the app navigates to.', x: 0, y: 960, size: 13 },
      { text: 'Staging is the same picture on the manor-staging scheme, so a link for one build never opens the other.', x: 0, y: 985, size: 13 }
    ]
  },
  mirror: {
    title: 'Local mirror and sync',
    subtitle: 'Pages read rows the shell keeps in SQLite; writes stay server-authoritative, and the change feed brings every committed change back.',
    zones: [
      { id: 'z-app', label: 'Desktop app', x: 0, y: 90, w: 880, h: 430, stroke: S.app, fill: '#f3f0ff' },
      { id: 'z-supabase', label: 'Supabase project', x: 960, y: 90, w: 320, h: 430, stroke: S.supabase, fill: '#e7f5ff' }
    ],
    nodes: [
      N('ui', 'Pages', 30, 130, { note: 'React, TanStack Query keys unchanged', icon: I.browser, fill: fill.app, stroke: S.app }),
      N('gateway', 'Gateway', 340, 130, { note: 'reads, manor_command, revisions', icon: I.bus, fill: fill.app, stroke: S.app }),
      N('sync', 'Mirror sync', 650, 130, { note: 'bootstrap, pull, derived cache', icon: I.gear, fill: fill.neutral, stroke: S.neutral }),
      N('sqlite', 'SQLite mirror', 650, 330, { note: 'Tauri shell: rows with revisions, cursor', icon: I.database, fill: fill.jobs, stroke: S.jobs }),
      N('feed', 'Change feed', 990, 130, { note: 'workspace_changes: cursor, identity, revision', icon: I.json, fill: fill.supabase, stroke: S.supabase }),
      N('tables', 'Tables', 990, 330, { note: 'owner rows under RLS', icon: I.postgres, fill: fill.supabase, stroke: S.supabase })
    ],
    edges: [
      E('ui', 'gateway', { label: 'reads, commands', color: S.app }),
      E('gateway', 'sqlite', { label: 'rows when ready', color: S.jobs, via: [[490, 400]] }),
      E('gateway', 'sync', { label: 'pull after commit', color: S.neutral }),
      E('gateway', 'tables', { label: 'manor_command', color: S.supabase, via: [[370, 300], [370, 560], [1080, 560]] }),
      E('sync', 'feed', { label: 'changes since cursor', color: S.supabase }),
      E('sync', 'tables', { label: 're-read changed rows, bootstrap all', color: S.supabase }),
      E('sync', 'sqlite', { label: 'upsert, delete, cursor', color: S.jobs })
    ]
  },
  pull: {
    title: 'One pull of the change feed',
    subtitle: 'A poke starts it; the feed decides which rows to look at, and Postgres still decides what they hold.',
    nodes: [
      N('poke', 'Poke', 0, 130, { w: 210, note: 'realtime, focus, online, a minute, launch, own command', icon: I.lightning, fill: fill.app, stroke: S.app }),
      N('head', 'Mirror empty or ahead of the head?', 270, 145, { shape: 'diamond', w: 230, h: 140, fill: fill.jobs, stroke: S.jobs }),
      N('bootstrap', 'Bootstrap', 270, 400, { w: 230, note: 'every table in full, then the head cursor', icon: I.database, fill: fill.storage, stroke: S.storage }),
      N('page', 'Feed page', 540, 130, { w: 290, note: 'manor_workspace_changes(since, 1000)', icon: I.json, fill: fill.supabase, stroke: S.supabase }),
      N('group', 'Group by table', 870, 130, { w: 210, note: 'the last change for a key wins', icon: I.filter, fill: fill.neutral, stroke: S.neutral }),
      N('kind', 'Delete or purge?', 1140, 145, { shape: 'diamond', w: 220, h: 130, fill: fill.jobs, stroke: S.jobs }),
      N('remove', 'Remove by key', 1440, 180, { w: 200, h: 60, fill: fill.external, stroke: S.external }),
      N('revision', 'Local revision already current?', 1140, 630, { shape: 'diamond', w: 220, h: 140, fill: fill.jobs, stroke: S.jobs }),
      N('skip', 'Skip the re-read', 1440, 670, { w: 200, h: 60, fill: fill.neutral, stroke: S.neutral }),
      N('reread', 'Re-read the row', 830, 620, { w: 240, note: 'by identity, batched per table', icon: I.search, fill: fill.supabase, stroke: S.supabase }),
      N('returned', 'Row returned?', 550, 630, { shape: 'diamond', w: 210, h: 130, fill: fill.jobs, stroke: S.jobs }),
      N('upsert', 'Upsert the row', 280, 660, { w: 200, h: 60, fill: fill.storage, stroke: S.storage }),
      N('gone', 'Delete the row', 550, 850, { w: 210, note: 'gone, or hidden by row-level security', fill: fill.external, stroke: S.external }),
      N('commit', 'Commit the cursor', 0, 660, { w: 210, note: 'the page\'s last cursor, once it applied', icon: I.clipboard, fill: fill.neutral, stroke: S.neutral }),
      N('invalidate', 'Invalidate', 0, 890, { w: 230, note: 'touched tables and calendar_days', icon: I.broom, fill: fill.app, stroke: S.app }),
      N('announce', 'manor:committed', 290, 890, { w: 230, note: 'pages reload on the event they already watch', icon: I.lightning, fill: fill.app, stroke: S.app })
    ],
    edges: [
      E('poke', 'head', { color: S.app }),
      E('head', 'bootstrap', { label: 'yes', color: S.storage }),
      E('head', 'page', { label: 'no', color: S.supabase }),
      E('page', 'group', { color: S.supabase }), E('group', 'kind', { color: S.neutral }),
      E('kind', 'remove', { label: 'yes', color: S.external }),
      E('kind', 'revision', { label: 'no', color: S.jobs }),
      E('revision', 'skip', { label: 'yes', color: S.neutral }),
      E('revision', 'reread', { label: 'no', color: S.supabase }),
      E('reread', 'returned', { color: S.supabase }),
      E('returned', 'upsert', { label: 'yes', color: S.storage }),
      E('returned', 'gone', { label: 'no', color: S.external }),
      E('upsert', 'commit', { color: S.storage }),
      E('commit', 'invalidate', { color: S.neutral }), E('invalidate', 'announce', { color: S.app })
    ],
    notes: [
      { text: 'Each page commits its own last cursor, so an interrupted pull repeats a page instead of skipping one.', x: 0, y: 1090, size: 13 },
      { text: 'A change to job_roles also re-pulls job_stage_transitions, which carries no feed trigger of its own.', x: 0, y: 1115, size: 13 },
      { text: 'A connection error keeps the mirror serving reads; any other failure parks them on the server until a pull succeeds.', x: 0, y: 1140, size: 13 },
      { text: 'note_pages is always re-read, because opening a note moves last_opened_at without moving its revision.', x: 0, y: 1165, size: 13 }
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
    title: 'What a launch waits for',
    subtitle: 'A cold start of the installed app, with the milestones the shell log records.',
    zones: [
      { id: 'z-path', label: 'On the critical path', x: 0, y: 90, w: 1560, h: 230, stroke: S.storage, fill: '#ebfbee' },
      { id: 'z-side', label: 'Off the critical path', x: 700, y: 370, w: 920, h: 210, stroke: S.neutral }
    ],
    nodes: [
      N('process', 'Process start', 20, 160, { w: 170, h: 90, fill: fill.white }),
      N('shell', 'Shell ready', 210, 160, { w: 170, h: 90, note: 'window hidden', fill: fill.white }),
      N('theme', 'Theme applied', 400, 160, { w: 170, h: 90, note: 'first render dispatched', fill: fill.white }),
      N('window', 'Window shown', 590, 160, { w: 170, h: 90, note: 'about 300 ms', fill: fill.storage, stroke: S.storage }),
      N('session', 'Session', 780, 160, { w: 170, h: 90, note: 'from local storage', fill: fill.white }),
      N('account', 'Cached account', 970, 160, { w: 170, h: 90, note: 'renders at once', fill: fill.white }),
      N('mirror', 'Mirror open', 1160, 160, { w: 170, h: 90, note: 'ready from the last launch', fill: fill.white }),
      N('home', 'Home reads the mirror', 1350, 160, { w: 170, h: 90, note: 'about 20 ms', fill: fill.storage, stroke: S.storage }),
      N('profile', 'Profile read', 880, 430, { w: 200, h: 90, note: 'reconciles name and time zone', fill: fill.white, stroke: S.neutral }),
      N('pull', 'First pull', 1130, 430, { w: 200, h: 90, note: 'catches the mirror up', fill: fill.white, stroke: S.neutral }),
      N('shared', 'Feed-less tables', 1360, 430, { w: 240, h: 90, note: 'refreshed on launch and hourly', fill: fill.white, stroke: S.neutral })
    ],
    edges: [
      E('process', 'shell', { color: S.storage }), E('shell', 'theme', { color: S.storage }), E('theme', 'window', { color: S.storage }),
      E('window', 'session', { color: S.storage }), E('session', 'account', { color: S.storage }), E('account', 'mirror', { color: S.storage }),
      E('mirror', 'home', { color: S.storage }),
      E('account', 'profile', { color: S.neutral, style: 'dashed' }),
      E('mirror', 'pull', { color: S.neutral, style: 'dashed' }),
      E('mirror', 'shared', { color: S.neutral, style: 'dashed' })
    ],
    notes: [
      { text: 'Measured on one Mac with the desktop benchmark, which relaunches the installed app and reads these lines back; they describe that machine, not a budget.', x: 0, y: 620, size: 13 },
      { text: 'Every later route reads the same mirror, so it settles in the same tens of milliseconds as Home.', x: 0, y: 645, size: 13 }
    ]
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
