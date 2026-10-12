-- Private test answers and durable, server-owned execution jobs.
begin;
alter table public.leetcode_problems add column practice_status text not null default 'unattempted' check(practice_status in ('unattempted','attempted','solved'));
create table manor_private.problem_testsets (
 user_id uuid not null references auth.users(id) on delete cascade,
 problem_id text not null,
 content_version integer not null,
 version integer not null,
 checker text not null check (checker in ('exact','trimmed','json')),
 provenance text not null check (provenance in ('generated','source','user')),
 cases jsonb not null check (jsonb_typeof(cases)='array' and jsonb_array_length(cases) between 1 and 200),
 created_at timestamptz not null default now(),
 primary key(user_id,problem_id,version),
 foreign key(user_id,problem_id,content_version) references public.problem_content_versions(user_id,problem_id,version) on delete cascade
);
create table public.problem_submissions (
 user_id uuid not null references auth.users(id) on delete cascade,
 id uuid not null default gen_random_uuid(),
 problem_id text not null,
 content_version integer not null,
 testset_version integer,
 language text not null check(language in ('cpp','c','python','javascript','java','go')),
 mode text not null check(mode in ('run','submit')),
 status text not null default 'queued' check(status in ('queued','running','completed','failed')),
 verdict text check(verdict in ('accepted','wrong_answer','compile_error','runtime_error','time_limit','output_limit','execution_error')),
 passed_cases integer not null default 0,
 total_cases integer not null,
 results jsonb not null default '[]',
 error text,
 request_id uuid not null,
 request_hash text not null,
 created_at timestamptz not null default now(),
 finished_at timestamptz,
 primary key(user_id,id),
 unique(user_id,request_id),
 foreign key(user_id,problem_id,content_version) references public.problem_content_versions(user_id,problem_id,version) on delete cascade
);
alter table public.problem_submissions enable row level security;
create policy problem_submissions_owner_read on public.problem_submissions for select to authenticated using (auth.uid()=user_id);
grant select on public.problem_submissions to authenticated;
create index problem_submissions_recent on public.problem_submissions(user_id,problem_id,created_at desc);
create table manor_private.problem_execution_jobs (
 user_id uuid not null,
 submission_id uuid not null,
 code text not null check(octet_length(code)<=262144),
 cases jsonb not null,
 checker text not null,
 cursor integer not null default 0,
 attempts integer not null default 0,
 lease_token uuid,
 leased_until timestamptz,
 next_attempt_at timestamptz not null default now(),
 primary key(user_id,submission_id),
 foreign key(user_id,submission_id) references public.problem_submissions(user_id,id) on delete cascade
);
create table manor_private.problem_editor_sessions (
 user_id uuid not null references auth.users(id) on delete cascade,
 id uuid not null,
 problem_id text not null,
 language text not null check(language in ('cpp','c','python','javascript','java','go')),
 sandbox_name text not null,
 expires_at timestamptz not null,
 primary key(user_id,id),
 foreign key(user_id,problem_id) references public.leetcode_problems(user_id,id) on delete cascade
);

