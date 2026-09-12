-- Search sources are restricted to Notes and knowledge captures. Journal is never indexed.
create table manor_private.embedding_jobs (
 user_id uuid not null references auth.users(id) on delete cascade, source text not null check(source in ('note','kb')),
 source_id text not null, revision bigint not null, next_chunk integer not null default 0,next_offset integer not null default 0,
 run_after timestamptz not null default now(), leased_until timestamptz, attempts integer not null default 0, error text,
 primary key(user_id,source,source_id)
);
create table manor_private.search_chunks (
 user_id uuid not null references auth.users(id) on delete cascade, source text not null check(source in ('note','kb')),
 source_id text not null, revision bigint not null, chunk_index integer not null, content text not null,
 content_hash text not null, model text not null, embedding public.vector(1536) not null,
 primary key(user_id,source,source_id,revision,chunk_index)
);
create table manor_private.embedding_usage (
 id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,
 source text not null check(source in ('note','kb','query')),source_id text,revision bigint,
 model text not null,total_tokens integer not null check(total_tokens>=0),created_at timestamptz not null default now()
);
alter table manor_private.embedding_usage enable row level security;
revoke all on manor_private.embedding_usage from public,anon,authenticated;
create index search_chunks_vector on manor_private.search_chunks using hnsw(embedding public.vector_cosine_ops);
alter table manor_private.embedding_jobs enable row level security;
create policy embedding_job_owner on manor_private.embedding_jobs to manor_commands using(user_id=auth.uid()) with check(user_id=auth.uid());
alter table manor_private.search_chunks enable row level security;
revoke all on manor_private.embedding_jobs,manor_private.search_chunks from public,anon,authenticated;

create function manor_private.search_source(owner_id uuid,kind text,rid text) returns jsonb language sql stable set search_path='' as $$
 select case when kind='note' then (select jsonb_build_object('revision',revision,'title',title,'content',title||E'\n'||content_json::text) from public.note_pages where user_id=owner_id and id=rid and status<>'trash')
 when kind='kb' then (select jsonb_build_object('revision',revision,'title',coalesce(title,''),'content',concat_ws(E'\n',title,author,summary,content_md,url)) from public.kb_entries where user_id=owner_id and id::text=rid and to_jsonb(kb_entries)->>'deleted_at' is null) end
$$;
revoke all on function manor_private.search_source(uuid,text,text) from public,anon,authenticated;

create function manor_private.enqueue_search() returns trigger language plpgsql security definer set search_path='' as $$
declare kind text:=case when tg_table_name='note_pages' then 'note' else 'kb' end; row_data jsonb; rid text; owner_id uuid;
begin
 row_data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end; rid:=row_data->>'id'; owner_id:=(row_data->>'user_id')::uuid;
 if tg_op='DELETE' or row_data->>'status'='trash' or row_data->>'deleted_at' is not null then
  delete from manor_private.embedding_jobs where user_id=owner_id and source=kind and source_id=rid;
  delete from manor_private.search_chunks where user_id=owner_id and source=kind and source_id=rid;
 else
  if tg_op='UPDATE' then
   if new.revision=old.revision then return new; end if;
   if to_jsonb(old)->>'deleted_at' is null and coalesce(to_jsonb(old)->>'status','')<>'trash' and ((kind='note' and jsonb_build_array(to_jsonb(new)->'title',to_jsonb(new)->'content_json')=jsonb_build_array(to_jsonb(old)->'title',to_jsonb(old)->'content_json'))
    or (kind='kb' and jsonb_build_array(to_jsonb(new)->'title',to_jsonb(new)->'author',to_jsonb(new)->'summary',to_jsonb(new)->'content_md',to_jsonb(new)->'url')=jsonb_build_array(to_jsonb(old)->'title',to_jsonb(old)->'author',to_jsonb(old)->'summary',to_jsonb(old)->'content_md',to_jsonb(old)->'url'))) then
    update manor_private.search_chunks set revision=new.revision where user_id=owner_id and source=kind and source_id=rid and revision=old.revision;
    update manor_private.embedding_jobs set revision=new.revision,leased_until=null where user_id=owner_id and source=kind and source_id=rid;
    return new;
   end if;
  end if;
  insert into manor_private.embedding_jobs(user_id,source,source_id,revision) values(owner_id,kind,rid,(row_data->>'revision')::bigint)
  on conflict(user_id,source,source_id) do update set revision=excluded.revision,next_chunk=0,next_offset=0,run_after=now(),leased_until=null,attempts=0,error=null;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function manor_private.enqueue_search() from public,anon,authenticated;
create trigger note_search_queue after insert or update or delete on public.note_pages for each row execute function manor_private.enqueue_search();
create trigger kb_search_queue after insert or update or delete on public.kb_entries for each row execute function manor_private.enqueue_search();
insert into manor_private.embedding_jobs(user_id,source,source_id,revision) select user_id,'note',id,revision from public.note_pages where status<>'trash';
insert into manor_private.embedding_jobs(user_id,source,source_id,revision) select user_id,'kb',id::text,revision from public.kb_entries;

