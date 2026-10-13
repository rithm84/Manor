-- Real transactional integration checks. All test accounts and content are rolled back.
begin;
insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('18a02205-8ef3-4a25-bc06-e0758db0755b','authenticated','authenticated','problem-library@example.invalid',now(),now()),
 ('5b8acd23-9db3-487f-b20a-315d08d2a947','authenticated','authenticated','problem-other@example.invalid',now(),now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"18a02205-8ef3-4a25-bc06-e0758db0755b","role":"authenticated"}',true);
do $test$
declare problem jsonb; saved jsonb; receipt jsonb; detail jsonb; candidate jsonb; checker_case jsonb; command_id uuid:=gen_random_uuid(); rejected boolean:=false;
begin
 perform public.manor_command(gen_random_uuid(),'save_profile','{"name":"Problem test","timezone":"America/Los_Angeles","settings":{},"expected_revision":0}');
 if exists(select 1 from public.leetcode_problems where source_type='stock' and source_url is null) or (select source_url from public.leetcode_problems where id='neetcode-1-1')<>'https://leetcode.com/problems/contains-duplicate/' then raise exception 'Stock problem source links were not initialized'; end if;
 select to_jsonb(p.*) into saved from public.leetcode_problems p where id='neetcode-1-1';
 perform public.manor_command(gen_random_uuid(),'save_problem',saved||jsonb_build_object('expected_revision',saved->'revision','topics','["Updated general topic"]'::jsonb,'content','null'::jsonb));
 if exists(select 1 from public.leetcode_problems p where id='neetcode-1-1' and (p.topic<>saved->>'topic' or p.curriculum_order<>(saved->>'curriculum_order')::integer or p.topics<>array['Updated general topic'])) then raise exception 'General metadata updates rewrote seeded legacy fields'; end if;
 problem:='{"id":"library-example","expected_revision":0,"name":"Sum values","difficulty":"Easy","kind":"coding","topics":["Arrays"],"companies":["Example"],"tags":["Imported"],"collections":["Practice"],"source_url":"https://example.invalid/problem","source_type":"imported","external_key":"example/sum","content":{"statement_markdown":"Read two integers and print their sum.","examples":[{"input":"1 2","output":"3","explanation":null}],"hints":["Add both values."],"solution_markdown":"Add the inputs.","starter_code":{"python":"print(sum(map(int, input().split())))"}}}';
 receipt:=public.manor_command(command_id,'import_problems',jsonb_build_object('items',jsonb_build_array(problem)));
 if receipt->'record'->'items'->0->>'outcome'<>'created' then raise exception 'Import did not create a problem'; end if;
 receipt:=public.manor_command(command_id,'import_problems',jsonb_build_object('items',jsonb_build_array(problem)));
 if receipt->>'replayed'<>'true' then raise exception 'Import retry was not replayed'; end if;
 receipt:=public.manor_command(gen_random_uuid(),'import_problems',jsonb_build_object('items',jsonb_build_array(problem||'{"id":"duplicate-source"}')));
 if receipt->'record'->'items'->0->>'outcome'<>'unchanged' or (select count(*) from public.leetcode_problems where external_key='example/sum')<>1 then raise exception 'External key did not deduplicate an unchanged source'; end if;
 detail:=public.manor_problem_query('read_problem','{"id":"library-example"}');
 if detail->'content'->>'statement_markdown'<>problem->'content'->>'statement_markdown' or detail->'problem'->>'content_version'<>'1' then raise exception 'Problem detail lost the versioned statement'; end if;
 if detail->>'can_execute'<>'false' or detail->>'grading_available'<>'false' then raise exception 'Imported content without a testset advertised executable grading'; end if;
 perform public.manor_command(gen_random_uuid(),'save_problem',problem||'{"id":"custom-stdin","external_key":"example/custom-stdin","source_type":"custom","companies":[]}');
 detail:=public.manor_problem_query('read_problem','{"id":"custom-stdin"}');
 if detail->>'can_execute'<>'true' or detail->>'grading_available'<>'false' then raise exception 'Custom input execution was confused with automatic grading'; end if;
 problem:=jsonb_set(problem,'{expected_revision}','1');
 problem:=jsonb_set(problem,'{content,statement_markdown}','"Read two integers, then print their sum followed by a newline."');
 saved:=public.manor_command(gen_random_uuid(),'save_problem',problem);
 if saved->'record'->>'content_version'<>'2' or (select count(*) from public.problem_content_versions where problem_id='library-example')<>2 then raise exception 'Statement edit did not retain an immutable version'; end if;
 begin
  perform public.manor_command(gen_random_uuid(),'save_problem',problem);
  raise exception 'Stale problem edit was accepted';
 exception when sqlstate 'PT409' then null; end;
 problem:=jsonb_set(problem,'{expected_revision}','2')||'{"testset":{"checker":"trimmed","provenance":"generated","cases":[{"id":"example","input":"1 2","expectedOutput":"3","hidden":false},{"id":"hidden-case","input":"210 17","expectedOutput":"227","hidden":true}]}}';
 saved:=public.manor_command(gen_random_uuid(),'save_problem',problem);
 if saved->'record'->'testset'->>'count'<>'2' or saved->'record'->>'content_version'<>'2' then raise exception 'Private testset import did not preserve the statement version'; end if;
 if saved->'record'->'testset'->>'testsetVersion'<>'1' then raise exception 'The first testset was not version 1'; end if;
 saved:=public.manor_command(gen_random_uuid(),'save_problem',jsonb_set(problem,'{expected_revision}',saved->'record'->'revision'));
 if saved->'record'->'testset'->>'testsetVersion'<>'1' or saved->'record'->'testset'->>'unchanged'<>'true' then raise exception 'An identical testset was stored as a new version'; end if;
 saved:=public.manor_command(gen_random_uuid(),'save_problem',jsonb_set(jsonb_set(problem,'{expected_revision}',saved->'record'->'revision'),'{testset,cases,1}','{"id":"hidden-case","input":"210 18","expectedOutput":"228","hidden":true}'));
 if saved->'record'->'testset'->>'testsetVersion'<>'2' or saved->'record'->'testset' ? 'unchanged' then raise exception 'A changed testset did not create a new version'; end if;
 detail:=public.manor_problem_query('read_problem','{"id":"library-example"}');
 if detail->>'can_execute'<>'true' or detail->>'grading_available'<>'true' then raise exception 'Verified current-version testset was not executable'; end if;
 if public.manor_problem_query('read_problem','{"id":"library-example"}')::text like '%hidden-case%' then raise exception 'Problem content leaked hidden test cases'; end if;
 for checker_case in select value from jsonb_array_elements('[{"checker":"numeric","answer":"0.25 -1e3","valid":true},{"checker":"numeric","answer":"","valid":false},{"checker":"numeric","answer":"NaN","valid":false},{"checker":"numeric","answer":"1e999","valid":false},{"checker":"json_unordered","answer":"[1,1,[2,3]]","valid":true},{"checker":"json_unordered","answer":"{}","valid":false},{"checker":"json","answer":"not-json","valid":false}]') loop
  candidate:=problem||jsonb_build_object('id','checker-mode-example','external_key','example/checker-modes','companies','[]'::jsonb,'expected_revision',coalesce((select revision from public.leetcode_problems where id='checker-mode-example'),0),'testset',jsonb_build_object('checker',checker_case->>'checker','provenance','generated','cases',jsonb_build_array(jsonb_build_object('id','checker-case','input','0','expectedOutput',checker_case->>'answer','hidden',true))));
  rejected:=false;
  begin
   perform public.manor_command(gen_random_uuid(),'save_problem',candidate);
  exception when raise_exception or invalid_text_representation or numeric_value_out_of_range then
   rejected:=true;
  end;
  if rejected=(checker_case->>'valid')::boolean then raise exception 'Checker validation disagreed with expected validity: %',checker_case; end if;
 end loop;
 rejected:=false;
 begin
  perform cases from manor_private.problem_testsets limit 1;
  raise exception 'Authenticated clients can read private testsets';
 exception when insufficient_privilege then null; end;
 saved:=public.manor_command(gen_random_uuid(),'save_problem_draft','{"id":"draft-example","expected_revision":0,"problem_id":"library-example","language":"python","content_version":2,"source":"# exact whitespace\nprint(3)\n"}');
 if saved->'record'->>'source'<>E'# exact whitespace\nprint(3)\n' then raise exception 'Code draft source was changed'; end if;
 saved:=public.manor_command(gen_random_uuid(),'save_problem_draft',jsonb_build_object('id','draft-example','expected_revision',1,'problem_id','library-example','language','python','content_version',2,'source',repeat('é',131072)));
 if octet_length(saved->'record'->>'source')<>262144 then raise exception 'The 256 KiB UTF-8 draft boundary did not round-trip'; end if;
 begin
  perform public.manor_command(gen_random_uuid(),'save_problem_draft',jsonb_build_object('id','draft-example','expected_revision',2,'problem_id','library-example','language','python','content_version',2,'source',repeat('é',131073)));
 exception when raise_exception then
  if sqlerrm not like 'Code draft requires%' then raise; end if;
  rejected:=true;
 end;
 if not rejected then raise exception 'Oversized multibyte draft was accepted'; end if;
 if exists(select 1 from public.action_events where object_type='problem_code_drafts') then raise exception 'Code autosave wrote action history'; end if;
 begin
  perform public.manor_command(gen_random_uuid(),'save_problem_draft','{"id":"draft-example","expected_revision":1,"problem_id":"library-example","language":"python","content_version":1,"source":"old"}');
  raise exception 'Stale statement draft was accepted';
 exception when sqlstate 'PT409' then null; end;
 saved:=public.manor_command(gen_random_uuid(),'save_problem_view','{"id":"view-example","expected_revision":0,"name":"Company practice","filters":{"search":"","kinds":["coding"],"difficulties":[],"topics":[],"companies":["Example"],"tags":[],"collections":[],"sourceTypes":[],"hasContent":true,"statuses":[]},"sort":[{"field":"name","direction":"asc"}],"group_by":"topic","visible_columns":["difficulty","companies","status"]}');
 if saved->'record'->>'revision'<>'1' then raise exception 'View did not persist'; end if;
 if public.manor_problem_query('query_problems','{"company":"Example","has_content":true}') ->'items'->0->>'id'<>'library-example' then raise exception 'Metadata filters did not select the imported problem'; end if;
 if public.manor_problem_query('query_problems','{"company":"Example","has_content":true}')->>'total'<>'1' then raise exception 'Filtered metadata total included unrelated problems'; end if;
 if has_function_privilege('authenticated','manor_private.leetcode_summary()','execute') or has_function_privilege('authenticated','public.manor_leetcode_summary()','execute') then raise exception 'Retired practice summary is still executable'; end if;
 begin
  perform public.manor_command(gen_random_uuid(),'apply_leetcode_freeze','{"date":"2026-10-10","expected_revision":0}');
  raise exception 'Removed streak operation was accepted';
 exception when invalid_parameter_value then null; end;
 begin
  insert into public.leetcode_problems(user_id,id,topic,name,difficulty,curriculum_order) values(auth.uid(),'bypass','General','Bypass','Easy',0);
  raise exception 'Direct metadata write was accepted';
 exception when insufficient_privilege then null; end;
