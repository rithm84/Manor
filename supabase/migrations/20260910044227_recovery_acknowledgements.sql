alter table public.kb_entries add column if not exists deleted_at timestamptz;
-- Content-free purge intent is independently snapshotted before physical deletion.
alter table manor_private.purge_tombstones add column if not exists series_id text;
alter table manor_private.purge_tombstones add column if not exists occurrence_date date;
alter table manor_private.purge_tombstones add column if not exists parent_folder_id text;
create table manor_private.recovery_acknowledgements (
 user_id uuid not null,object_type text not null,object_id text not null,purged_at timestamptz not null,
 snapshot_id text not null check(snapshot_id ~ '^[a-f0-9]{64}$'),acknowledged_at timestamptz not null default clock_timestamp(),
 primary key(user_id,object_type,object_id),
 foreign key(user_id,object_type,object_id) references manor_private.purge_tombstones(user_id,object_type,object_id)
);
alter table manor_private.recovery_acknowledgements enable row level security;
revoke all on manor_private.recovery_acknowledgements from public,anon,authenticated;
create function public.manor_prepare_purge() returns integer language plpgsql security definer set search_path='' as $$
declare inserted int;
begin
 insert into manor_private.purge_tombstones(user_id,object_type,object_id,series_id,occurrence_date)
 select user_id,'tasks',id,series_id,occurrence_date from public.tasks where deleted_at<=now()-interval '7 days'
 union all select user_id,'job_roles',id,null,null from public.job_roles where deleted_at<=now()-interval '7 days'
 union all select user_id,'note_pages',id,null,null from public.note_pages where deleted_at<=now()-interval '7 days'
 union all select user_id,'kb_entries',id::text,null,null from public.kb_entries where deleted_at is not null
 union all select user_id,'leetcode_attempts',id,null,null from public.leetcode_attempts where to_jsonb(leetcode_attempts)->>'deleted_at' is not null
 union all select user_id,'leetcode_notes',id,null,null from public.leetcode_notes where to_jsonb(leetcode_notes)->>'deleted_at' is not null
 union all select user_id,'note_folders',id,null,null from public.note_folders where to_jsonb(note_folders)->>'deleted_at' is not null
 union all select user_id,'file_objects',id::text,null,null from public.file_objects where status='purging'
 on conflict do nothing;
 get diagnostics inserted=row_count;
 update manor_private.purge_tombstones t set parent_folder_id=f.parent_folder_id from public.note_folders f where t.user_id=f.user_id and t.object_type='note_folders' and t.object_id=f.id;
 return inserted;
end $$;
create function public.manor_acknowledge_recovery(p_snapshot_id text,p_ledger jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare accepted int;
begin
 if p_snapshot_id !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_ledger) is distinct from 'array' then raise exception 'A verified independent ledger snapshot is required'; end if;
 insert into manor_private.recovery_acknowledgements(user_id,object_type,object_id,purged_at,snapshot_id)
 select t.user_id,t.object_type,t.object_id,t.purged_at,p_snapshot_id
 from jsonb_to_recordset(p_ledger) as e(user_id uuid,object_type text,object_id text,purged_at timestamptz)
 join manor_private.purge_tombstones t on t.user_id=e.user_id and t.object_type=e.object_type and t.object_id=e.object_id and t.purged_at=e.purged_at
 on conflict(user_id,object_type,object_id) do update set purged_at=excluded.purged_at,snapshot_id=excluded.snapshot_id,acknowledged_at=clock_timestamp();
 get diagnostics accepted=row_count;
 if accepted<>jsonb_array_length(p_ledger) then raise exception 'Deletion ledger changed while its backup was acknowledged'; end if;
 update journal_private.entries e set envelope=null where e.deleted_at is not null and exists(select 1 from manor_private.recovery_acknowledgements a where a.user_id=e.user_id and a.object_type='journal_entries' and a.object_id=e.date::text||':'||e.revision::text);
 return accepted;
