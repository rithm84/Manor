-- Real duplicate-group integration checks. Synthetic accounts and content roll back.
begin;
insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('29e39586-ec4b-4c1e-8038-94d99ba57a2e','authenticated','authenticated','problem-duplicates@example.invalid',now(),now()),
 ('c2ccfd6b-fd88-4c26-a8dd-9c4ecc6a6061','authenticated','authenticated','problem-duplicates-other@example.invalid',now(),now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"29e39586-ec4b-4c1e-8038-94d99ba57a2e","role":"authenticated"}',true);
do $test$
declare base jsonb; merged jsonb; detail jsonb; record jsonb; patch jsonb; input jsonb; cid uuid:=gen_random_uuid(); rid text;
begin
 perform public.manor_command(gen_random_uuid(),'save_profile','{"name":"Duplicate test","timezone":"America/Los_Angeles","settings":{},"expected_revision":0}');
 base:='{"id":"duplicate-canonical","expected_revision":0,"name":"Original source title","difficulty":"Easy","kind":"coding","topics":["Arithmetic"],"companies":["First company"],"tags":["Duplicate integration"],"collections":[],"source_url":"https://example.invalid/first","source_type":"imported","external_key":"duplicate/first","content":{"statement_markdown":"Read two integers and print their sum.","examples":[],"hints":[],"solution_markdown":null,"starter_code":{"python":"import sys\n"}},"testset":{"checker":"trimmed","provenance":"generated","cases":[{"id":"private-answer","input":"1 2","expectedOutput":"3","hidden":true}]}}';
 perform public.manor_command(gen_random_uuid(),'save_problem',base);
 patch:=(base-'testset')||'{"id":"duplicate-alias","name":"Second source title","companies":["Second company"],"topics":["Parsing"],"source_url":"https://example.invalid/second","external_key":"duplicate/second","source_metadata":{"lastAsked":{"value":"2026-09-19","precision":"day"}},"content":{"statement_markdown":"Second independently retained statement.","examples":[],"hints":[],"solution_markdown":null,"starter_code":{}}}';
 perform public.manor_command(gen_random_uuid(),'save_problem',patch);
 begin
  perform public.manor_command(gen_random_uuid(),'merge_problem_duplicates','{"id":"duplicate-alias","expected_revision":1,"name":"Sum two integers","aliases":[{"id":"duplicate-canonical","expected_revision":1}],"reason":"Equivalent arithmetic contract"}');
  raise exception 'A current source grader was hidden';
 exception when raise_exception then if sqlerrm<>'Choose the source with a current verified grader as the canonical problem' then raise; end if; end;
 input:='{"id":"duplicate-canonical","expected_revision":1,"name":"Sum two integers","aliases":[{"id":"duplicate-alias","expected_revision":1}],"reason":"Both contracts read two integers and print their arithmetic sum."}';
 merged:=public.manor_command(cid,'merge_problem_duplicates',input);
 if merged->'record'->'canonical'->>'revision'<>'2' then raise exception 'Canonical revision did not advance'; end if;
 if (public.manor_command(cid,'merge_problem_duplicates',input)->>'replayed')<>'true' then raise exception 'Merge replay changed the group'; end if;
 begin perform public.manor_command(cid,'merge_problem_duplicates',input||'{"name":"Different title"}'); raise exception 'Mismatched request replay succeeded'; exception when invalid_parameter_value then null; end;
 begin perform public.manor_command(gen_random_uuid(),'merge_problem_duplicates',input); raise exception 'Stale merge succeeded'; exception when sqlstate 'PT409' then null; end;
 detail:=public.manor_problem_query('read_problem','{"id":"duplicate-alias"}');
 if detail->'problem'->>'id'<>'duplicate-canonical' or detail->>'requested_id'<>'duplicate-alias' or detail->'requested_problem'->>'id'<>'duplicate-alias' then raise exception 'Alias read lost canonical or requested identity'; end if;
 if detail->'requested_content'->>'statement_markdown'<>'Second independently retained statement.' or detail->'content'->>'statement_markdown'<>'Read two integers and print their sum.' then raise exception 'Alias source content was overwritten or hidden'; end if;
 if jsonb_array_length(detail->'source_records')<>2 or detail->>'grading_available'<>'true' then raise exception 'Group sources or selected grader were lost'; end if;
 if jsonb_array_length(detail->'problem'->'companies')<>2 or jsonb_array_length(detail->'source_records'->0->'companies')<>1 then raise exception 'Canonical union replaced raw source metadata'; end if;
 if detail::text like '%private-answer%' or detail::text like '%expectedOutput%' then raise exception 'Duplicate read leaked private answers'; end if;
 if public.manor_problem_query('query_problems','{"tag":"Duplicate integration"}')->>'total'<>'1' then raise exception 'Default index returned duplicate sources'; end if;
 if public.manor_problem_query('query_problems','{"company":"Second company","topic":"Parsing","last_asked_since":"2026-09-01","last_asked_until":"2026-09-30"}')->>'total'<>'1' then raise exception 'Source evidence filters lost the canonical group'; end if;
 if public.manor_problem_query('query_problems','{"search":"Second source title"}')->>'total'<>'1' then raise exception 'Alias title search lost the group'; end if;
 begin
  perform public.manor_command(gen_random_uuid(),'save_problem',patch||jsonb_build_object('expected_revision',2,'tags',(select jsonb_agg('Distinct label '||value) from generate_series(1,100) value)));
  raise exception 'A source update exceeded the projected label limit';
 exception when raise_exception then if sqlerrm not like 'Combined % labels exceed the duplicate-group catalog limit' then raise; end if; end;
 begin
  perform public.manor_command(gen_random_uuid(),'save_problem',patch||'{"expected_revision":2,"kind":"other"}');
  raise exception 'A grouped source changed its kind';
 exception when raise_exception then if sqlerrm<>'A duplicate must reference an account-owned imported canonical problem' then raise; end if; end;
 patch:=patch||'{"expected_revision":2,"companies":["Third company"]}';
 record:=public.manor_command(gen_random_uuid(),'import_problems',jsonb_build_object('items',jsonb_build_array(patch)));
 if record->'record'->'items'->0->>'outcome'<>'updated' or (select canonical_problem_id from public.leetcode_problems where id='duplicate-alias')<>'duplicate-canonical' then raise exception 'Reimport resurrected a source as an index duplicate'; end if;
 if public.manor_problem_query('query_problems','{"company":"Third company"}')->>'total'<>'1' then raise exception 'Reimport source labels did not reach canonical projection'; end if;
 begin perform public.manor_command(gen_random_uuid(),'save_problem_draft','{"id":"alias-draft","expected_revision":0,"problem_id":"duplicate-alias","language":"python","content_version":1,"source":"print(3)"}'); raise exception 'Grouped source accepted a cloud draft'; exception when sqlstate 'PT409' then null; end;
 begin perform public.manor_command(gen_random_uuid(),'create_attempt','{"id":"alias-attempt","expected_revision":0,"problem_id":"duplicate-alias","date":"2026-10-01","solution":"print(3)"}'); raise exception 'Grouped source accepted a new attempt'; exception when sqlstate 'PT409' then null; end;
 -- Account-global mistake jots have no problem relationship and remain writable.
 perform public.manor_command(gen_random_uuid(),'save_mistake','{"id":"global-jot","expected_revision":0,"text":"Preserve independent practice notes"}');
 perform public.manor_command(gen_random_uuid(),'unmerge_problem_duplicate','{"id":"duplicate-alias","expected_revision":3,"canonical_expected_revision":2}');
 if public.manor_problem_query('query_problems','{"tag":"Duplicate integration"}')->>'total'<>'2' or (select count(*) from public.problem_content_versions where problem_id in ('duplicate-canonical','duplicate-alias'))<>2 then raise exception 'Unmerge did not restore sources and retained content'; end if;
 if (select name from public.leetcode_problems where id='duplicate-canonical')<>'Sum two integers' or (select source_name from public.leetcode_problems where id='duplicate-canonical')<>'Original source title' then raise exception 'Reviewed and original titles were not retained'; end if;
 for rid in select unnest(array['protected-draft','protected-attempt','protected-submission','protected-editor']) loop
  perform public.manor_command(gen_random_uuid(),'save_problem',(base-'testset')||jsonb_build_object('id',rid,'external_key',rid));
 end loop;
 perform public.manor_command(gen_random_uuid(),'save_problem_draft','{"id":"protected-cloud-draft","expected_revision":0,"problem_id":"protected-draft","language":"python","content_version":1,"source":"print(3)"}');
 perform public.manor_command(gen_random_uuid(),'create_attempt','{"id":"protected-history","expected_revision":0,"problem_id":"protected-attempt","date":"2026-10-01","solution":"print(3)"}');
 for rid in select unnest(array['protected-draft','protected-attempt']) loop
  begin perform public.manor_command(gen_random_uuid(),'merge_problem_duplicates',jsonb_build_object('id','duplicate-canonical','expected_revision',3,'name','Sum two integers','aliases',jsonb_build_array(jsonb_build_object('id',rid,'expected_revision',1)),'reason','Equivalent arithmetic contract')); raise exception 'Protected source % was hidden',rid; exception when sqlstate 'PT409' then null; end;
 end loop;
 begin perform public.manor_command(gen_random_uuid(),'merge_problem_duplicates','{"id":"neetcode-1-1","expected_revision":1,"name":"Stock","aliases":[{"id":"duplicate-alias","expected_revision":4}],"reason":"Invalid stock merge"}'); raise exception 'Stock identity was merged'; exception when raise_exception then if sqlerrm<>'Choose an imported canonical problem, keeping stock and custom problems separate' then raise; end if; end;
