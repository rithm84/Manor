-- Synthetic account integration checks; the caller must install the new dispatch first.
begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('fb3a4c5d-2b62-4438-b9ab-348ea9907829','authenticated','authenticated','workspace-tools@example.invalid','{"provider":"google"}','{}',now(),now()),
 ('8de4266e-a1d9-452e-b8f1-1abc6f9239d4','authenticated','authenticated','workspace-foreign@example.invalid','{"provider":"google"}','{}',now(),now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fb3a4c5d-2b62-4438-b9ab-348ea9907829","role":"authenticated"}',true);
do $$ declare r jsonb; day date; cmd uuid:=gen_random_uuid(); head text; begin
 perform public.manor_command(gen_random_uuid(),'save_profile','{"name":"Workspace","timezone":"America/Los_Angeles","settings":{"preserved":true},"expected_revision":0}');
 r:=public.manor_workspace_query('get_workspace_context','{}');
 day:=(r->>'today')::date;
 if r->>'timezone'<>'America/Los_Angeles' or r->'restrictions'->>'live_browser_context'<>'unavailable' then raise exception 'Workspace context was not saved/explicit'; end if;
 head:=r->>'change_cursor';
 perform public.manor_command(cmd,'update_preferences','{"name":"Renamed","expected_revision":1}');
 perform public.manor_command(cmd,'update_preferences','{"name":"Renamed","expected_revision":1}');
 if (select settings->>'preserved' from public.profiles)<>'true' then raise exception 'Preferences overwrote unrelated settings'; end if;
 r:=public.manor_workspace_query('get_operation_status',jsonb_build_object('command_id',cmd));
 if r->>'status'<>'committed' or r?'response' or r?'record' then raise exception 'Receipt status is incorrect or exposes stored content'; end if;
 r:=public.manor_workspace_query('get_changes_since',jsonb_build_object('cursor',head,'limit',1));
 if jsonb_array_length(r->'items')<>1 or r::text like '%Renamed%' then raise exception 'Change feed is missing or contains profile content'; end if;
 begin
  perform public.manor_command(gen_random_uuid(),'update_preferences','{"settings":{},"expected_revision":2}');
  raise exception 'Unsafe settings were accepted';
 exception when raise_exception then if sqlerrm='Unsafe settings were accepted' then raise; end if; end;
 perform public.manor_command(gen_random_uuid(),'create_habit','{"id":"workspace-habit","name":"Synthetic","kind":"binary","target_label":null,"expected_revision":0}');
 perform public.manor_command(gen_random_uuid(),'log_habit',jsonb_build_object('id','workspace-habit','date',day,'value',100,'expected_revision',0));
 r:=public.manor_workspace_query('get_metrics',jsonb_build_object('from',day-1,'to',day+1,'group_by','day'));
 if (r->>'habit_eligible_days')::int<>1 or (r->>'habits_completed')::int<>1 or (r->>'observed_days')::int<>2 or (r->>'mood_missing')::int<>2 then raise exception 'Metrics counted pre-creation/future days or lost missingness: %',r; end if;
 r:=public.manor_workspace_query('query_habit_history',jsonb_build_object('from',day-1,'to',day+1,'limit',1));
 if jsonb_array_length(r->'items')<>1 or (r->'items'->0->>'entry_revision')::int<>1 then raise exception 'Habit history lost entry revisions'; end if;
 perform public.manor_command(gen_random_uuid(),'commit_debrief',jsonb_build_object('date',day,'focus','Resting','expected_revision',0));
 r:=public.manor_workspace_query('get_metrics',jsonb_build_object('from',day,'to',day,'group_by','total'));
 if (r->>'focus_samples')::int<>1 or (r->>'focus_missing')::int<>0 or r->'focus_distribution'->>'Resting'<>'1' then raise exception 'Resting was treated as missing'; end if;
 perform public.manor_command(gen_random_uuid(),'save_task_view','{"id":"workspace-view","name":"Saved","rules":[],"expected_revision":0}');
 head:=public.manor_workspace_query('get_workspace_context','{}')->>'change_cursor';
 perform public.manor_command(gen_random_uuid(),'delete_task_view','{"id":"workspace-view","expected_revision":1}');
 r:=public.manor_workspace_query('get_changes_since',jsonb_build_object('cursor',head));
 if r->'items'->0->>'change'<>'delete' then raise exception 'Physical deletion was not in the change feed'; end if;
 begin
  perform public.manor_workspace_query('get_metrics',jsonb_build_object('from',day-366,'to',day,'group_by','total'));
  raise exception 'Unbounded metric range accepted';
 exception when raise_exception then if sqlerrm='Unbounded metric range accepted' then raise; end if; end;
end $$;
reset role;
insert into public.calendar_accounts(user_id,id,email) values('fb3a4c5d-2b62-4438-b9ab-348ea9907829','synthetic','calendar@example.invalid');
insert into public.calendars(user_id,account_id,id,name,enabled) values
 ('fb3a4c5d-2b62-4438-b9ab-348ea9907829','synthetic','visible','Visible',true),
 ('fb3a4c5d-2b62-4438-b9ab-348ea9907829','synthetic','hidden','Hidden',false);
insert into public.calendar_events(user_id,account_id,calendar_id,id,title,start_date,end_date,all_day) values
 ('fb3a4c5d-2b62-4438-b9ab-348ea9907829','synthetic','visible','event','Synthetic event','2026-03-07','2026-03-10',true),
 ('fb3a4c5d-2b62-4438-b9ab-348ea9907829','synthetic','hidden','hidden-event','Hidden content','2026-03-08','2026-03-09',true);
insert into manor_private.integration_credentials(user_id,provider,account_id,access_token,refresh_token,expires_at,username) values
 ('fb3a4c5d-2b62-4438-b9ab-348ea9907829','google','synthetic','synthetic-secret','synthetic-refresh',now()+interval '1 hour','calendar@example.invalid');
insert into manor_private.integration_jobs(user_id,provider,account_id,last_error) values
 ('fb3a4c5d-2b62-4438-b9ab-348ea9907829','google','synthetic','Private provider error');
insert into manor_private.purge_tombstones(user_id,object_type,object_id) values('fb3a4c5d-2b62-4438-b9ab-348ea9907829','note_pages','synthetic-purged-note');
set local role authenticated;
do $$ declare r jsonb; begin
 r:=public.manor_workspace_query('get_changes_since','{"cursor":"0","limit":200}');
 if not exists(select 1 from jsonb_array_elements(r->'items') e where e->>'change'='purge' and e->'object_key'->>'object_id'='synthetic-purged-note') then raise exception 'Purge tombstone is missing from reconciliation'; end if;
 r:=public.manor_workspace_query('query_calendar_events','{"from":"2026-03-08","to":"2026-03-08"}');
 if jsonb_array_length(r->'items')<>1 or r::text like '%Hidden content%' then raise exception 'Calendar overlap/visibility was incorrect'; end if;
 r:=public.manor_workspace_query('get_background_run','{"provider":"google","account_id":"synthetic"}');
 if not (r->>'retry_eligible')::boolean or r::text like '%Private provider%' then raise exception 'Job status is unsafe or retry eligibility incorrect'; end if;
 r:=public.manor_workspace_query('get_integration_status','{}');
 if r::text like '%secret%' or r::text like '%refresh%' then raise exception 'Integration status leaked credentials'; end if;
 perform public.manor_command(gen_random_uuid(),'retry_background_run','{"provider":"google","account_id":"synthetic"}');
 begin
  perform public.manor_command(gen_random_uuid(),'retry_background_run','{"provider":"google","account_id":"synthetic"}');
  raise exception 'Healthy job accepted retry';
 exception when sqlstate '55000' then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"8de4266e-a1d9-452e-b8f1-1abc6f9239d4","role":"authenticated"}',true);