end $$;
revoke all on function public.manor_prepare_purge(),public.manor_acknowledge_recovery(text,jsonb) from public,anon,authenticated;
grant execute on function public.manor_prepare_purge(),public.manor_acknowledge_recovery(text,jsonb) to service_role;
create or replace function public.manor_purge_expired() returns integer language plpgsql security definer set search_path='' as $$
declare item record; total int:=0; review_key text;
begin
 for item in select t.object_type as kind,t.object_id as id,t.user_id from manor_private.purge_tombstones t join manor_private.recovery_acknowledgements a using(user_id,object_type,object_id) where t.object_type in ('tasks','job_roles','note_pages','kb_entries','leetcode_attempts','leetcode_notes','note_folders') and a.purged_at=t.purged_at and ((t.object_type='tasks' and exists(select 1 from public.tasks x where x.user_id=t.user_id and x.id=t.object_id)) or (t.object_type='job_roles' and exists(select 1 from public.job_roles x where x.user_id=t.user_id and x.id=t.object_id)) or (t.object_type='note_pages' and exists(select 1 from public.note_pages x where x.user_id=t.user_id and x.id=t.object_id)) or (t.object_type='kb_entries' and exists(select 1 from public.kb_entries x where x.user_id=t.user_id and x.id=t.object_id::uuid)) or (t.object_type='leetcode_attempts' and exists(select 1 from public.leetcode_attempts x where x.user_id=t.user_id and x.id=t.object_id)) or (t.object_type='leetcode_notes' and exists(select 1 from public.leetcode_notes x where x.user_id=t.user_id and x.id=t.object_id)) or (t.object_type='note_folders' and exists(select 1 from public.note_folders x where x.user_id=t.user_id and x.id=t.object_id))) order by t.user_id,t.object_id limit 500 loop
  perform pg_advisory_xact_lock(hashtextextended(item.user_id::text,0));
  perform set_config('manor.command_id',gen_random_uuid()::text,true);
  perform set_config('manor.operation','purge_expired',true);
  for review_key in select review_id from manor_private.review_sources where user_id=item.user_id and object_type=item.kind and object_id=item.id loop
   delete from public.weekly_reviews where user_id=item.user_id and id=review_key;
   update public.action_events set changes=jsonb_build_object('purged',true),provenance=null,object_id=null,scrubbed_at=now() where user_id=item.user_id and object_type='weekly_reviews' and object_id=review_key;
   update manor_private.command_receipts set response=jsonb_build_object('command_id',command_id,'operation',operation,'purged',true) where user_id=item.user_id and response->'record'->>'id'=review_key;
  end loop;
  if item.kind='tasks' then
   delete from public.tasks where user_id=item.user_id and id=item.id;
  elsif item.kind='job_roles' then
   delete from public.job_roles where user_id=item.user_id and id=item.id;
  elsif item.kind='leetcode_attempts' then delete from public.leetcode_attempts where user_id=item.user_id and id=item.id;
  elsif item.kind='leetcode_notes' then delete from public.leetcode_notes where user_id=item.user_id and id=item.id;
  elsif item.kind='note_folders' then delete from public.note_folders where user_id=item.user_id and id=item.id;
  elsif item.kind='kb_entries' then
   update public.file_objects set status='purging',name='Deleted file' where user_id=item.user_id and purpose='capture' and parent_id=item.id;
   delete from public.kb_entries where user_id=item.user_id and id=item.id::uuid;
  else
   update public.file_objects set status='purging',name='Deleted file' where user_id=item.user_id and purpose='note' and parent_id=item.id;
   delete from public.note_pages where user_id=item.user_id and id=item.id;
  end if;
  update public.action_events set changes=jsonb_build_object('purged',true),provenance=null,object_id=null,scrubbed_at=now() where user_id=item.user_id and ((object_type=item.kind and object_id=item.id) or (object_type='scratch_blocks' and (changes->'task_id'->>'before'=item.id or changes->'task_id'->>'after'=item.id)) or (object_type='note_suggestions' and changes::text like '%'||item.id||'%'));
  update manor_private.command_receipts set response=jsonb_build_object('command_id',command_id,'operation',operation,'purged',true) where user_id=item.user_id and response::text like '%'||to_jsonb(item.id)::text||'%';
  total:=total+1;
 end loop;
 return total;
end $$;
revoke all on function public.manor_purge_expired() from public,anon,authenticated;
grant execute on function public.manor_purge_expired() to service_role;

-- Journal keeps ciphertext hidden until its deletion intent has an independent recovery copy.
alter table journal_private.entries add column deleted_at timestamptz;
create or replace function journal_private.read_state() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid:=journal_private.require_browser_owner(); result jsonb;
begin
 select jsonb_build_object('keyring',(select jsonb_build_object('envelope',envelope,'revision',revision) from journal_private.keyrings where user_id=owner_id),
 'entries',(select coalesce(jsonb_agg(jsonb_build_object('date',date,'envelope',case when deleted_at is null then envelope else null end,'revision',revision) order by date desc),'[]'::jsonb) from journal_private.entries where user_id=owner_id),
 'timezone',(select timezone from public.profiles where user_id=owner_id)) into result;
 return result;
