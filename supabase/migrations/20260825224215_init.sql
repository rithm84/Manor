-- Manor initial schema: Supabase becomes the source of truth for every module.
-- Mirrors app/src/shared/*.ts models and app/src/main/*Store.ts SQLite shapes
-- in snake_case, with per-user RLS ownership on every table.

create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

create table profiles (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  name text,
  email text,
  settings jsonb not null default '{}'
);

alter table profiles enable row level security;

create policy "profiles_owner" on profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Home module: contexts, tasks, scratch blocks, saved task views
-- ---------------------------------------------------------------------------

create table contexts (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 48),
  color text not null check (color in ('forest', 'success', 'gold', 'info', 'plum', 'today')),
  icon text not null check (icon in (
    'book-open', 'graduation-cap', 'library', 'notebook-tabs', 'brain', 'calculator',
    'briefcase', 'laptop', 'rocket', 'presentation', 'landmark', 'badge-dollar-sign',
    'house', 'heart', 'users', 'shopping-bag', 'utensils', 'car',
    'code', 'terminal', 'git-branch', 'bug', 'database', 'cpu',
    'target', 'trophy', 'dumbbell', 'activity', 'flame', 'mountain',
    'sparkles', 'palette', 'music', 'camera', 'plane', 'globe'
  )),
  primary key (user_id, name)
);

alter table contexts enable row level security;

create policy "contexts_owner" on contexts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  context text not null,
  estimate_minutes integer check (estimate_minutes in (15, 30, 60, 120, 180, 240)),
  priority text check (priority in ('Low', 'Medium', 'High')),
  status text not null check (status in ('Not started', 'In Progress', 'Done')),
  due date not null,
  tags text[] not null default '{}',
  recurrence text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table tasks enable row level security;

create policy "tasks_owner" on tasks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index tasks_user_due on tasks (user_id, due);
create index tasks_user_status on tasks (user_id, status);

create table scratch_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- null task_id = a freestanding sticky note (not time-blocking any task)
  task_id uuid references tasks (id) on delete cascade,
  date date not null,
  start_time text not null check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time text not null check (end_time ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'),
  portion text not null default '',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (end_time > start_time)
);

alter table scratch_blocks enable row level security;

create policy "scratch_blocks_owner" on scratch_blocks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index scratch_blocks_user_date on scratch_blocks (user_id, date);
create index scratch_blocks_task on scratch_blocks (task_id);

create table saved_task_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  rules jsonb not null default '[]'
);

alter table saved_task_views enable row level security;

create policy "saved_task_views_owner" on saved_task_views
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index saved_task_views_user on saved_task_views (user_id);

-- ---------------------------------------------------------------------------
-- Habits: definitions, lifecycle, entries, freeze pool (mirrors habitStore.ts)
-- ---------------------------------------------------------------------------

create table habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  kind text not null check (kind in ('binary', 'quantized')),
  -- binary habits have no target label; quantized habits require one
  target_label text,
  created_on date not null,
  created_at timestamptz not null default now(),
  check ((kind = 'binary' and target_label is null) or (kind = 'quantized' and target_label is not null))
);

alter table habits enable row level security;

create policy "habits_owner" on habits
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index habits_user on habits (user_id);

create table habit_lifecycle (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  habit_id uuid not null references habits (id) on delete cascade,
  date date not null,
  status text not null check (status in ('active', 'paused', 'retired')),
  created_at timestamptz not null default now(),
  primary key (habit_id, date)
);

alter table habit_lifecycle enable row level security;

create policy "habit_lifecycle_owner" on habit_lifecycle
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index habit_lifecycle_user on habit_lifecycle (user_id);

create table habit_entries (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  habit_id uuid not null references habits (id) on delete cascade,
  date date not null,
  value integer not null check (value in (25, 50, 75, 100)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (habit_id, date)
);

alter table habit_entries enable row level security;

create policy "habit_entries_owner" on habit_entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index habit_entries_user_date on habit_entries (user_id, date);

create table habit_freeze_usage (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  habit_id uuid not null references habits (id) on delete cascade,
  date date not null,
  primary key (habit_id, date)
);

alter table habit_freeze_usage enable row level security;

create policy "habit_freeze_usage_owner" on habit_freeze_usage
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index habit_freeze_usage_user on habit_freeze_usage (user_id);

create table habit_freeze_grants (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  primary key (user_id, date)
);

alter table habit_freeze_grants enable row level security;

create policy "habit_freeze_grants_owner" on habit_freeze_grants
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table habit_finalized_days (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  primary key (user_id, date)
);

alter table habit_finalized_days enable row level security;

create policy "habit_finalized_days_owner" on habit_finalized_days
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table habit_month_pools (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  month text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  capacity integer not null check (capacity >= 0),
  primary key (user_id, month)
);

alter table habit_month_pools enable row level security;

create policy "habit_month_pools_owner" on habit_month_pools
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Mood and focus
-- ---------------------------------------------------------------------------

create table mood_focus_entries (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  mood text check (mood in ('Great', 'Good', 'Neutral', 'Bad', 'Awful')),
  focus text check (focus in ('Locked In', 'High', 'Medium', 'Low', 'Locked Out', 'Resting')),
  note text check (char_length(note) <= 1000),
  note_source text check (note_source in ('manual', 'alfred')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, date),
  check (mood is not null or focus is not null),
  check ((note is null) = (note_source is null))
);

alter table mood_focus_entries enable row level security;

create policy "mood_focus_entries_owner" on mood_focus_entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- LeetCode: per-user curriculum copy plus attempts (mirrors leetCodeStore.ts)
-- ---------------------------------------------------------------------------

create table leetcode_problems (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  topic text not null,
  name text not null,
  difficulty text not null check (difficulty in ('Easy', 'Medium', 'Hard')),
  curriculum_order integer not null check (curriculum_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table leetcode_problems enable row level security;

create policy "leetcode_problems_owner" on leetcode_problems
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table leetcode_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  problem_id text not null,
  date date not null,
  -- exact user-authored source; whitespace and comments are significant
  solution text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, problem_id) references leetcode_problems (user_id, id) on delete cascade
);

alter table leetcode_attempts enable row level security;

create policy "leetcode_attempts_owner" on leetcode_attempts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index leetcode_attempts_user_problem_date
  on leetcode_attempts (user_id, problem_id, date desc, created_at desc);

-- ---------------------------------------------------------------------------
-- Jobs: resumes, roles, stage transitions
-- ---------------------------------------------------------------------------

create table resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  label text not null,
  file_name text not null,
  storage_path text not null,
  byte_size bigint check (byte_size >= 0),
  uploaded_at timestamptz not null default now()
);

alter table resumes enable row level security;

create policy "resumes_owner" on resumes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index resumes_user on resumes (user_id);

create table job_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  company text not null check (char_length(company) between 1 and 160),
  role text not null check (char_length(role) between 1 and 160),
  location text not null default '' check (char_length(location) <= 160),
  link text not null default '' check (char_length(link) <= 2000),
  posted date,
  stage text not null check (stage in ('to_apply', 'applied', 'oa', 'interview_1', 'interview_2', 'interview_3', 'offer', 'rejected')),
  applied date,
  oa_due date,
  interview1 date,
  interview2 date,
  interview3 date,
  decision date,
  resume_id uuid references resumes (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table job_roles enable row level security;

create policy "job_roles_owner" on job_roles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index job_roles_user_stage on job_roles (user_id, stage);

create table job_stage_transitions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role_id uuid not null references job_roles (id) on delete cascade,
  from_stage text check (from_stage in ('to_apply', 'applied', 'oa', 'interview_1', 'interview_2', 'interview_3', 'offer', 'rejected')),
  to_stage text not null check (to_stage in ('to_apply', 'applied', 'oa', 'interview_1', 'interview_2', 'interview_3', 'offer', 'rejected')),
  at timestamptz not null default now()
);

alter table job_stage_transitions enable row level security;

create policy "job_stage_transitions_owner" on job_stage_transitions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index job_stage_transitions_user on job_stage_transitions (user_id);
create index job_stage_transitions_role on job_stage_transitions (role_id, at);

-- ---------------------------------------------------------------------------
-- Notes: folders, pages, attachments (mirrors notesStore.ts)
-- ---------------------------------------------------------------------------

create table note_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  parent_folder_id uuid references note_folders (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table note_folders enable row level security;

create policy "note_folders_owner" on note_folders
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index note_folders_user on note_folders (user_id);

create table note_pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  folder_id uuid references note_folders (id) on delete set null,
  parent_page_id uuid references note_pages (id) on delete cascade,
  -- BlockNote document: a top-level array of blocks
  content_json jsonb not null default '[]',
  favorite boolean not null default false,
  status text not null default 'active' check (status in ('active', 'archived', 'trash')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_opened_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

alter table note_pages enable row level security;

create policy "note_pages_owner" on note_pages
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index note_pages_user_status_updated on note_pages (user_id, status, updated_at desc);
create index note_pages_folder on note_pages (folder_id, parent_page_id);

create table note_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  note_id uuid not null references note_pages (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 255),
  mime_type text not null check (char_length(mime_type) between 1 and 200),
  size bigint not null check (size >= 0),
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

alter table note_attachments enable row level security;

create policy "note_attachments_owner" on note_attachments
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index note_attachments_note on note_attachments (note_id);

-- ---------------------------------------------------------------------------
-- Knowledge base
-- ---------------------------------------------------------------------------

create table kb_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source text not null check (source in ('x_bookmark', 'capture')),
  url text,
  title text,
  author text,
  summary text,
  content_md text,
  raw jsonb not null default '{}',
  screenshot_path text,
  status text not null default 'pending' check (status in ('pending', 'normalized', 'failed')),
  error text,
  captured_at timestamptz not null default now(),
  normalized_at timestamptz,
  embedding vector(1536)
);

alter table kb_entries enable row level security;

create policy "kb_entries_owner" on kb_entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index kb_entries_user_captured on kb_entries (user_id, captured_at desc);
create index kb_entries_embedding on kb_entries
  using hnsw (embedding vector_cosine_ops)
  where embedding is not null;

-- ---------------------------------------------------------------------------
-- Alfred audit trail
-- ---------------------------------------------------------------------------

create table alfred_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null,
  summary text not null,
  payload jsonb not null default '{}'
);

alter table alfred_actions enable row level security;

create policy "alfred_actions_owner" on alfred_actions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index alfred_actions_user_at on alfred_actions (user_id, at desc);

-- ---------------------------------------------------------------------------
-- Storage: private buckets for resumes and knowledge-base captures.
-- Objects live under a per-user folder: <auth.uid()>/<file>.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false), ('captures', 'captures', false)
on conflict do nothing;

create policy "resumes_owner_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "resumes_owner_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "resumes_owner_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "resumes_owner_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "captures_owner_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'captures' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "captures_owner_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'captures' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "captures_owner_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'captures' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'captures' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "captures_owner_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'captures' and (storage.foldername(name))[1] = auth.uid()::text);