do $$ declare r jsonb; begin
 r:=public.manor_workspace_query('get_changes_since','{"cursor":"0"}');
 if jsonb_array_length(r->'items')<>0 then raise exception 'Another account saw the change feed'; end if;
 if jsonb_array_length(public.manor_workspace_query('get_integration_status','{}')->'items')<>0 then raise exception 'Another account saw integrations'; end if;
 begin
  perform public.manor_workspace_query('get_background_run','{"provider":"google","account_id":"synthetic"}');
  raise exception 'Another account saw a background job';
 exception when sqlstate 'P0002' then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"fb3a4c5d-2b62-4438-b9ab-348ea9907829","role":"authenticated","client_id":"87aa8e23-5d76-4279-91db-a8c5847e75ce"}',true);
do $$ begin
 begin
  perform public.manor_workspace_query('get_preferences','{}');
  raise exception 'Unapproved OAuth client accessed preferences';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into manor_private.mcp_authorizations(user_id,client_id,can_write,revoked_at) values
 ('fb3a4c5d-2b62-4438-b9ab-348ea9907829','87aa8e23-5d76-4279-91db-a8c5847e75ce',true,now());
set local role authenticated;
do $$ begin
 begin
  perform public.manor_workspace_query('get_changes_since','{"cursor":"0"}');
  raise exception 'Revoked OAuth client accessed changes';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
