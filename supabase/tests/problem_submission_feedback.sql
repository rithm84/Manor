-- Real enqueue, lease, settlement, history, and RLS checks. Synthetic records roll back.
begin;
insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('dbcb6abf-569a-4ca1-99f9-476a68343393','authenticated','authenticated','feedback-owner@example.invalid',now(),now()),
 ('d8486d96-b977-4d3f-ac71-52eeb280c395','authenticated','authenticated','feedback-other@example.invalid',now(),now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"dbcb6abf-569a-4ca1-99f9-476a68343393","role":"authenticated"}',true);
do $test$
declare cases jsonb;
begin
 perform public.manor_command(gen_random_uuid(),'save_profile','{"name":"Feedback test","timezone":"America/Los_Angeles","settings":{},"expected_revision":0}');
 select jsonb_agg(jsonb_build_object('id','case-'||i,'input',i::text,'expectedOutput',(i*2)::text,'hidden',i>0) order by i) into cases from generate_series(0,6) i;
 perform public.manor_command(gen_random_uuid(),'save_problem',jsonb_build_object(
  'id','submission-feedback-test','expected_revision',0,'name','Double the input','difficulty','Easy','kind','coding','topics',jsonb_build_array('Arrays'),
  'companies','[]'::jsonb,'tags','[]'::jsonb,'collections','[]'::jsonb,'source_type','custom','source_url',null,'external_key',null,
  'content',jsonb_build_object('statement_markdown','Read an integer and print twice its value.','examples',jsonb_build_array(jsonb_build_object('input','0','output','0','explanation',null)),'hints','[]'::jsonb,'solution_markdown','Multiply by two.','starter_code',jsonb_build_object('python','print(int(input()) * 2)')),
  'testset',jsonb_build_object('checker','trimmed','provenance','generated','cases',cases)
 ));
end $test$;
reset role;
do $test$
declare owner_id uuid:='dbcb6abf-569a-4ca1-99f9-476a68343393'; s jsonb; job jsonb; batch jsonb; item jsonb; history jsonb; results jsonb; revealed jsonb; round integer;
begin
 s:=public.manor_problem_runner('enqueue',owner_id,jsonb_build_object('problemId','submission-feedback-test','code','print(0)','language','python','mode','submit','requestId',gen_random_uuid()));
 perform set_config('manor.feedback_submission',s->>'id',true);
 for round in 1..2 loop
  job:=public.manor_problem_runner('claim_submission',owner_id,jsonb_build_object('submissionId',s->>'id'));
  if jsonb_array_length(job->'cases')<>(case when round=1 then 4 else 3 end) then raise exception 'Unexpected lease batch width'; end if;
  batch:='[]'::jsonb;
  for item in select value from jsonb_array_elements(job->'cases') loop
   -- The database must derive visibility and expected answers from its saved cases, not trust worker flags.
   batch:=batch||jsonb_build_array(jsonb_build_object('id',item->>'id','passed',item->>'id' not in ('case-4','case-5'),
    'hidden',false,'input','forged input','expectedOutput','forged answer','output',case when item->>'id' in ('case-4','case-5') then 'WRONG' else item->>'expectedOutput' end,
    'stdout','debug '||(item->>'id'),'stderr','diagnostic '||(item->>'id'),'durationMs',1,'verdict',case when item->>'id' in ('case-4','case-5') then 'wrong_answer' else 'accepted' end));
  end loop;
  s:=public.manor_problem_runner('complete',owner_id,jsonb_build_object('submissionId',s->>'id','leaseToken',job->>'leaseToken','results',batch));
  if round=1 and s->>'status'<>'queued' then raise exception 'First batch did not continue'; end if;
 end loop;
 if s->>'status'<>'completed' or s->>'verdict'<>'wrong_answer' or s->>'passedCases'<>'5' then raise exception 'Verdict or pass count changed'; end if;
 s:=public.manor_problem_runner('read',owner_id,jsonb_build_object('submissionId',s->>'id'));
 revealed:=s->'results'->4;
 if revealed->>'input'<>'4' or revealed->>'expectedOutput'<>'8' or revealed->>'output'<>'WRONG' or revealed->>'stdout'<>'debug case-4' or revealed->>'stderr'<>'diagnostic case-4' or revealed->>'hidden'<>'true' then raise exception 'First hidden failure was not revealed accurately: %',revealed; end if;
 for item in select value from jsonb_array_elements(s->'results') where value->>'id' not in ('case-0','case-4') loop
  if item->>'input' is not null or item->>'expectedOutput' is not null or item->>'output' is not null or item->>'stdout' is not null or item->>'stderr' is not null then raise exception 'Another hidden case was disclosed: %',item; end if;
 end loop;
 history:=public.manor_problem_runner('list',owner_id,'{"problemId":"submission-feedback-test"}');
 if history->0->'results' is distinct from s->'results' then raise exception 'Saved history lost the revealed counterexample'; end if;
 -- A public failure comes first: no later hidden counterexample is disclosed.
 results:=manor_private.problem_submission_results('[{"id":"p","passed":false,"hidden":false,"verdict":"wrong_answer","output":"0"},{"id":"h","passed":false,"hidden":false,"verdict":"wrong_answer","output":"secret","stdout":"secret"}]',
  '[{"id":"p","hidden":false,"input":"public","expectedOutput":"1"},{"id":"h","hidden":true,"input":"private","expectedOutput":"2"}]');
 if results->1->>'output' is not null or results->1->>'input' is not null then raise exception 'A later hidden failure was exposed after a public failure'; end if;
 -- Compilation errors retain compiler diagnostics without revealing the first case.
 results:=manor_private.problem_submission_results('[{"id":"h","passed":false,"hidden":true,"verdict":"compile_error","input":"secret","expectedOutput":"secret","output":"secret","stderr":"SyntaxError"}]','[{"id":"h","hidden":true,"input":"private","expectedOutput":"2"}]');
 if results->0->>'input' is not null or results->0->>'expectedOutput' is not null or results->0->>'stderr'<>'SyntaxError' then raise exception 'Compilation diagnostics changed'; end if;
end $test$;
set local role authenticated;
do $test$
declare results jsonb;
begin
 select s.results into results from public.problem_submissions s where s.id=current_setting('manor.feedback_submission')::uuid;
 if results->4->>'input'<>'4' or results->5->>'input' is not null then raise exception 'Direct owner reads bypassed counterexample disclosure'; end if;
 if public.manor_problem_query('read_problem','{"id":"submission-feedback-test"}')::text like '%case-4%' then raise exception 'Problem detail leaked the hidden testset'; end if;
end $test$;
select set_config('request.jwt.claims','{"sub":"d8486d96-b977-4d3f-ac71-52eeb280c395","role":"authenticated"}',true);
do $test$
begin
 if exists(select 1 from public.problem_submissions where id=current_setting('manor.feedback_submission')::uuid) then raise exception 'Another account could read submission diagnostics'; end if;
end $test$;
reset role;
select 'Problem submission feedback checks passed' as result;
rollback;