end $test$;
reset role;
insert into public.problem_submissions(user_id,id,problem_id,content_version,language,mode,total_cases,request_id,request_hash) values('29e39586-ec4b-4c1e-8038-94d99ba57a2e',gen_random_uuid(),'protected-submission',1,'python','run',0,gen_random_uuid(),'integration');
insert into manor_private.problem_editor_sessions(user_id,id,problem_id,language,sandbox_name,expires_at) values('29e39586-ec4b-4c1e-8038-94d99ba57a2e',gen_random_uuid(),'protected-editor','python','integration-no-vm',now()+interval '5 minutes');
set local role authenticated;
do $test$
declare rid text;
begin
 for rid in select unnest(array['protected-submission','protected-editor']) loop
  begin perform public.manor_command(gen_random_uuid(),'merge_problem_duplicates',jsonb_build_object('id','duplicate-canonical','expected_revision',3,'name','Sum two integers','aliases',jsonb_build_array(jsonb_build_object('id',rid,'expected_revision',1)),'reason','Equivalent arithmetic contract')); raise exception 'Protected source % was hidden',rid; exception when sqlstate 'PT409' then null; end;
 end loop;
end $test$;
select set_config('request.jwt.claims','{"sub":"c2ccfd6b-fd88-4c26-a8dd-9c4ecc6a6061","role":"authenticated"}',true);
do $test$
begin
 if public.manor_problem_query('query_problems','{"tag":"Duplicate integration"}')->>'total'<>'0' then raise exception 'Canonical query crossed accounts'; end if;
 begin perform public.manor_problem_query('read_problem','{"id":"duplicate-alias"}'); raise exception 'Alias read crossed accounts'; exception when no_data_found then null; end;
 begin perform public.manor_command(gen_random_uuid(),'merge_problem_duplicates','{"id":"duplicate-canonical","expected_revision":3,"name":"Cross account","aliases":[{"id":"duplicate-alias","expected_revision":4}],"reason":"Unauthorized"}'); raise exception 'Merge crossed accounts'; exception when no_data_found then null; end;
end $test$;
rollback;
