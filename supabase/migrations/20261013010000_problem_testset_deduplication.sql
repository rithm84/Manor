-- Testset deduplication: saving a testset identical to the problem's latest one (same statement version,
-- checker, provenance, cases, and judge) returns that version instead of storing a copy, so repeated imports
-- of unchanged content add no testset versions. An explicitly requested version keeps the strict behavior.
begin;

create or replace function manor_private.save_problem_testset(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid := (p->>'userId')::uuid; rid text:=p->>'problemId'; cv integer:=(p->>'contentVersion')::integer; v integer; c jsonb; token text; numeric_value double precision; latest manor_private.problem_testsets;
begin
 if owner is null or rid is null or length(rid)=0 or cv is null or cv<=0 then raise exception 'A testset requires owner, problem, and positive content version'; end if;
 if auth.uid() is not null and auth.uid()<>owner then raise exception 'A testset must belong to the signed-in account'; end if;
 if p->>'checker' is null or p->>'provenance' is null or p->>'checker' not in ('exact','trimmed','json','numeric','json_unordered','json_unordered_deep','json_tolerant','special') or p->>'provenance' not in ('generated','source','user') then raise exception 'A testset requires a supported checker and provenance'; end if;
 if (p->>'checker'='special') <> (jsonb_typeof(p->'judge')='string') or octet_length(coalesce(p->>'judge',''))>65536 then raise exception 'A special checker requires judge source of at most 64 KiB, and only special checkers carry one'; end if;
 if jsonb_typeof(p->'cases') is distinct from 'array' or jsonb_array_length(p->'cases') not between 1 and 200 then raise exception 'A testset requires between 1 and 200 cases'; end if;
 for c in select value from jsonb_array_elements(p->'cases') loop
  if jsonb_typeof(c->'id') is distinct from 'string' or length(c->>'id') not between 1 and 100 or jsonb_typeof(c->'input') is distinct from 'string' or jsonb_typeof(c->'expectedOutput') is distinct from 'string' or jsonb_typeof(c->'hidden') is distinct from 'boolean' then raise exception 'Every case requires id, input, expectedOutput, and hidden'; end if;
  if octet_length(c->>'input')>1048576 or octet_length(c->>'expectedOutput')>65536 then raise exception 'A case exceeds the input or answer size limit'; end if;
  if p->>'checker' in ('json','json_unordered','json_unordered_deep','json_tolerant','special') then
   perform (c->>'expectedOutput')::jsonb;
   if p->>'checker' in ('json_unordered','json_unordered_deep') and jsonb_typeof((c->>'expectedOutput')::jsonb) is distinct from 'array' then raise exception 'The unordered JSON checker requires a top-level answer array'; end if;
  end if;
  if p->>'checker'='numeric' then
   if btrim(c->>'expectedOutput', E' \t\n\r')='' then raise exception 'The numeric checker requires at least one finite answer'; end if;
   for token in select unnest(regexp_split_to_array(btrim(c->>'expectedOutput', E' \t\n\r'), E'\\s+')) loop
    if token !~ '^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$' then raise exception 'The numeric checker answer contains a nonnumeric token'; end if;
    numeric_value := token::double precision;
    if numeric_value in ('Infinity'::double precision, '-Infinity'::double precision, 'NaN'::double precision) then raise exception 'The numeric checker requires finite answers'; end if;
   end loop;
  end if;
 end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(p->'cases'))<>jsonb_array_length(p->'cases') then raise exception 'Case IDs must be unique'; end if;
 perform pg_advisory_xact_lock(hashtextextended(owner::text||rid,0));
 if not p ? 'version' then
  select * into latest from manor_private.problem_testsets where user_id=owner and problem_id=rid order by version desc limit 1;
  if found and latest.content_version=cv and latest.checker=p->>'checker' and latest.provenance=p->>'provenance' and latest.cases=p->'cases' and latest.judge is not distinct from p->>'judge' then
   return jsonb_build_object('testsetVersion',latest.version,'count',jsonb_array_length(p->'cases'),'unchanged',true);
  end if;
 end if;
 select coalesce(max(version),0)+1 into v from manor_private.problem_testsets where user_id=owner and problem_id=rid;
 if p ? 'version' and (p->>'version')::integer<>v then raise exception 'The next testset version is %',v; end if;
 insert into manor_private.problem_testsets(user_id,problem_id,content_version,version,checker,provenance,cases,judge) values(owner,rid,cv,v,p->>'checker',p->>'provenance',p->'cases',p->>'judge');
 return jsonb_build_object('testsetVersion',v,'count',jsonb_array_length(p->'cases'));
end $$;

commit;