create function manor_private.save_problem_testset(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid := (p->>'userId')::uuid; rid text:=p->>'problemId'; cv integer:=(p->>'contentVersion')::integer; v integer; c jsonb;
begin
 if owner is null or rid is null or length(rid)=0 or cv is null or cv<=0 then raise exception 'A testset requires owner, problem, and positive content version'; end if;
 if auth.uid() is not null and auth.uid()<>owner then raise exception 'A testset must belong to the signed-in account'; end if;
 if p->>'checker' is null or p->>'provenance' is null or p->>'checker' not in ('exact','trimmed','json') or p->>'provenance' not in ('generated','source','user') then raise exception 'A testset requires a supported checker and provenance'; end if;
 if jsonb_typeof(p->'cases') is distinct from 'array' or jsonb_array_length(p->'cases') not between 1 and 200 then raise exception 'A testset requires between 1 and 200 cases'; end if;
 for c in select value from jsonb_array_elements(p->'cases') loop
  if jsonb_typeof(c->'id') is distinct from 'string' or length(c->>'id') not between 1 and 100 or jsonb_typeof(c->'input') is distinct from 'string' or jsonb_typeof(c->'expectedOutput') is distinct from 'string' or jsonb_typeof(c->'hidden') is distinct from 'boolean' then raise exception 'Every case requires id, input, expectedOutput, and hidden'; end if;
  if octet_length(c->>'input')>1048576 or octet_length(c->>'expectedOutput')>65536 then raise exception 'A case exceeds the input or answer size limit'; end if;
  if p->>'checker'='json' then perform (c->>'expectedOutput')::jsonb; end if;
 end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(p->'cases'))<>jsonb_array_length(p->'cases') then raise exception 'Case IDs must be unique'; end if;
 perform pg_advisory_xact_lock(hashtextextended(owner::text||rid,0));
 select coalesce(max(version),0)+1 into v from manor_private.problem_testsets where user_id=owner and problem_id=rid;
 if p ? 'version' and (p->>'version')::integer<>v then raise exception 'The next testset version is %',v; end if;
 insert into manor_private.problem_testsets(user_id,problem_id,content_version,version,checker,provenance,cases) values(owner,rid,cv,v,p->>'checker',p->>'provenance',p->'cases');
 return jsonb_build_object('testsetVersion',v,'count',jsonb_array_length(p->'cases'));
end $$;
revoke all on function manor_private.save_problem_testset(jsonb) from public,anon,authenticated;
grant execute on function manor_private.save_problem_testset(jsonb) to manor_commands,service_role;

create function manor_private.problem_submission_json(s public.problem_submissions) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('id',s.id,'problemId',s.problem_id,'contentVersion',s.content_version,'testsetVersion',s.testset_version,'language',s.language,'mode',s.mode,'status',s.status,'verdict',s.verdict,'passedCases',s.passed_cases,'totalCases',s.total_cases,'results',s.results,'error',s.error,'createdAt',s.created_at,'finishedAt',s.finished_at)
$$;

