-- A review freezes its first bounded read. Date-keyed signals belong to the seven
-- calendar labels Monday through Sunday; timestamped history uses [start,end).
grant create on schema manor_private, public to manor_commands;
alter table public.weekly_reviews alter column model drop not null;
alter table public.weekly_reviews add column snapshot_id uuid;
alter table public.weekly_reviews add column provenance jsonb;
create table manor_private.weekly_review_snapshots (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 period_start timestamptz not null, period_end timestamptz not null,
 timezone text not null, input_watermark bigint not null,
 payload jsonb, invalidated_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 unique(user_id,period_start,period_end)
);
alter table manor_private.weekly_review_snapshots enable row level security;
create policy weekly_snapshot_owner on manor_private.weekly_review_snapshots to manor_commands
 using(user_id=auth.uid()) with check(user_id=auth.uid());
grant select,insert,update on manor_private.weekly_review_snapshots to manor_commands;

create or replace function public.manor_weekly_review_input(p_period_start timestamptz,p_period_end timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare tz text; first_day date; last_day date; snap manor_private.weekly_review_snapshots;
 history jsonb; daily jsonb; entries jsonb; habits jsonb; watermark bigint; v_payload jsonb;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Sign in before reading review inputs'; end if;
 if auth.jwt()->>'client_id' is not null and not manor_private.mcp_allowed(false) then raise exception using errcode='42501',message='This agent is not authorized to read review inputs'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select * into snap from manor_private.weekly_review_snapshots where user_id=auth.uid() and period_start=p_period_start and period_end=p_period_end;
 if found then
  if snap.invalidated_at is not null then raise exception using errcode='PT409',message='Review inputs were invalidated by source deletion; this snapshot cannot be reused'; end if;
  return snap.payload;
 end if;
 select timezone into tz from public.profiles where user_id=auth.uid();
 if tz is null or p_period_start is null or p_period_end is null or p_period_end>now()
 or extract(dow from p_period_end at time zone tz)<>0
 or (p_period_end at time zone tz)::time<>'22:00'::time
 or p_period_start<>((p_period_end at time zone tz)-interval '7 days') at time zone tz then
  raise exception using errcode='22023',message='Review period must be a completed Sunday 22:00 to Sunday 22:00 window in the saved account timezone';
 end if;
 first_day:=(p_period_start at time zone tz)::date+1;
 last_day:=(p_period_end at time zone tz)::date;
 select coalesce(max(id),0) into watermark from public.action_events where user_id=auth.uid();
 if (select count(*) from public.action_events where user_id=auth.uid() and occurred_at>=p_period_start and occurred_at<p_period_end and id<=watermark)>10000
 or (select count(*) from public.habits where user_id=auth.uid())>1000
 or (select count(*) from public.habit_entries where user_id=auth.uid() and date between first_day and last_day)>7000 then
  raise exception using errcode='54000',message='Review input exceeds bounded capacity (10000 history events, 1000 habits, or 7000 habit entries)';
 end if;
 select coalesce(jsonb_agg(to_jsonb(e) order by occurred_at,id),'[]') into history from public.action_events e
 where user_id=auth.uid() and occurred_at>=p_period_start and occurred_at<p_period_end and id<=watermark
 and object_type in ('tasks','habits','habit_entries','habit_lifecycle','habit_freeze_intents','mood_focus_entries');
 select coalesce(jsonb_agg(to_jsonb(d) order by date),'[]') into daily from public.mood_focus_entries d where user_id=auth.uid() and date between first_day and last_day;
 select coalesce(jsonb_agg(to_jsonb(e) order by date,habit_id),'[]') into entries from public.habit_entries e where user_id=auth.uid() and date between first_day and last_day;
 select coalesce(jsonb_agg(to_jsonb(h) order by id),'[]') into habits from public.habits h where user_id=auth.uid();
 v_payload:=jsonb_build_object('period_start',p_period_start,'period_end',p_period_end,'timezone',tz,'input_watermark',watermark,
 'daily_membership',jsonb_build_object('first_date',first_day,'last_date',last_day,'semantics','Calendar labels Monday through Sunday, inclusive. Missing dates or ratings are unknown, not zero. The ending Sunday belongs only to this period.'),
 'event_membership','occurred_at >= period_start AND occurred_at < period_end; completion events are transitions into Done, including a task created Done. Repeated completions count as events, distinct task count is separate.',
 'daily_records',daily,'habit_entries',entries,'habits',habits,'history',history,
 'metrics',jsonb_build_object('calendar_days',7,'daily_record_count',jsonb_array_length(daily),
 'mood_count',(select count(*) from jsonb_array_elements(daily) d where d->>'mood' is not null),
 'focus_count',(select count(*) from jsonb_array_elements(daily) d where d->>'focus' is not null),
 'habit_entry_count',jsonb_array_length(entries),
 'completion_event_count',(select count(*) from jsonb_array_elements(history) e where e->>'object_type'='tasks' and e->'changes'->'status'->>'after'='Done' and e->'changes'->'status'->>'before' is distinct from 'Done'),
 'distinct_completed_task_count',(select count(distinct e->>'object_id') from jsonb_array_elements(history) e where e->>'object_type'='tasks' and e->'changes'->'status'->>'after'='Done' and e->'changes'->'status'->>'before' is distinct from 'Done')));
 if octet_length(v_payload::text)>4000000 then raise exception using errcode='54000',message='Review input exceeds the 4 MB snapshot capacity'; end if;
 insert into manor_private.weekly_review_snapshots(user_id,period_start,period_end,timezone,input_watermark,payload)
 values(auth.uid(),p_period_start,p_period_end,tz,watermark,v_payload) returning * into snap;
 v_payload:=v_payload||jsonb_build_object('snapshot_id',snap.id,'snapshot_created_at',snap.created_at,'captured_as_of',snap.created_at,'snapshot_semantics','Records reflect their revisions at first capture, which may be after the scheduled cutoff. Retries preserve this capture; event membership uses the scheduled cutoff.');
 update manor_private.weekly_review_snapshots set payload=v_payload where id=snap.id;
 return v_payload;
end $$;
alter function public.manor_weekly_review_input(timestamptz,timestamptz) owner to manor_commands;
revoke all on function public.manor_weekly_review_input(timestamptz,timestamptz) from public,anon;
grant execute on function public.manor_weekly_review_input(timestamptz,timestamptz) to authenticated;

create function manor_private.weekly_review_command(p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare snap manor_private.weekly_review_snapshots; review public.weekly_reviews; result jsonb;
begin
 select * into snap from manor_private.weekly_review_snapshots where id=(p->>'snapshot_id')::uuid and user_id=auth.uid();
 if not found or snap.invalidated_at is not null then raise exception using errcode='PT409',message='Read a valid owned weekly-review snapshot before saving'; end if;
 if (p->>'period_start')::timestamptz is distinct from snap.period_start or (p->>'period_end')::timestamptz is distinct from snap.period_end
 or p->>'timezone' is distinct from snap.timezone or (p->>'input_watermark')::bigint is distinct from snap.input_watermark then
  raise exception using errcode='22023',message='Review period, timezone, and watermark must exactly match the frozen snapshot';
 end if;
 select * into review from public.weekly_reviews where user_id=auth.uid() and period_start=snap.period_start and period_end=snap.period_end for update;
 -- A repeated generation with the same content is idempotent across command IDs.
 if found and review.snapshot_id=snap.id and review.content=p->>'content' and review.title=p->>'title'
 and review.model is not distinct from p->>'model' and review.provenance is not distinct from p->'provenance' then return to_jsonb(review); end if;
 perform manor_private.require_revision(review.revision,(p->>'expected_revision')::bigint,to_jsonb(review));
 if review.id is null then
  insert into public.weekly_reviews(id,user_id,period_start,period_end,input_watermark,content,model,timezone,title,snapshot_id,provenance)
  values(p->>'id',auth.uid(),snap.period_start,snap.period_end,snap.input_watermark,p->>'content',p->>'model',snap.timezone,p->>'title',snap.id,p->'provenance') returning to_jsonb(weekly_reviews.*) into result;
 else
  update public.weekly_reviews set content=p->>'content',title=p->>'title',model=p->>'model',provenance=p->'provenance',snapshot_id=snap.id,revision=revision+1,updated_at=now()
  where id=review.id and user_id=auth.uid() returning to_jsonb(weekly_reviews.*) into result;
 end if;
 insert into manor_private.review_sources(user_id,review_id,object_type,object_id)
 select auth.uid(),result->>'id','habits',h->>'id' from jsonb_array_elements(snap.payload->'habits') h
 on conflict do nothing;
 return result;
end $$;
alter function manor_private.weekly_review_command(jsonb) owner to manor_commands;
revoke all on function manor_private.weekly_review_command(jsonb) from public;

-- Snapshot payloads are also content-bearing derivatives. Invalidate, do not
-- silently rebuild, when any attributed history source is permanently removed.
create function manor_private.invalidate_weekly_snapshots() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update manor_private.weekly_review_snapshots s set payload=null,invalidated_at=clock_timestamp()
 where user_id=new.user_id and invalidated_at is null and exists (
  select 1 from jsonb_array_elements(s.payload->'history') e where e->>'object_type'=new.object_type and e->>'object_id'=new.object_id)
 or (s.user_id=new.user_id and s.invalidated_at is null and new.object_type='habits' and exists (select 1 from jsonb_array_elements(s.payload->'habits') h where h->>'id'=new.object_id));
 return new;
end $$;
revoke all on function manor_private.invalidate_weekly_snapshots() from public;
create trigger invalidate_review_snapshots after insert on manor_private.purge_tombstones for each row execute function manor_private.invalidate_weekly_snapshots();

revoke create on schema manor_private, public from manor_commands;
