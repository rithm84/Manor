-- Apply migrations first; run on an isolated database. The transaction rolls all synthetic data back.
begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('55555555-5555-4555-8555-555555555555','authenticated','authenticated','daily-ratings@example.invalid','{"provider":"google"}','{}',now(),now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}',true);
select public.manor_command(gen_random_uuid(),'save_profile','{"name":"Daily ratings","timezone":"America/Los_Angeles","settings":{},"expected_revision":0}');
do $$
declare today date:=(now() at time zone 'America/Los_Angeles')::date; r jsonb;
begin
 r:=public.manor_command(gen_random_uuid(),'log_daily_ratings',jsonb_build_object('date',today,'mood','Good','expected_revision',0))->'record';
 if r->>'mood'<>'Good' or r->>'focus' is not null or (r->>'revision')::int<>1 or r ?| array['note','note_source'] then raise exception 'Today''s mood did not save as a ratings-only record: %',r; end if;
 r:=public.manor_command(gen_random_uuid(),'log_daily_ratings',jsonb_build_object('date',today,'focus','Locked In','expected_revision',1))->'record';
 if r->>'mood'<>'Good' or r->>'focus'<>'Locked In' or (r->>'revision')::int<>2 then raise exception 'An omitted rating was not preserved: %',r; end if;
 r:=public.manor_command(gen_random_uuid(),'log_daily_ratings',jsonb_build_object('date',today-1,'mood','Bad','focus','Resting','expected_revision',0))->'record';
 if r->>'mood'<>'Bad' or r->>'focus'<>'Resting' then raise exception 'Yesterday''s ratings did not save: %',r; end if;
 begin
  perform public.manor_command(gen_random_uuid(),'log_daily_ratings',jsonb_build_object('date',today-2,'mood','Good','expected_revision',0));
  raise exception 'Quick capture accepted a date before yesterday';
 exception when raise_exception then if sqlerrm not like 'Daily ratings can only be logged%' then raise; end if; end;
 begin
  perform public.manor_command(gen_random_uuid(),'log_daily_ratings',jsonb_build_object('date',today,'mood',null,'focus',null,'expected_revision',2));
  raise exception 'A day was left without ratings';
 exception when raise_exception then if sqlerrm<>'Choose a mood or focus rating' then raise; end if; end;
 begin
  perform public.manor_command(gen_random_uuid(),'log_daily_ratings',jsonb_build_object('date',today,'mood','Fine','expected_revision',2));
  raise exception 'An unknown mood was accepted';
 exception when raise_exception then if sqlerrm<>'Unknown mood rating' then raise; end if; end;
 r:=public.manor_command(gen_random_uuid(),'correct_mood_focus_history',jsonb_build_object('date',today-5,'mood','Neutral','focus',null,'expected_revision',0))->'record';
 if r->>'mood'<>'Neutral' or r ?| array['note','note_source'] then raise exception 'History correction failed: %',r; end if;
 foreach r in array array['"commit_debrief"'::jsonb,'"update_daily_synthesis"'::jsonb] loop
  begin
   perform public.manor_command(gen_random_uuid(),r#>>'{}',jsonb_build_object('date',today,'note','removed','expected_revision',2));
   raise exception 'Removed operation % still runs',r;
  exception when sqlstate '22023' then if sqlerrm<>'Unsupported Manor operation: '||(r#>>'{}') then raise; end if; end;
 end loop;
 if exists(select 1 from public.action_events where object_type='mood_focus_entries' and changes ?| array['note','note_source']) then raise exception 'History recorded synthesis fields'; end if;
end $$;
rollback;
