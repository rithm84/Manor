grant create on schema manor_private to manor_commands;
create table manor_private.review_sources (
 user_id uuid not null,review_id text not null references public.weekly_reviews(id) on delete cascade,
 object_type text not null,object_id text not null,primary key(user_id,review_id,object_type,object_id)
);
alter table manor_private.review_sources enable row level security;
create policy review_sources_owner on manor_private.review_sources to manor_commands using(user_id=auth.uid()) with check(user_id=auth.uid());
grant select,insert,delete on manor_private.review_sources to manor_commands;
create function manor_private.capture_review_sources() returns trigger language plpgsql set search_path='' as $$
begin
 delete from manor_private.review_sources where user_id=new.user_id and review_id=new.id;
 insert into manor_private.review_sources(user_id,review_id,object_type,object_id)
 select distinct new.user_id,new.id,object_type,object_id from public.action_events where user_id=new.user_id and occurred_at>=new.period_start and occurred_at<new.period_end and id<=new.input_watermark and object_id is not null and object_type in ('tasks','habits','habit_entries','habit_lifecycle','habit_freeze_intents','mood_focus_entries') on conflict do nothing;
 return new;
end $$;
alter function manor_private.capture_review_sources() owner to manor_commands;
revoke all on function manor_private.capture_review_sources() from public;
create trigger record_review_sources after insert or update on public.weekly_reviews for each row execute function manor_private.capture_review_sources();

create function public.manor_run_maintenance() returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_row record; series_row record; count_series int:=0; count_scratch int; count_purged int; previous_claims text:=current_setting('request.jwt.claims',true);
begin
 perform set_config('manor.actor','background',true);
 for owner_row in select p.user_id from public.profiles p where p.timezone is not null and exists(select 1 from public.task_series s where s.user_id=p.user_id and s.ends_before is null and (s.materialized_through is null or s.materialized_through<(now() at time zone p.timezone)::date+30)) order by p.user_id limit 500 loop
  perform pg_advisory_xact_lock(hashtextextended(owner_row.user_id::text,0));
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_row.user_id,'role','service_role')::text,true);
  perform set_config('manor.command_id',gen_random_uuid()::text,true);
  perform set_config('manor.operation','materialize_task_occurrences',true);
  for series_row in select id from public.task_series where user_id=owner_row.user_id and ends_before is null and (materialized_through is null or materialized_through<manor_private.today()+30) loop
   perform manor_private.materialize_series(series_row.id);
   count_series:=count_series+1;
  end loop;
 end loop;
 perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
 perform set_config('manor.command_id',gen_random_uuid()::text,true);
 perform set_config('manor.operation','expire_scratch_blocks',true);
 delete from public.scratch_blocks where expires_at<=now();
 get diagnostics count_scratch=row_count;
 update public.file_objects set status='purging',name='Unfinished upload' where status='allocated' and created_at<=now()-interval '24 hours';
 count_purged:=public.manor_purge_expired();
 return jsonb_build_object('materialized_series',count_series,'expired_scratch_blocks',count_scratch,'purged_records',count_purged);
end $$;
revoke all on function public.manor_run_maintenance() from public,anon,authenticated;
grant execute on function public.manor_run_maintenance() to service_role;

-- Hardening retained semantic-search functions without removing legacy data.
alter function public.match_kb_entries(public.vector,integer) set search_path=public,extensions;
alter function public.match_alfred_memories(public.vector,integer) set search_path=public,extensions;
revoke all on function public.match_alfred_memories(public.vector,integer) from public,anon,authenticated;
