grant create on schema manor_private to manor_commands;
create function manor_private.habit_state() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare day date; today date:=manor_private.today(); first_day date; month_key text; prior_month text; capacity int:=0; prior_capacity int:=0; balance int:=0; earned int:=0; spent int:=0; active_count int; complete_count int; intent record;
 pools jsonb:='[]'; freezes jsonb:='[]'; grants jsonb:='[]'; pool_days jsonb:='[]';
begin
 if auth.uid() is null then raise exception 'Sign in before reading habits'; end if;
 select min(created_on) into first_day from public.habits where user_id=auth.uid();
 if first_day<today-36525 then raise exception 'Habit history exceeds the supported 100-year range'; end if;
 for day in select generate_series(first_day,today,interval '1 day')::date loop
  month_key:=to_char(day,'YYYY-MM');
  select count(*) into capacity from public.habits h where h.user_id=auth.uid() and h.created_on<=day and coalesce((select status from public.habit_lifecycle l where l.user_id=auth.uid() and l.habit_id=h.id and l.date<=day order by l.date desc limit 1),'active')<>'retired';
  if month_key is distinct from prior_month then
   if prior_month is not null then pools:=pools||jsonb_build_array(jsonb_build_object('month',prior_month,'capacity',prior_capacity,'earned',earned,'spent',spent,'balance',balance)); end if;
   balance:=capacity; earned:=0; spent:=0;
  else balance:=least(capacity,balance+greatest(0,capacity-prior_capacity)); end if;
  for intent in select i.habit_id from public.habit_freeze_intents i join public.habits h on h.id=i.habit_id and h.user_id=i.user_id where i.user_id=auth.uid() and i.date=day and not exists(select 1 from public.habit_entries e where e.user_id=i.user_id and e.habit_id=i.habit_id and e.date=day and e.value=100) and coalesce((select l.status from public.habit_lifecycle l where l.user_id=i.user_id and l.habit_id=i.habit_id and l.date<=day order by l.date desc limit 1),'active')='active' order by i.created_at,i.habit_id loop
   if balance>0 then balance:=balance-1; spent:=spent+1; freezes:=freezes||jsonb_build_array(jsonb_build_object('habitId',intent.habit_id,'date',day)); end if;
  end loop;
  select count(*),count(*) filter(where exists(select 1 from public.habit_entries e where e.user_id=h.user_id and e.habit_id=h.id and e.date=day and e.value=100)) into active_count,complete_count from public.habits h where h.user_id=auth.uid() and h.created_on<=day and coalesce((select l.status from public.habit_lifecycle l where l.user_id=h.user_id and l.habit_id=h.id and l.date<=day order by l.date desc limit 1),'active')='active';
  if active_count>0 and complete_count=active_count and balance<capacity then balance:=balance+1; earned:=earned+1; grants:=grants||jsonb_build_array(jsonb_build_object('date',day)); end if;
  pool_days:=pool_days||jsonb_build_array(jsonb_build_object('date',day,'balance',balance));
  prior_month:=month_key; prior_capacity:=capacity;
 end loop;
 if prior_month is not null then pools:=pools||jsonb_build_array(jsonb_build_object('month',prior_month,'capacity',capacity,'earned',earned,'spent',spent,'balance',balance)); end if;
 return jsonb_build_object('today',today,
 'habits',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'kind',kind,'targetLabel',target_label,'createdOn',created_on,'createdAt',created_at) order by position,id),'[]') from public.habits where user_id=auth.uid()),
 'lifecycle',(select coalesce(jsonb_agg(jsonb_build_object('habitId',habit_id,'date',date,'status',status,'createdAt',created_at) order by date,habit_id),'[]') from public.habit_lifecycle where user_id=auth.uid()),
 'entries',(select coalesce(jsonb_agg(jsonb_build_object('habitId',habit_id,'date',date,'value',value,'createdAt',created_at,'updatedAt',updated_at) order by date,habit_id),'[]') from public.habit_entries where user_id=auth.uid()),
 'intents',(select coalesce(jsonb_agg(jsonb_build_object('habitId',habit_id,'date',date,'createdAt',created_at) order by date,habit_id),'[]') from public.habit_freeze_intents where user_id=auth.uid()),
 'freezes',freezes,'grants',grants,'pools',pools,'poolDays',pool_days);
end $$;
alter function manor_private.habit_state() owner to manor_commands;
revoke all on function manor_private.habit_state() from public;
grant execute on function manor_private.habit_state() to authenticated;
create function public.manor_habits_state() returns jsonb language sql security invoker set search_path='' as $$ select manor_private.habit_state() $$;
revoke all on function public.manor_habits_state() from public,anon;
grant execute on function public.manor_habits_state() to authenticated;

