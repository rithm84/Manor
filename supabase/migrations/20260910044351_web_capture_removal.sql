alter table public.kb_entries add column if not exists deleted_at timestamptz;
create policy active_capture_read on public.kb_entries as restrictive for select to authenticated
 using (deleted_at is null or current_user='manor_commands');