end $$;
create or replace function journal_private.save_entry(p_date date,p_envelope jsonb,p_expected_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=journal_private.require_browser_owner(); current_row journal_private.entries; clean jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':journal:'||p_date::text,0));
 if p_date is null or p_expected_revision is null or p_expected_revision<0 then raise exception 'A Journal date and revision are required'; end if;
 if not exists(select 1 from journal_private.keyrings where user_id=owner_id) then raise exception 'Set up the Journal passphrase first'; end if;
 if p_envelope->>'version' is distinct from '1' or octet_length(decode(p_envelope->>'nonce','base64'))<>12 or octet_length(decode(p_envelope->>'ciphertext','base64')) not between 16 and 1048592 then raise exception 'Invalid Journal ciphertext'; end if;
 clean:=jsonb_build_object('version',1,'nonce',p_envelope->>'nonce','ciphertext',p_envelope->>'ciphertext');
 if clean->>'nonce' is null or clean->>'ciphertext' is null then raise exception 'Journal ciphertext fields are required'; end if;
 select * into current_row from journal_private.entries where user_id=owner_id and date=p_date for update;
 if current_row.revision=p_expected_revision+1 and current_row.envelope=clean then return jsonb_build_object('date',p_date,'envelope',clean,'revision',current_row.revision); end if;
 if coalesce(current_row.revision,0)<>p_expected_revision then raise exception using errcode='PT409',message='This Journal day changed elsewhere. Your unsaved text remains open.'; end if;
 insert into journal_private.entries(user_id,date,envelope,revision) values(owner_id,p_date,clean,p_expected_revision+1)
 on conflict(user_id,date) do update set envelope=excluded.envelope,revision=excluded.revision,updated_at=now(),deleted_at=null;
 return jsonb_build_object('date',p_date,'envelope',clean,'revision',p_expected_revision+1);