create function public.manor_problem_runner(p_action text,p_owner uuid,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.problem_submissions; j manor_private.problem_execution_jobs; t manor_private.problem_testsets; c jsonb; batch jsonb; result jsonb; cv integer; rid text; sid uuid; failure text; count_pass integer; request_hash_value text;
begin
 if auth.role() is distinct from 'service_role' and session_user<>'postgres' then raise exception 'Problem execution is managed by the server'; end if;
 if p_action<>'claim' and p_owner is null then raise exception 'An account is required for this execution action'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'Execution input must be an object'; end if;
 if p_action='enqueue' then
  if jsonb_typeof(p_input->'code') is distinct from 'string' or jsonb_typeof(p_input->'problemId') is distinct from 'string' or p_input->>'requestId' is null then raise exception 'Execution requires a problem, program source, and request ID'; end if;
  if p_input ? 'customInput' and jsonb_typeof(p_input->'customInput') is distinct from 'string' then raise exception 'Custom input must be text'; end if;
  request_hash_value:=encode(pg_catalog.sha256(convert_to(p_input::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text||'problem-execution',0));
  select * into s from public.problem_submissions where user_id=p_owner and request_id=(p_input->>'requestId')::uuid;
  if found then
   if s.request_hash<>request_hash_value then raise exception 'This execution request ID was already used for different input'; end if;
   return manor_private.problem_submission_json(s);
  end if;
  rid:=p_input->>'problemId';
  select content_version into cv from public.leetcode_problems where user_id=p_owner and id=rid and kind='coding';
  if cv is null or cv=0 then raise exception 'This problem has no executable content'; end if;
  if p_input->>'language' is null or p_input->>'mode' is null or p_input->>'language' not in ('cpp','c','python','javascript','java','go') or p_input->>'mode' not in ('run','submit') then raise exception 'Unsupported execution language or mode'; end if;
  if octet_length(p_input->>'code') not between 1 and 262144 then raise exception 'Program source must contain between 1 byte and 256 KiB'; end if;
  if (select count(*) from public.problem_submissions where user_id=p_owner and status in ('queued','running'))>=4 then raise exception 'Four executions are already pending. Wait for one to finish'; end if;
  if p_input ? 'customInput' and p_input->>'mode'='run' then
   if octet_length(p_input->>'customInput')>1048576 then raise exception 'Custom input must be at most 1 MiB'; end if;
   batch:=jsonb_build_array(jsonb_build_object('id','custom','input',p_input->>'customInput','expectedOutput',null,'hidden',false));
   t.checker:='trimmed';
  else
   select * into t from manor_private.problem_testsets where user_id=p_owner and problem_id=rid and content_version=cv order by version desc limit 1;
   if not found then raise exception 'This problem needs a verified testset before it can run'; end if;
   select jsonb_agg(value) into batch from jsonb_array_elements(t.cases) where p_input->>'mode'='submit' or not (value->>'hidden')::boolean;
   if batch is null then raise exception 'This testset has no public examples. Use custom input or Submit'; end if;
  end if;
  insert into public.problem_submissions(user_id,problem_id,content_version,testset_version,language,mode,total_cases,request_id,request_hash) values(p_owner,rid,cv,t.version,p_input->>'language',p_input->>'mode',jsonb_array_length(batch),(p_input->>'requestId')::uuid,request_hash_value) returning * into s;
  insert into manor_private.problem_execution_jobs(user_id,submission_id,code,cases,checker) values(p_owner,s.id,p_input->>'code',batch,t.checker);
  update public.leetcode_problems set practice_status='attempted',revision=revision+1,updated_at=clock_timestamp() where user_id=p_owner and id=rid and practice_status='unattempted';
  return manor_private.problem_submission_json(s);
 elsif p_action='read' then
  select * into s from public.problem_submissions where user_id=p_owner and id=(p_input->>'submissionId')::uuid;
  if not found then raise exception 'Submission not found'; end if;
  return manor_private.problem_submission_json(s);
 elsif p_action='list' then
  return coalesce((select jsonb_agg(manor_private.problem_submission_json(r)) from (select * from public.problem_submissions where user_id=p_owner and problem_id=p_input->>'problemId' order by created_at desc limit 50) r),'[]'::jsonb);
 elsif p_action='claim' then
  update public.problem_submissions s0 set status='failed',verdict='execution_error',error='Execution could not complete after three worker attempts',finished_at=now() from manor_private.problem_execution_jobs j0 where s0.user_id=j0.user_id and s0.id=j0.submission_id and s0.status in ('queued','running') and j0.attempts>=3 and coalesce(j0.leased_until,'-infinity')<now();
  select j0.* into j from manor_private.problem_execution_jobs j0 join public.problem_submissions s0 on s0.user_id=j0.user_id and s0.id=j0.submission_id where s0.status in ('queued','running') and j0.attempts<3 and j0.next_attempt_at<=now() and coalesce(j0.leased_until,'-infinity')<now() order by s0.created_at for update of j0 skip locked limit 1;
  if not found then return null; end if;
  update manor_private.problem_execution_jobs set lease_token=gen_random_uuid(),leased_until=now()+interval '150 seconds',attempts=attempts+1 where user_id=j.user_id and submission_id=j.submission_id returning * into j;
  update public.problem_submissions set status='running' where user_id=j.user_id and id=j.submission_id returning * into s;
  select jsonb_agg(value) into batch from jsonb_array_elements(j.cases) with ordinality where ordinality>j.cursor and ordinality<=j.cursor+4;
  return jsonb_build_object('submission',manor_private.problem_submission_json(s),'owner',j.user_id,'leaseToken',j.lease_token,'code',j.code,'checker',j.checker,'cases',batch);
 elsif p_action in ('complete','fail') then
  sid:=(p_input->>'submissionId')::uuid;
  select * into j from manor_private.problem_execution_jobs where user_id=p_owner and submission_id=sid for update;
  if not found or j.lease_token is distinct from (p_input->>'leaseToken')::uuid or j.leased_until<now() then raise exception 'Execution lease expired or was replaced'; end if;
  select * into s from public.problem_submissions where user_id=p_owner and id=sid for update;
  if p_action='fail' then
   failure:=left(p_input->>'error',2000);
   update public.problem_submissions set status='failed',verdict='execution_error',error=failure,finished_at=now() where user_id=p_owner and id=sid returning * into s;
  else
   batch:=p_input->'results';
   if jsonb_typeof(batch)<>'array' or jsonb_array_length(batch)=0 then raise exception 'Worker returned no case results'; end if;
   result:='[]'::jsonb;
   for c in select value from jsonb_array_elements(batch) loop
    if not exists(select 1 from jsonb_array_elements(j.cases) original where original->>'id'=c->>'id') then raise exception 'Worker returned an unexpected case ID'; end if;
    if (c->>'hidden')::boolean then c:=c||jsonb_build_object('input',null,'expectedOutput',null,'output',null,'stderr',null); end if;
    result:=result||jsonb_build_array(c);
   end loop;
   select count(*) into count_pass from jsonb_array_elements(result) where (value->>'passed')::boolean;
   s.results:=s.results||result; s.passed_cases:=s.passed_cases+count_pass;
   failure:=(select value->>'verdict' from jsonb_array_elements(s.results) where value->>'verdict'<>'accepted' limit 1);
   if failure='compile_error' or jsonb_array_length(s.results)>=s.total_cases then
    update public.problem_submissions set results=s.results,passed_cases=s.passed_cases,status='completed',verdict=coalesce(failure,'accepted'),finished_at=now() where user_id=p_owner and id=sid returning * into s;
   else
    update public.problem_submissions set results=s.results,passed_cases=s.passed_cases,status='queued' where user_id=p_owner and id=sid returning * into s;
    update manor_private.problem_execution_jobs set cursor=cursor+jsonb_array_length(result),attempts=0,lease_token=null,leased_until=null where user_id=p_owner and submission_id=sid;
   end if;
  end if;
  if s.status='completed' and s.mode='submit' and s.verdict='accepted' then
   update public.leetcode_problems set practice_status='solved',revision=revision+1,updated_at=clock_timestamp() where user_id=p_owner and id=s.problem_id and practice_status<>'solved';
  end if;
  if s.status in ('completed','failed') then delete from manor_private.problem_execution_jobs where user_id=p_owner and submission_id=sid; end if;
  return manor_private.problem_submission_json(s);
 elsif p_action='editor_save' then
  if not exists(select 1 from public.leetcode_problems where user_id=p_owner and id=p_input->>'problemId') then raise exception 'Problem not found'; end if;
  insert into manor_private.problem_editor_sessions(user_id,id,problem_id,language,sandbox_name,expires_at) values(p_owner,(p_input->>'id')::uuid,p_input->>'problemId',p_input->>'language',p_input->>'sandboxName',(p_input->>'expiresAt')::timestamptz);
  return jsonb_build_object('id',p_input->>'id');
 elsif p_action='editor_read' then
  return (select jsonb_build_object('sandboxName',sandbox_name,'expiresAt',expires_at) from manor_private.problem_editor_sessions where user_id=p_owner and id=(p_input->>'id')::uuid);
 elsif p_action='editor_delete' then
  delete from manor_private.problem_editor_sessions where user_id=p_owner and id=(p_input->>'id')::uuid;
  return jsonb_build_object('deleted',true);
 else raise exception 'Unknown problem runner action: %',p_action;
 end if;
end $$;
revoke all on function public.manor_problem_runner(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.manor_problem_runner(text,uuid,jsonb) to service_role;

commit;
