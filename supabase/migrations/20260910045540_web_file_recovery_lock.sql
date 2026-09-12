-- The backup holds the matching shared session lock until its immutable bytes are copied.
create function manor_private.lock_file_recovery() returns trigger language plpgsql set search_path='' as $$
begin
 if old.status='ready' and (tg_op='DELETE' or new.status is distinct from 'ready') then
  perform pg_advisory_xact_lock(hashtextextended('manor-file-recovery',0));
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function manor_private.lock_file_recovery() from public,anon,authenticated;
create trigger file_recovery_before_removal before update or delete on public.file_objects for each row execute function manor_private.lock_file_recovery();