end $$;
create or replace function journal_private.delete_entry(p_date date,p_expected_revision bigint,p_confirm boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=journal_private.require_browser_owner(); current_row journal_private.entries;
begin
 if p_confirm is distinct from true then raise exception 'Confirm permanent deletion in Journal'; end if;
 select * into current_row from journal_private.entries where user_id=owner_id and date=p_date for update;
 if current_row.deleted_at is not null and current_row.revision=p_expected_revision+1 then return jsonb_build_object('date',p_date,'envelope',null,'revision',current_row.revision); end if;
 if current_row.user_id is null or current_row.envelope is null or p_expected_revision is null or current_row.revision<>p_expected_revision then raise exception using errcode='PT409',message='This Journal day changed. Reopen it before deleting.'; end if;
 -- Keep only the revision tombstone so stale clients cannot resurrect deleted ciphertext.
 update journal_private.entries set deleted_at=clock_timestamp(),revision=revision+1,updated_at=now() where user_id=owner_id and date=p_date;
 insert into manor_private.purge_tombstones(user_id,object_type,object_id) values(owner_id,'journal_entries',p_date::text||':'||(p_expected_revision+1)::text) on conflict do nothing;
 return jsonb_build_object('date',p_date,'envelope',null,'revision',p_expected_revision+1);
end $$;

-- Only the isolated recovery operator executes this before restoring file bytes or enabling access.
create function public.manor_reconcile_recovery(p_ledger jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare item record; removed int:=0; review_key text;
begin
 if current_setting('manor.recovery_isolated',true) is distinct from 'yes' then raise exception 'Enable the isolated recovery session guard first'; end if;
 for item in select * from jsonb_to_recordset(p_ledger) as e(user_id uuid,object_type text,object_id text,purged_at timestamptz,series_id text,occurrence_date date,parent_folder_id text) loop
  insert into manor_private.purge_tombstones(user_id,object_type,object_id,purged_at,series_id,occurrence_date,parent_folder_id) values(item.user_id,item.object_type,item.object_id,item.purged_at,item.series_id,item.occurrence_date,item.parent_folder_id) on conflict do nothing;
  perform set_config('manor.command_id',gen_random_uuid()::text,true);
  perform set_config('manor.operation','recovery_purge',true);
  for review_key in select review_id from manor_private.review_sources where user_id=item.user_id and object_type=item.object_type and object_id=item.object_id loop
   delete from public.weekly_reviews where user_id=item.user_id and id=review_key;
   update public.action_events set changes='{}',provenance=null,object_id=null,scrubbed_at=now() where user_id=item.user_id and object_type='weekly_reviews' and object_id=review_key;
   update manor_private.command_receipts set response=jsonb_build_object('purged',true) where user_id=item.user_id and response->'record'->>'id'=review_key;
  end loop;
  if item.object_type='tasks' then delete from public.tasks where user_id=item.user_id and id=item.object_id;
  elsif item.object_type='job_roles' then delete from public.job_roles where user_id=item.user_id and id=item.object_id;
  elsif item.object_type='leetcode_attempts' then delete from public.leetcode_attempts where user_id=item.user_id and id=item.object_id;
  elsif item.object_type='leetcode_notes' then delete from public.leetcode_notes where user_id=item.user_id and id=item.object_id;
  elsif item.object_type='note_folders' then
   update public.note_pages set folder_id=case when exists(select 1 from public.note_folders f where f.user_id=item.user_id and f.id=item.parent_folder_id) then item.parent_folder_id end where user_id=item.user_id and folder_id=item.object_id;
   update public.note_folders set parent_folder_id=case when exists(select 1 from public.note_folders f where f.user_id=item.user_id and f.id=item.parent_folder_id) then item.parent_folder_id end where user_id=item.user_id and parent_folder_id=item.object_id;
   delete from public.note_folders where user_id=item.user_id and id=item.object_id;
  elsif item.object_type='note_pages' then
   update public.file_objects set status='purging',name='Deleted file' where user_id=item.user_id and purpose='note' and parent_id=item.object_id;
   delete from public.note_pages where user_id=item.user_id and id=item.object_id;
  elsif item.object_type='kb_entries' then
   update public.file_objects set status='purging',name='Deleted file' where user_id=item.user_id and purpose='capture' and parent_id=item.object_id;
   delete from public.kb_entries where user_id=item.user_id and id=item.object_id::uuid;
  elsif item.object_type='file_objects' then
   update public.job_roles set resume_id=null where user_id=item.user_id and resume_id=item.object_id::uuid;
   delete from public.resumes where user_id=item.user_id and id=item.object_id::uuid;
   delete from public.note_attachments where user_id=item.user_id and id=item.object_id::uuid;
   update public.profiles set settings=settings-'avatar_file_id' where user_id=item.user_id and settings->>'avatar_file_id'=item.object_id;
   update public.kb_entries set screenshot_path=null where user_id=item.user_id and screenshot_path=(select storage_path from public.file_objects where user_id=item.user_id and id=item.object_id::uuid);
   update public.file_objects set status='purging',name='Deleted file' where user_id=item.user_id and id=item.object_id::uuid;
   update public.action_events set changes='{}',provenance=null,object_id=null,scrubbed_at=now() where user_id=item.user_id and object_type in ('resumes','note_attachments','file_objects') and object_id=item.object_id;
  elsif item.object_type='journal_entries' then
   update journal_private.entries set envelope=null,deleted_at=coalesce(deleted_at,item.purged_at),revision=greatest(revision,split_part(item.object_id,':',2)::bigint) where user_id=item.user_id and date=split_part(item.object_id,':',1)::date and revision<=split_part(item.object_id,':',2)::bigint;
  else raise exception 'Unsupported recovery tombstone type: %',item.object_type;
  end if;
  update public.action_events set changes=jsonb_build_object('purged',true),provenance=null,object_id=null,scrubbed_at=now() where user_id=item.user_id and ((object_type=item.object_type and object_id=item.object_id) or (object_type='scratch_blocks' and (changes->'task_id'->>'before'=item.object_id or changes->'task_id'->>'after'=item.object_id)) or (object_type='note_suggestions' and changes::text like '%'||item.object_id||'%'));
  update manor_private.command_receipts set response=jsonb_build_object('command_id',command_id,'operation',operation,'purged',true) where user_id=item.user_id and response::text like '%'||to_jsonb(item.object_id)::text||'%';
  removed:=removed+1;
 end loop;
 return removed;
end $$;
revoke all on function public.manor_reconcile_recovery(jsonb) from public,anon,authenticated,service_role;

create or replace function manor_private.materialize_series(series_key text) returns void language plpgsql set search_path='' as $$
declare s public.task_series; day date; horizon date:=manor_private.today()+90; context_name text;
begin
 select * into s from public.task_series where id=series_key and user_id=auth.uid() for update;
 if s.id is null then raise exception 'Recurrence series is unavailable'; end if;
 if s.starts_on<manor_private.today()-1826 then raise exception 'Recurrence catch-up exceeds five years; reconcile the older series explicitly'; end if;
 select name into context_name from public.contexts where user_id=auth.uid() and id=s.context_id;
 for day in select generate_series(coalesce(s.materialized_through+1,s.starts_on),least(horizon,coalesce(s.ends_before-1,horizon)),interval '1 day')::date loop
  if manor_private.rule_matches(s.rule,s.starts_on,day) and not exists(select 1 from manor_private.purge_tombstones t where t.user_id=auth.uid() and t.object_type='tasks' and t.series_id=s.id and t.occurrence_date=day) then
   insert into public.tasks(id,user_id,title,context,context_id,estimate_minutes,priority,status,due,tags,recurrence,series_id,occurrence_date)
   values(case when day=s.starts_on then s.id else gen_random_uuid()::text end,auth.uid(),s.title,context_name,s.context_id,s.estimate_minutes,s.priority,'Not started',day,s.tags,s.rule,s.id,day)
   on conflict(user_id,series_id,occurrence_date) do nothing;
  end if;
 end loop;
 update public.task_series set materialized_through=horizon where id=s.id and user_id=auth.uid();
end $$;
