-- Catalog listings carry every office a posting hires for, and adding one copies that list whole;
-- the 160-character cap written for hand-typed locations rejected the longer ones.
alter table public.job_roles drop constraint if exists job_roles_location_check;
alter table public.job_roles add constraint job_roles_location_check check (char_length(location) <= 1000);

-- Roles added from the catalog before terms were copied, or recorded before the column existed,
-- take their hiring cycle from the listing they point at. The audit trigger requires a command
-- context, so the backfill runs as one maintenance command.
do $$
begin
 perform set_config('manor.command_id',gen_random_uuid()::text,true);
 perform set_config('manor.operation','backfill_job_role_terms',true);
 perform set_config('manor.actor','background',true);
 update public.job_roles r
 set term=l.term, revision=r.revision+1, updated_at=now()
 from public.job_listings l
 where l.url=r.link and r.term is null and l.term<>'';
end $$;
