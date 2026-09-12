alter table public.leetcode_freeze_intents add column revision bigint not null default 1, add column active boolean not null default true;
grant create on schema manor_private to manor_commands;
create function manor_private.leetcode_freeze_command(op text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare day date:=(p->>'date')::date; current_revision bigint; spent integer; already_applied boolean;
begin
 if day is distinct from manor_private.today()-1 then raise exception 'LeetCode freezes can only cover yesterday'; end if;
 select revision,active into current_revision,already_applied from public.leetcode_freeze_intents where user_id=auth.uid() and date=day for update;
 current_revision:=coalesce(current_revision,0); already_applied:=coalesce(already_applied,false);
 perform manor_private.require_revision(current_revision,(p->>'expected_revision')::bigint,jsonb_build_object('date',day,'revision',current_revision));
 if op='apply_leetcode_freeze' then
  if already_applied then raise exception 'A freeze already covers this date'; end if;
  if exists(select 1 from public.leetcode_attempts where to_jsonb(leetcode_attempts)->>'deleted_at' is null and user_id=auth.uid() and date=day) then raise exception 'A logged attempt does not need a freeze'; end if;
  select count(*) into spent from public.leetcode_freeze_intents f where user_id=auth.uid() and active and date>=date_trunc('month',day)::date and date<(date_trunc('month',day)+interval '1 month')::date and not exists(select 1 from public.leetcode_attempts a where to_jsonb(a)->>'deleted_at' is null and a.user_id=f.user_id and a.date=f.date);
  if spent>=5 then raise exception 'No LeetCode freezes remain for this month'; end if;
  insert into public.leetcode_freeze_intents(user_id,date) values(auth.uid(),day) on conflict(user_id,date) do update set active=true,revision=leetcode_freeze_intents.revision+1;
 elsif op='clear_leetcode_freeze' then
  if not already_applied then raise exception 'No LeetCode freeze covers this date'; end if;
  update public.leetcode_freeze_intents set active=false,revision=revision+1 where user_id=auth.uid() and date=day;
 else raise exception 'Unsupported LeetCode freeze operation'; end if;
 return manor_private.leetcode_summary();
end $$;
alter function manor_private.leetcode_freeze_command(text,jsonb) owner to manor_commands;
revoke all on function manor_private.leetcode_freeze_command(text,jsonb) from public;
revoke create on schema manor_private from manor_commands;

grant update on public.leetcode_freeze_intents to manor_commands;
create trigger manor_history after insert or update or delete on public.leetcode_freeze_intents for each row execute function manor_private.record_change();
