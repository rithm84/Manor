-- Run only against isolated staging. Transaction rolls all synthetic data back.
begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('11111111-1111-4111-8111-111111111111','authenticated','authenticated','manor-test-a@example.invalid','{"provider":"google"}','{}',now(),now()),
('22222222-2222-4222-8222-222222222222','authenticated','authenticated','manor-test-b@example.invalid','{"provider":"google"}','{}',now(),now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select public.manor_command('10000000-0000-4000-8000-000000000001','save_profile','{"name":"Synthetic A","timezone":"America/Los_Angeles","settings":{},"expected_revision":0}');
select public.manor_command('10000000-0000-4000-8000-000000000002','create_context','{"id":"ctx-a","name":"Personal","color":"plum","icon":"house","expected_revision":0}');
select public.manor_command('10000000-0000-4000-8000-000000000003','create_task','{"id":"task-a","title":"Synthetic task","context_id":"ctx-a","estimate_minutes":null,"priority":"High","status":"Not started","due":"2026-09-09","tags":[],"expected_revision":0}');
select public.manor_command('10000000-0000-4000-8000-000000000003','create_task','{"id":"task-a","title":"Synthetic task","context_id":"ctx-a","estimate_minutes":null,"priority":"High","status":"Not started","due":"2026-09-09","tags":[],"expected_revision":0}');
select public.manor_command('10000000-0000-4000-8000-000000000004','update_task','{"id":"task-a","status":"Done","expected_revision":1}');
do $$begin
 if (select count(*) from public.tasks)<>1 then raise exception 'Retry duplicated the task'; end if;
 if (select count(*) from public.action_events where object_type='tasks')<>2 then raise exception 'History did not preserve create and completion exactly once'; end if;
 begin
  perform public.manor_command('10000000-0000-4000-8000-000000000005','update_task','{"id":"task-a","title":"stale","expected_revision":1}');
  raise exception 'Stale revision was accepted';
 exception when sqlstate 'PT409' then null; end;
 begin
  update public.tasks set title='bypass' where id='task-a';
  raise exception 'Direct table update was accepted';
 exception when insufficient_privilege then null; end;
end $$;
select public.manor_command('10000000-0000-4000-8000-000000000006','create_note','{"id":"note-a","title":"Synthetic parent","folder_id":null,"parent_page_id":null,"content_json":[{"id":"block-a","type":"paragraph","content":[]}],"expected_revision":0}');
select public.manor_command('10000000-0000-4000-8000-000000000007','create_note','{"id":"note-child","title":"Synthetic child","folder_id":null,"parent_page_id":"note-a","content_json":[],"expected_revision":0}');
select public.manor_command('10000000-0000-4000-8000-000000000008','trash_note','{"id":"note-a","expected_revision":1}');
do $$begin if (select count(*) from public.note_pages where status='trash')<>2 then raise exception 'Descendants did not enter Trash'; end if; end $$;
select public.manor_command('10000000-0000-4000-8000-000000000009','restore_note','{"id":"note-a","expected_revision":2}');
do $$begin if (select count(*) from public.note_pages where status='active')<>2 then raise exception 'Descendants did not restore'; end if; end $$;

select public.manor_command('10000000-0000-4000-8000-000000000020','create_habit','{"id":"habit-a","name":"Read","kind":"binary","target_label":null,"expected_revision":0}');
select public.manor_command('10000000-0000-4000-8000-000000000021','log_habit',jsonb_build_object('id','habit-a','date',(now() at time zone 'America/Los_Angeles')::date,'value',100,'expected_revision',0));
select public.manor_habits_state();
select public.manor_leetcode_summary();
select public.manor_command('10000000-0000-4000-8000-000000000022','commit_debrief',jsonb_build_object('date',(now() at time zone 'America/Los_Angeles')::date,'note','Synthetic synthesis','expected_revision',0));
select public.manor_command('10000000-0000-4000-8000-000000000023','create_recurring_task',jsonb_build_object('id','repeat-a','due',(now() at time zone 'America/Los_Angeles')::date,'recurrence','FREQ=WEEKLY;INTERVAL=1','title','Synthetic repeat','context_id','ctx-a','estimate_minutes',null,'priority','High','tags','[]'::jsonb,'expected_revision',0));
do $$begin
 if (select count(*) from public.tasks where series_id='repeat-a')<12 then raise exception 'Recurrence was not materialized'; end if;
 if (select count(*) from public.habit_entries where habit_id='habit-a')<>1 then raise exception 'Habit log failed'; end if;
end $$;
select public.manor_command('10000000-0000-4000-8000-000000000024','propose_note_edits','{"id":"note-a","expected_revision":3,"suggestion_id":"suggestion-a","block_id":"block-a","before_content_json":{"id":"block-a","type":"paragraph","content":[]},"after_content_json":{"id":"block-a","type":"paragraph","content":[{"type":"text","text":"Synthetic replacement","styles":{}}]},"description":"Synthetic suggestion"}');
select public.manor_command('10000000-0000-4000-8000-000000000025','resolve_note_suggestions','{"id":"note-a","expected_revision":3,"suggestion_ids":["suggestion-a"],"decision":"accepted"}');
do $$begin if not exists(select 1 from public.note_suggestions where status='accepted') then raise exception 'Suggestion acceptance failed'; end if; end $$;


select public.manor_command('10000000-0000-4000-8000-000000000026','edit_note_blocks','{"id":"note-a","expected_revision":4,"edits":[{"kind":"append","block":{"id":"block-new","type":"paragraph","content":[]}}]}');
select public.manor_command('10000000-0000-4000-8000-000000000027','move_note_blocks','{"id":"note-a","expected_revision":5,"target_note_id":"note-child","target_expected_revision":3,"block_ids":["block-new"]}');
do $$begin
 if jsonb_array_length(public.manor_query('query_tasks','{"limit":1}')->'items')<>1 then raise exception 'Task query bound failed'; end if;
 if jsonb_array_length(public.manor_query('search','{"search":"Synthetic","limit":1}')->'items')<>1 then raise exception 'Search bound failed'; end if;
 if not exists(select 1 from public.note_pages where id='note-child' and content_json::text like '%block-new%') then raise exception 'Atomic block move failed'; end if;
end $$;

select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
do $$begin
 if exists(select 1 from public.tasks) or exists(select 1 from public.note_pages) or exists(select 1 from public.action_events) then raise exception 'Account isolation failed'; end if;
 begin
  perform public.manor_command('20000000-0000-4000-8000-000000000001','update_task','{"id":"task-a","title":"foreign","expected_revision":2}');
  raise exception 'Cross-account write was accepted';
 exception when sqlstate 'PT409' then null; end;
end $$;
rollback;
