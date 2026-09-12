-- Permanent removals hide immediately; independent ledger acknowledgement precedes physical purge.
alter table public.leetcode_attempts add column deleted_at timestamptz;
alter table public.leetcode_notes add column deleted_at timestamptz;
alter table public.note_folders add column deleted_at timestamptz;
do $$ declare t text; begin
 foreach t in array array['leetcode_attempts','leetcode_notes','note_folders'] loop
 execute format('create policy active_record_read on public.%I as restrictive for select to authenticated using(deleted_at is null or current_user=''manor_commands'')',t);
 end loop;
end $$;