create function manor_private.streak_command(op text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare h public.habits; day date:=(p->>'date')::date; item jsonb; position_value int:=0; state jsonb;
begin
 if op='reorder_habits' then
  if jsonb_typeof(p->'habits') is distinct from 'array' or jsonb_array_length(p->'habits')<>(select count(*) from public.habits where user_id=auth.uid()) then raise exception 'Reordering requires every habit exactly once'; end if;
  if (select count(distinct value->>'id') from jsonb_array_elements(p->'habits'))<>jsonb_array_length(p->'habits') then raise exception 'Habit order contains duplicate IDs'; end if;
  for item in select value from jsonb_array_elements(p->'habits') loop
   select * into h from public.habits where user_id=auth.uid() and id=item->>'id' for update;
   if h.id is null then raise exception 'Habit is unavailable'; end if;
   perform manor_private.require_revision(h.revision,(item->>'expected_revision')::bigint,to_jsonb(h));
   update public.habits set position=position_value,revision=revision+1 where user_id=auth.uid() and id=h.id;
   position_value:=position_value+1;
  end loop;
 else
  if day is distinct from manor_private.today()-1 then raise exception 'Freezes can only cover yesterday'; end if;
  select * into h from public.habits where user_id=auth.uid() and id=p->>'id' for update;
  if h.id is null or h.created_on>day then raise exception 'Habit is unavailable for this date'; end if;
  perform manor_private.require_revision(h.revision,(p->>'expected_revision')::bigint,to_jsonb(h));
  if op='apply_habit_freeze' then
   if exists(select 1 from public.habit_entries where user_id=auth.uid() and habit_id=h.id and date=day and value=100) then raise exception 'A completed habit does not need a freeze'; end if;
   insert into public.habit_freeze_intents(user_id,habit_id,date,created_at) values(auth.uid(),h.id,day,clock_timestamp());
   state:=manor_private.habit_state();
   if not state->'freezes' @> jsonb_build_array(jsonb_build_object('habitId',h.id,'date',day)) then raise exception 'No freeze is available for this habit and date'; end if;
  elsif op='clear_habit_freeze' then
   delete from public.habit_freeze_intents where user_id=auth.uid() and habit_id=h.id and date=day;
   if not found then raise exception 'No freeze was spent on this habit and date'; end if;
  else raise exception 'Unsupported streak operation'; end if;
  update public.habits set revision=revision+1 where user_id=auth.uid() and id=h.id;
 end if;
 return manor_private.habit_state();
end $$;
alter function manor_private.streak_command(text,jsonb) owner to manor_commands;
revoke all on function manor_private.streak_command(text,jsonb) from public;

create table public.leetcode_freeze_intents(user_id uuid not null references auth.users(id) on delete cascade,date date not null,created_at timestamptz not null default now(),primary key(user_id,date));
alter table public.leetcode_freeze_intents enable row level security;
create policy leetcode_freeze_owner on public.leetcode_freeze_intents to manor_commands using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy leetcode_freeze_read on public.leetcode_freeze_intents for select to authenticated using(user_id=auth.uid());
grant select on public.leetcode_freeze_intents to authenticated;
grant select,insert,delete on public.leetcode_freeze_intents to manor_commands;
create function manor_private.leetcode_summary() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare day date:=manor_private.today(); streak int:=0; spent int; yesterday date:=manor_private.today()-1; yesterday_spent int; applied boolean; solved boolean; freeze_revision bigint;
begin
 if auth.uid() is null then raise exception 'Sign in before reading LeetCode'; end if;
 select count(*) into spent from public.leetcode_freeze_intents f where user_id=auth.uid() and active and date>=date_trunc('month',day)::date and not exists(select 1 from public.leetcode_attempts a where to_jsonb(a)->>'deleted_at' is null and a.user_id=f.user_id and a.date=f.date);
 select exists(select 1 from public.leetcode_freeze_intents where user_id=auth.uid() and active and date=yesterday),exists(select 1 from public.leetcode_attempts where to_jsonb(leetcode_attempts)->>'deleted_at' is null and user_id=auth.uid() and date=yesterday) into applied,solved;
 select coalesce((select revision from public.leetcode_freeze_intents where user_id=auth.uid() and date=yesterday),0) into freeze_revision;
 select count(*) into yesterday_spent from public.leetcode_freeze_intents f where user_id=auth.uid() and active and date>=date_trunc('month',yesterday)::date and date<(date_trunc('month',yesterday)+interval '1 month')::date and not exists(select 1 from public.leetcode_attempts a where to_jsonb(a)->>'deleted_at' is null and a.user_id=f.user_id and a.date=f.date);
 if not exists(select 1 from public.leetcode_attempts where to_jsonb(leetcode_attempts)->>'deleted_at' is null and user_id=auth.uid() and date=day) then day:=day-1; end if;
 while exists(select 1 from public.leetcode_attempts where to_jsonb(leetcode_attempts)->>'deleted_at' is null and user_id=auth.uid() and date=day) or exists(select 1 from public.leetcode_freeze_intents where user_id=auth.uid() and active and date=day) loop streak:=streak+1; day:=day-1; end loop;
 return jsonb_build_object('totalProblems',(select count(*) from public.leetcode_problems where user_id=auth.uid()),'streak',streak,'freezesLeft',greatest(0,5-spent),'freezesPerMonth',5,'freezeAction',jsonb_build_object('date',yesterday,'applied',applied,'canApply',not applied and not solved and yesterday_spent<5,'canClear',applied,'revision',freeze_revision),'legacyProgress','[]'::jsonb);
end $$;
alter function manor_private.leetcode_summary() owner to manor_commands;
revoke all on function manor_private.leetcode_summary() from public;
grant execute on function manor_private.leetcode_summary() to authenticated;
create function public.manor_leetcode_summary() returns jsonb language sql security invoker set search_path='' as $$ select manor_private.leetcode_summary() $$;
revoke all on function public.manor_leetcode_summary() from public,anon;
grant execute on function public.manor_leetcode_summary() to authenticated;
