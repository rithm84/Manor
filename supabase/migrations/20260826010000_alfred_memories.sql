-- Alfred shared memory: durable facts and session summaries with embeddings,
-- plus cosine-distance match functions for semantic retrieval. The match
-- functions run as the caller (security invoker) so RLS scopes every result
-- to the requesting user's rows.

create table alfred_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('fact', 'session_summary')),
  content text not null,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

alter table alfred_memories enable row level security;

create policy "alfred_memories_owner" on alfred_memories
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index alfred_memories_user_created on alfred_memories (user_id, created_at desc);
create index alfred_memories_embedding on alfred_memories
  using hnsw (embedding vector_cosine_ops)
  where embedding is not null;

create function match_kb_entries(query_embedding vector(1536), match_count int)
returns table (
  id uuid,
  title text,
  summary text,
  content_md text,
  url text,
  similarity double precision
)
language sql
security invoker
stable
as $$
  select
    kb.id,
    kb.title,
    kb.summary,
    kb.content_md,
    kb.url,
    1 - (kb.embedding <=> query_embedding) as similarity
  from kb_entries kb
  where kb.embedding is not null
  order by kb.embedding <=> query_embedding
  limit greatest(match_count, 0)
$$;

create function match_alfred_memories(query_embedding vector(1536), match_count int)
returns table (
  id uuid,
  kind text,
  content text,
  created_at timestamptz,
  similarity double precision
)
language sql
security invoker
stable
as $$
  select
    m.id,
    m.kind,
    m.content,
    m.created_at,
    1 - (m.embedding <=> query_embedding) as similarity
  from alfred_memories m
  where m.embedding is not null
  order by m.embedding <=> query_embedding
  limit greatest(match_count, 0)
$$;

revoke execute on function match_kb_entries(vector, int) from anon;
revoke execute on function match_alfred_memories(vector, int) from anon;
grant execute on function match_kb_entries(vector, int) to authenticated;
grant execute on function match_alfred_memories(vector, int) to authenticated;