end $test$;
reset role;
update public.leetcode_problems set practice_status='attempted' where user_id='18a02205-8ef3-4a25-bc06-e0758db0755b' and id='library-example';
set local role authenticated;
do $test$
begin
 if public.manor_problem_query('read_problem','{"id":"library-example"}')->'problem'->>'status'<>'attempted' then raise exception 'Problem detail omitted durable execution status'; end if;
 if public.manor_problem_query('query_problems','{"status":"attempted"}')->>'total'<>'1' then raise exception 'Status filter did not select durable execution progress'; end if;
end $test$;
select set_config('request.jwt.claims','{"sub":"5b8acd23-9db3-487f-b20a-315d08d2a947","role":"authenticated"}',true);
do $test$
begin
 if exists(select 1 from public.leetcode_problems where id='library-example') or exists(select 1 from public.problem_content_versions where problem_id='library-example') or exists(select 1 from public.problem_code_drafts where id='draft-example') or exists(select 1 from public.saved_problem_views where id='view-example') then raise exception 'Problem library records crossed accounts'; end if;
 begin
  perform public.manor_problem_query('read_problem','{"id":"library-example"}');
  raise exception 'Foreign problem detail was readable';
 exception when no_data_found then null; end;
 if public.manor_problem_query('read_problem_draft','{"problem_id":"library-example","language":"python"}') is not null then raise exception 'Foreign draft was readable'; end if;
end $test$;
rollback;
