begin;
insert into auth.users(id,aud,role,email,created_at,updated_at) values('88888888-8888-4888-8888-888888888888','authenticated','authenticated','leetcode@example.invalid',now(),now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated"}',true);
select public.manor_command(gen_random_uuid(),'save_profile','{"name":"LC test","timezone":"America/Los_Angeles","settings":{},"expected_revision":0}');
do $$declare d date:=(public.manor_leetcode_summary()->'freezeAction'->>'date')::date; result jsonb;
begin
 if (public.manor_leetcode_summary()->>'totalProblems')::int<>150 then raise exception 'New account did not receive the canonical curriculum'; end if;
 result:=public.manor_command(gen_random_uuid(),'apply_leetcode_freeze',jsonb_build_object('date',d,'expected_revision',0));
 if result->'record'->'freezeAction'->>'applied'<>'true' then raise exception 'Freeze not applied'; end if;
 perform public.manor_command(gen_random_uuid(),'clear_leetcode_freeze',jsonb_build_object('date',d,'expected_revision',1));
 perform public.manor_command(gen_random_uuid(),'apply_leetcode_freeze',jsonb_build_object('date',d,'expected_revision',2));
 begin
  perform public.manor_command(gen_random_uuid(),'clear_leetcode_freeze',jsonb_build_object('date',d,'expected_revision',1));
  raise exception 'Stale freeze edit was accepted';
 exception when sqlstate 'PT409' then null; end;
 perform public.manor_command(gen_random_uuid(),'create_attempt',jsonb_build_object('id','lc-refund-test','problem_id','neetcode-1-1','date',d,'solution','synthetic solution','expected_revision',0));
 if (public.manor_leetcode_summary()->>'freezesLeft')::int<>5 then raise exception 'Real solve did not refund freeze'; end if;
 if public.manor_leetcode_summary()->'freezeAction'->>'canApply'<>'false' then raise exception 'Solved day offered a freeze'; end if;
end $$;
rollback;
