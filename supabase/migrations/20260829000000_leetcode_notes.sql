-- LeetCode mistakes notes: quick jots about mistakes and patterns, shown in
-- the Mistakes panel on the LeetCode page. Synced like attempts; ids are
-- client-generated slugs (lc-note-<uuid>).

create table leetcode_notes (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table leetcode_notes enable row level security;

create policy "leetcode_notes_owner" on leetcode_notes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index leetcode_notes_user_created
  on leetcode_notes (user_id, created_at desc);
