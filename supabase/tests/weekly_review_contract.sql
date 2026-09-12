-- Apply migrations first; run on an isolated database. No synthetic rows persist.
begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('33333333-3333-4333-8333-333333333333','authenticated','authenticated','weekly-contract@example.invalid','{"provider":"google"}','{}',now(),now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}',true);
select public.manor_command('33000000-0000-4000-8000-000000000001','save_profile','{"name":"Weekly contract","timezone":"America/Los_Angeles","settings":{},"expected_revision":0}');
reset role;
-- Populate synthetic dated signals and timestamped history without depending on today's date.
select set_config('manor.command_id','33000000-0000-4000-8000-000000000002',true);
select set_config('manor.operation','weekly_contract_fixture',true);
insert into public.mood_focus_entries(user_id,date,mood) values
('33333333-3333-4333-8333-333333333333','2026-03-01','Great'),
('33333333-3333-4333-8333-333333333333','2026-03-02','Good'),
('33333333-3333-4333-8333-333333333333','2026-03-08','Bad');
insert into public.action_events(user_id,command_id,occurred_at,actor,operation,object_type,object_id,changes) values
('33333333-3333-4333-8333-333333333333',gen_random_uuid(),'2026-03-02 06:00Z','user','update_task','tasks','weekly-source','{"status":{"before":"Not started","after":"Done"}}'),
('33333333-3333-4333-8333-333333333333',gen_random_uuid(),'2026-03-09 05:00Z','user','update_task','tasks','excluded-boundary','{"status":{"before":"Not started","after":"Done"}}');
set local role authenticated;
do $$
declare s jsonb; retry jsonb; saved jsonb; p jsonb; task_count bigint;
begin
 s:=public.manor_weekly_review_input('2026-03-02 06:00Z','2026-03-09 05:00Z');
 if (public.manor_weekly_review_input('2025-10-27 05:00Z','2025-11-03 06:00Z')->>'period_end')::timestamptz-'2025-10-27 05:00Z'::timestamptz<>interval '169 hours' then raise exception 'DST fall window is wrong'; end if;
 if (s->>'period_end')::timestamptz-(s->>'period_start')::timestamptz<>interval '167 hours' then raise exception 'DST spring window is wrong'; end if;
 if jsonb_array_length(s->'daily_records')<>2 or s->'daily_records'->0->>'date'<>'2026-03-02' then raise exception 'Daily records double-count Sunday'; end if;
 if (s->'metrics'->>'completion_event_count')::int<>1 then raise exception 'Completion timestamps do not use half-open membership'; end if;
 begin
  perform public.manor_weekly_review_input('2026-03-02 05:00Z','2026-03-09 05:00Z');
  raise exception 'Wrong start accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.manor_weekly_review_input('2026-03-03 06:00Z','2026-03-10 05:00Z');
  raise exception 'Non-Sunday accepted';
 exception when invalid_parameter_value then null; end;
 p:=jsonb_build_object('id','weekly-contract-review','period_start',s->'period_start','period_end',s->'period_end','timezone',s->'timezone','snapshot_id',s->'snapshot_id','input_watermark',s->'input_watermark','expected_revision',0,'title','Synthetic review','content','One completion event.');
 task_count:=(select count(*) from public.tasks);
 saved:=public.manor_command(gen_random_uuid(),'save_weekly_review',p);
 retry:=public.manor_command(gen_random_uuid(),'save_weekly_review',p);
 if (select count(*) from public.weekly_reviews where id='weekly-contract-review')<>1 or (select revision from public.weekly_reviews where id='weekly-contract-review')<>1 then raise exception 'Save retry duplicated or revised review'; end if;
 if (select count(*) from public.tasks)<>task_count then raise exception 'Review changed tasks'; end if;
 begin
  perform public.manor_command(gen_random_uuid(),'save_weekly_review',p||'{"timezone":"UTC"}');
  raise exception 'Wrong timezone accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.manor_command(gen_random_uuid(),'save_weekly_review',p||'{"content":"Changed","expected_revision":0}');
  raise exception 'Stale revision accepted';
 exception when sqlstate 'PT409' then null; end;
 perform set_config('weekly_test.snapshot',s::text,true);
end $$;
reset role;
update public.mood_focus_entries set mood='Awful',revision=revision+1 where user_id='33333333-3333-4333-8333-333333333333' and date='2026-03-02';
set local role authenticated;
do $$begin
 if public.manor_weekly_review_input('2026-03-02 06:00Z','2026-03-09 05:00Z')<>current_setting('weekly_test.snapshot')::jsonb then raise exception 'Late edits changed durable snapshot'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}',true);
do $$begin
 begin
  perform public.manor_command(gen_random_uuid(),'save_weekly_review',jsonb_build_object('snapshot_id',current_setting('weekly_test.snapshot')::jsonb->'snapshot_id'));
  raise exception 'Foreign source accepted';
 exception when sqlstate 'PT409' then null; end;
end $$;
reset role;
insert into manor_private.purge_tombstones(user_id,object_type,object_id) values('33333333-3333-4333-8333-333333333333','tasks','weekly-source');
do $$begin
 if exists(select 1 from manor_private.weekly_review_snapshots where user_id='33333333-3333-4333-8333-333333333333' and period_start='2026-03-02 06:00Z' and payload is not null) then raise exception 'Purged source survived in snapshot'; end if;
end $$;
rollback;