create function manor_private.queue_embedding(p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare row_data public.kb_entries;
begin
 select * into row_data from public.kb_entries where user_id=auth.uid() and id=(p->>'id')::uuid and to_jsonb(kb_entries)->>'deleted_at' is null for update;
 if not found then raise exception 'Capture was not found'; end if;
 perform manor_private.require_revision(row_data.revision,(p->>'expected_revision')::bigint,to_jsonb(row_data));
 insert into manor_private.embedding_jobs(user_id,source,source_id,revision) values(auth.uid(),'kb',row_data.id::text,row_data.revision)
 on conflict(user_id,source,source_id) do update set next_chunk=0,next_offset=0,run_after=now(),leased_until=null,error=null,attempts=0;
 return jsonb_build_object('id',row_data.id,'revision',row_data.revision,'queued',true);
end $$;
grant create on schema manor_private to manor_commands;
alter function manor_private.queue_embedding(jsonb) owner to manor_commands;
revoke create on schema manor_private from manor_commands;
grant select,insert,update on manor_private.embedding_jobs to manor_commands;
revoke all on function manor_private.queue_embedding(jsonb) from public;
grant execute on function manor_private.queue_embedding(jsonb) to manor_commands;

create function public.manor_embedding_work(action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare job manor_private.embedding_jobs; source_row jsonb; chunk jsonb;
begin
 if action='usage' then
  insert into manor_private.embedding_usage(id,user_id,source,source_id,revision,model,total_tokens) values((p->>'id')::uuid,(p->>'user_id')::uuid,p->>'source',p->>'source_id',(p->>'revision')::bigint,'text-embedding-3-small:1536:v1',(p->>'total_tokens')::integer) on conflict(id) do nothing;
  return jsonb_build_object('recorded',true);
 end if;
 if action='claim' then
  select * into job from manor_private.embedding_jobs where run_after<=now() and (leased_until is null or leased_until<now()) order by run_after limit 1 for update skip locked;
  if not found then return 'null'; end if;
  update manor_private.embedding_jobs set leased_until=now()+interval '2 minutes',attempts=attempts+1 where user_id=job.user_id and source=job.source and source_id=job.source_id;
  source_row:=manor_private.search_source(job.user_id,job.source,job.source_id);
  if source_row is null or (source_row->>'revision')::bigint<>job.revision then
   delete from manor_private.embedding_jobs where user_id=job.user_id and source=job.source and source_id=job.source_id;
   return 'null';
  end if;
  return to_jsonb(job)||jsonb_build_object('content',source_row->>'content');
 end if;
 select * into job from manor_private.embedding_jobs where user_id=(p->>'user_id')::uuid and source=p->>'source' and source_id=p->>'source_id' for update;
 if not found or job.revision<>(p->>'revision')::bigint then return jsonb_build_object('stale',true); end if;
 source_row:=manor_private.search_source(job.user_id,job.source,job.source_id);
 if source_row is null or (source_row->>'revision')::bigint<>job.revision then return jsonb_build_object('stale',true); end if;
 if action='commit' then
  for chunk in select value from jsonb_array_elements(p->'chunks') loop
   insert into manor_private.search_chunks(user_id,source,source_id,revision,chunk_index,content,content_hash,model,embedding)
   values(job.user_id,job.source,job.source_id,job.revision,(chunk->>'index')::integer,chunk->>'content',encode(sha256(convert_to(chunk->>'content','UTF8')),'hex'),'text-embedding-3-small:1536:v1',(chunk->>'embedding')::public.vector)
   on conflict(user_id,source,source_id,revision,chunk_index) do update set content=excluded.content,content_hash=excluded.content_hash,model=excluded.model,embedding=excluded.embedding;
  end loop;
  if (p->>'complete')::boolean then
   delete from manor_private.search_chunks where user_id=job.user_id and source=job.source and source_id=job.source_id and revision<>job.revision;
   delete from manor_private.embedding_jobs where user_id=job.user_id and source=job.source and source_id=job.source_id;
  else update manor_private.embedding_jobs set next_chunk=(p->>'next_chunk')::integer,next_offset=(p->>'next_offset')::integer,leased_until=null,run_after=now(),attempts=0,error=null where user_id=job.user_id and source=job.source and source_id=job.source_id; end if;
 elsif action='fail' then
  update manor_private.embedding_jobs set leased_until=null,run_after=now()+least(interval '2 hours',interval '30 seconds'*power(2,least(attempts,8))),error=p->>'error' where user_id=job.user_id and source=job.source and source_id=job.source_id;
 else raise exception 'Unsupported embedding operation'; end if;
 return jsonb_build_object('committed',true);
end $$;
revoke all on function public.manor_embedding_work(text,jsonb) from public,anon,authenticated;
grant execute on function public.manor_embedding_work(text,jsonb) to service_role;

create function public.manor_semantic_search(query_vector public.vector(1536),result_limit integer,source_modules text[]) returns jsonb language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (
 select c.source,c.source_id,c.revision,c.chunk_index,c.content,1-(c.embedding OPERATOR(public.<=>) query_vector) as similarity
 from manor_private.search_chunks c
 where c.user_id=auth.uid() and (auth.jwt()->>'client_id' is null or manor_private.mcp_allowed(false)) and c.source=any(source_modules) and c.model='text-embedding-3-small:1536:v1'
 and (manor_private.search_source(c.user_id,c.source,c.source_id)->>'revision')::bigint=c.revision
 order by c.embedding OPERATOR(public.<=>) query_vector limit greatest(1,least(result_limit,30))
 ) r
$$;
revoke all on function public.manor_semantic_search(public.vector,integer,text[]) from public,anon;
grant execute on function public.manor_semantic_search(public.vector,integer,text[]) to authenticated;
select cron.schedule('manor-embeddings','* * * * *',$job$
 select net.http_post(url:=(select decrypted_secret from vault.decrypted_secrets where name='embedding_worker_url'),headers:=jsonb_build_object('x-manor-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='manor_worker_secret'),'Content-Type','application/json'),body:='{}'::jsonb) where exists(select 1 from vault.decrypted_secrets where name='embedding_worker_url');
$job$);
