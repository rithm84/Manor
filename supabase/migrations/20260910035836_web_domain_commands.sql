alter table public.weekly_reviews add column timezone text not null, add column title text not null;
alter table public.tasks add constraint web_task_title check(length(title) between 1 and 300) not valid;
alter table public.resumes add constraint resumes_owner_id unique(user_id,id);
alter table public.job_roles add constraint application_resume_owner foreign key(user_id,resume_id) references public.resumes(user_id,id);

create function manor_private.today() returns date language plpgsql stable set search_path='' as $$
declare tz text;
begin
 select timezone into tz from public.profiles where user_id=auth.uid();
 if tz is null then raise exception 'Save the account timezone before logging records'; end if;
 return (now() at time zone tz)::date;
end $$;
revoke all on function manor_private.today() from public;
grant execute on function manor_private.today() to manor_commands;

create function manor_private.domain_command(op text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare r jsonb; rid text:=p->>'id'; today date:=manor_private.today(); day date:=(p->>'date')::date;
 daily public.mood_focus_entries; attempt public.leetcode_attempts; mistake public.leetcode_notes; application public.job_roles; habit public.habits; entry public.habit_entries; capture public.kb_entries; review public.weekly_reviews; stage_value text;
begin
 case op
 when 'commit_debrief' then
  if day not in (today,today-1) then raise exception 'Daily records can only be edited today or yesterday'; end if;
  select * into daily from public.mood_focus_entries where user_id=auth.uid() and date=day for update;
  perform manor_private.require_revision(daily.revision,(p->>'expected_revision')::bigint,to_jsonb(daily));
  insert into public.mood_focus_entries(user_id,date,mood,focus,note,note_source)
  values(auth.uid(),day,case when p?'mood' then p->>'mood' else daily.mood end,case when p?'focus' then p->>'focus' else daily.focus end,case when p?'note' then p->>'note' else daily.note end,case when p?'note' then case when p->>'note' is not null then 'codex' end else daily.note_source end)
  on conflict(user_id,date) do update set mood=excluded.mood,focus=excluded.focus,note=excluded.note,note_source=excluded.note_source,updated_at=now(),revision=public.mood_focus_entries.revision+1 returning to_jsonb(mood_focus_entries.*) into r;
 when 'create_attempt','update_attempt','delete_attempt' then
  select * into attempt from public.leetcode_attempts where id=rid and user_id=auth.uid() for update;
  perform manor_private.require_revision(attempt.revision,(p->>'expected_revision')::bigint,to_jsonb(attempt));
  if attempt.deleted_at is not null then raise exception 'Attempt was removed'; end if;
  if op='delete_attempt' then update public.leetcode_attempts set deleted_at=now(),revision=revision+1 where id=rid and user_id=auth.uid() returning to_jsonb(leetcode_attempts.*) into r;
  else
   if day>today or day is null then raise exception 'Attempt date must be today or a past date'; end if;
   if length(p->>'solution') not between 1 and 1000000 then raise exception 'Paste solution source between 1 and 1000000 characters'; end if;
   if op='create_attempt' then
    insert into public.leetcode_attempts(id,user_id,problem_id,date,solution) values(rid,auth.uid(),p->>'problem_id',day,p->>'solution') returning to_jsonb(leetcode_attempts.*) into r;
   else
    update public.leetcode_attempts set date=day,solution=p->>'solution',revision=revision+1,updated_at=now() where id=rid and user_id=auth.uid() returning to_jsonb(leetcode_attempts.*) into r;
   end if;
  end if;
 when 'save_mistake','delete_mistake' then
  select * into mistake from public.leetcode_notes where id=rid and user_id=auth.uid() for update;
  perform manor_private.require_revision(mistake.revision,(p->>'expected_revision')::bigint,to_jsonb(mistake));
  if mistake.deleted_at is not null then raise exception 'Mistake was removed'; end if;
  if op='delete_mistake' then update public.leetcode_notes set deleted_at=now(),revision=revision+1 where id=rid and user_id=auth.uid() returning to_jsonb(leetcode_notes.*) into r;
  else insert into public.leetcode_notes(id,user_id,text) values(rid,auth.uid(),p->>'text') on conflict(id) do update set text=excluded.text,revision=public.leetcode_notes.revision+1,updated_at=now() returning to_jsonb(leetcode_notes.*) into r;
  end if;
 when 'create_application','update_application','change_application_stage','trash_application','restore_application' then
  select * into application from public.job_roles where id=rid and user_id=auth.uid() for update;
  perform manor_private.require_revision(application.revision,(p->>'expected_revision')::bigint,to_jsonb(application));
  if application.deleted_at is not null and op<>'restore_application' then raise exception 'Restore the application before editing it'; end if;
  if op='create_application' then
   insert into public.job_roles(id,user_id,company,role,location,link,posted,stage,applied,oa_due,interview1,interview2,interview3,decision,resume_id,term)
   values(rid,auth.uid(),p->>'company',p->>'role',p->>'location',p->>'link',(p->>'posted')::date,p->>'stage',(p->>'applied')::date,(p->>'oa_due')::date,(p->>'interview1')::date,(p->>'interview2')::date,(p->>'interview3')::date,(p->>'decision')::date,(p->>'resume_id')::uuid,p->>'term') returning to_jsonb(job_roles.*) into r;
  elsif op in ('update_application','change_application_stage') then
   update public.job_roles set company=coalesce(p->>'company',company),role=coalesce(p->>'role',role),location=coalesce(p->>'location',location),link=coalesce(p->>'link',link),stage=coalesce(p->>'stage',stage),
    posted=case when p?'posted' then (p->>'posted')::date else posted end,
    applied=case when p?'applied' then (p->>'applied')::date else applied end,
    oa_due=case when p?'oa_due' then (p->>'oa_due')::date else oa_due end,
    interview1=case when p?'interview1' then (p->>'interview1')::date else interview1 end,
    interview2=case when p?'interview2' then (p->>'interview2')::date else interview2 end,
    interview3=case when p?'interview3' then (p->>'interview3')::date else interview3 end,
    decision=case when p?'decision' then (p->>'decision')::date else decision end,
    resume_id=case when p?'resume_id' then (p->>'resume_id')::uuid else resume_id end,
    term=case when p?'term' then p->>'term' else term end,revision=revision+1,updated_at=now()
    where id=rid and user_id=auth.uid() returning to_jsonb(job_roles.*) into r;
  elsif op='trash_application' then
   update public.job_roles set deleted_at=now(),revision=revision+1,updated_at=now() where id=rid and user_id=auth.uid() returning to_jsonb(job_roles.*) into r;
  else
   if application.deleted_at is null or application.deleted_at<=now()-interval '7 days' then raise exception 'Application is not recoverable from Trash'; end if;
   update public.job_roles set deleted_at=null,revision=revision+1,updated_at=now() where id=rid and user_id=auth.uid() returning to_jsonb(job_roles.*) into r;
  end if;
  if r->>'stage' is distinct from application.stage then insert into public.job_stage_transitions(id,user_id,role_id,from_stage,to_stage) values(gen_random_uuid()::text,auth.uid(),rid,application.stage,r->>'stage'); end if;
 when 'create_habit','update_habit','set_habit_status' then
  select * into habit from public.habits where id=rid and user_id=auth.uid() for update;
  perform manor_private.require_revision(habit.revision,(p->>'expected_revision')::bigint,to_jsonb(habit));
  if op='create_habit' then
   insert into public.habits(id,user_id,name,kind,target_label,created_on,position) values(rid,auth.uid(),p->>'name',p->>'kind',p->>'target_label',today,coalesce((p->>'position')::int,(select coalesce(max(position)+1,0) from public.habits where user_id=auth.uid()))) returning to_jsonb(habits.*) into r;
   insert into public.habit_lifecycle(user_id,habit_id,date,status) values(auth.uid(),rid,today,'active');
  elsif op='update_habit' then
   update public.habits set name=coalesce(p->>'name',name),kind=coalesce(p->>'kind',kind),target_label=case when p?'target_label' then p->>'target_label' else target_label end,position=coalesce((p->>'position')::int,position),revision=revision+1 where id=rid and user_id=auth.uid() returning to_jsonb(habits.*) into r;
  else
   insert into public.habit_lifecycle(user_id,habit_id,date,status) values(auth.uid(),rid,today,p->>'status') on conflict(habit_id,date) do update set status=excluded.status;
   update public.habits set revision=revision+1 where id=rid and user_id=auth.uid() returning to_jsonb(habits.*) into r;
  end if;
 when 'log_habit','clear_habit_entry' then
  if day not in (today,today-1) then raise exception 'Habits can only be logged today or yesterday'; end if;
  select * into habit from public.habits where id=rid and user_id=auth.uid();
  if habit.id is null or habit.created_on>day or coalesce((select status from public.habit_lifecycle where habit_id=rid and user_id=auth.uid() and date<=day order by date desc limit 1),'active')<>'active' then raise exception 'Habit is not active on this date'; end if;
  select * into entry from public.habit_entries where habit_id=rid and date=day and user_id=auth.uid() for update;
  perform manor_private.require_revision(entry.revision,(p->>'expected_revision')::bigint,to_jsonb(entry));
  if op='clear_habit_entry' then delete from public.habit_entries where habit_id=rid and date=day and user_id=auth.uid() returning to_jsonb(habit_entries.*) into r;
  else
   if habit.kind='binary' and (p->>'value')::int<>100 then raise exception 'Binary habits can only be completed'; end if;
   insert into public.habit_entries(user_id,habit_id,date,value) values(auth.uid(),rid,day,(p->>'value')::int) on conflict(habit_id,date) do update set value=excluded.value,revision=public.habit_entries.revision+1,updated_at=now() returning to_jsonb(habit_entries.*) into r;
   if (p->>'value')::int=100 then delete from public.habit_freeze_intents where habit_id=rid and date=day and user_id=auth.uid(); delete from public.habit_freeze_usage where habit_id=rid and date=day and user_id=auth.uid(); end if;
  end if;
 when 'save_capture' then
  select * into capture from public.kb_entries where id=rid::uuid and user_id=auth.uid() for update;
  perform manor_private.require_revision(capture.revision,(p->>'expected_revision')::bigint,to_jsonb(capture));
  insert into public.kb_entries(id,user_id,source,url,title,author,summary,content_md,status,normalized_at) values(rid::uuid,auth.uid(),'capture',p->>'url',p->>'title',p->>'author',p->>'summary',p->>'content_md','normalized',now())
  on conflict(id) do update set url=excluded.url,title=excluded.title,author=excluded.author,summary=excluded.summary,content_md=excluded.content_md,revision=public.kb_entries.revision+1 returning to_jsonb(kb_entries.*) into r;
 when 'save_weekly_review' then
  select * into review from public.weekly_reviews where id=rid and user_id=auth.uid() for update;
  perform manor_private.require_revision(review.revision,(p->>'expected_revision')::bigint,to_jsonb(review));
  if not exists(select 1 from pg_timezone_names where name=p->>'timezone') then raise exception 'Unknown review timezone'; end if;
  if (p->>'period_end')::timestamptz>now() or ((p->>'period_end')::timestamptz at time zone (p->>'timezone'))-((p->>'period_start')::timestamptz at time zone (p->>'timezone'))<>interval '7 days' or extract(dow from ((p->>'period_end')::timestamptz at time zone (p->>'timezone')))<>0 or ((p->>'period_end')::timestamptz at time zone (p->>'timezone'))::time<>'22:00'::time then raise exception 'Review period must cover Sunday 22:00 to Sunday 22:00 in its saved timezone'; end if;
  if (p->>'input_watermark')::bigint>(select coalesce(max(id),0) from public.action_events where user_id=auth.uid()) then raise exception 'Review watermark exceeds account history'; end if;
  insert into public.weekly_reviews(id,user_id,period_start,period_end,input_watermark,content,model,timezone,title) values(rid,auth.uid(),(p->>'period_start')::timestamptz,(p->>'period_end')::timestamptz,(p->>'input_watermark')::bigint,p->>'content',p->>'model',p->>'timezone',p->>'title') on conflict(id) do update set content=excluded.content,model=excluded.model,input_watermark=excluded.input_watermark,title=excluded.title,revision=public.weekly_reviews.revision+1,updated_at=now() returning to_jsonb(weekly_reviews.*) into r;
 else raise exception 'Unsupported domain operation: %',op;
 end case;
 if r is null then raise exception using errcode='P0002',message='Record does not exist or is not owned by this account'; end if;
 return r;
end $$;
alter function manor_private.domain_command(text,jsonb) owner to manor_commands;
revoke all on function manor_private.domain_command(text,jsonb) from public;
