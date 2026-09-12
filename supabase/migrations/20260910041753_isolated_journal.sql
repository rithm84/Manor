-- Journal ciphertext only. No Manor command catalog, event history, worker, or search integration.
create schema journal_private;
revoke all on schema journal_private from public;
grant usage on schema journal_private to authenticated;
create table journal_private.keyrings (
 user_id uuid primary key references auth.users(id) on delete cascade,
 envelope jsonb not null, revision bigint not null check(revision>0),
 updated_at timestamptz not null default now()
);
create table journal_private.entries (
 user_id uuid not null references auth.users(id) on delete cascade, date date not null,
 envelope jsonb, revision bigint not null check(revision>0), updated_at timestamptz not null default now(),
 primary key(user_id,date)
);
alter table journal_private.keyrings enable row level security;
alter table journal_private.entries enable row level security;
-- No direct table grants. SECURITY DEFINER helpers enforce the owner and reject remote OAuth clients.
create function journal_private.require_browser_owner() returns uuid language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.jwt()->>'client_id' is not null then raise exception 'Journal requires its own signed-in browser session'; end if;
 if not exists(select 1 from public.profiles where user_id=auth.uid()) then raise exception 'Complete Manor account setup before opening Journal'; end if;
 return auth.uid();
end $$;
create function journal_private.read_state() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid:=journal_private.require_browser_owner(); result jsonb;
begin
 select jsonb_build_object('keyring',(select jsonb_build_object('envelope',envelope,'revision',revision) from journal_private.keyrings where user_id=owner_id),
 'entries',(select coalesce(jsonb_agg(jsonb_build_object('date',date,'envelope',envelope,'revision',revision) order by date desc),'[]'::jsonb) from journal_private.entries where user_id=owner_id),
 'timezone',(select timezone from public.profiles where user_id=owner_id)) into result;
 return result;
end $$;
create function journal_private.save_keyring(p_envelope jsonb,p_expected_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=journal_private.require_browser_owner(); current_row journal_private.keyrings; clean jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':journal-keyring',0));
 if p_envelope->>'version' is distinct from '1' or p_envelope->>'kdf' is distinct from 'PBKDF2-SHA256' or p_envelope->>'iterations' is distinct from '600000' or
  octet_length(decode(p_envelope->>'salt','base64'))<>32 or octet_length(decode(p_envelope->>'nonce','base64'))<>12 or octet_length(decode(p_envelope->>'wrappedKey','base64'))<>48 then raise exception 'Invalid encrypted Journal key parameters'; end if;
 clean:=jsonb_build_object('version',1,'kdf','PBKDF2-SHA256','iterations',600000,'salt',p_envelope->>'salt','nonce',p_envelope->>'nonce','wrappedKey',p_envelope->>'wrappedKey');
 if clean->>'salt' is null or clean->>'nonce' is null or clean->>'wrappedKey' is null then raise exception 'Journal key fields are required'; end if;
 select * into current_row from journal_private.keyrings where user_id=owner_id for update;
 if current_row.revision=p_expected_revision+1 and current_row.envelope=clean then return jsonb_build_object('envelope',current_row.envelope,'revision',current_row.revision); end if;
 if p_expected_revision is null or coalesce(current_row.revision,0)<>p_expected_revision then raise exception using errcode='PT409',message='Journal passphrase settings changed. Lock and unlock again before retrying.'; end if;
 insert into journal_private.keyrings(user_id,envelope,revision) values(owner_id,clean,p_expected_revision+1)
 on conflict(user_id) do update set envelope=excluded.envelope,revision=excluded.revision,updated_at=now();
 return jsonb_build_object('envelope',clean,'revision',p_expected_revision+1);
end $$;
create function journal_private.save_entry(p_date date,p_envelope jsonb,p_expected_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
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
 on conflict(user_id,date) do update set envelope=excluded.envelope,revision=excluded.revision,updated_at=now();
 return jsonb_build_object('date',p_date,'envelope',clean,'revision',p_expected_revision+1);
end $$;
create function journal_private.delete_entry(p_date date,p_expected_revision bigint,p_confirm boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=journal_private.require_browser_owner(); current_row journal_private.entries;
begin
 if p_confirm is distinct from true then raise exception 'Confirm permanent deletion in Journal'; end if;
 select * into current_row from journal_private.entries where user_id=owner_id and date=p_date for update;
 if current_row.envelope is null and current_row.revision=p_expected_revision+1 then return jsonb_build_object('date',p_date,'envelope',null,'revision',current_row.revision); end if;
 if current_row.user_id is null or current_row.envelope is null or p_expected_revision is null or current_row.revision<>p_expected_revision then raise exception using errcode='PT409',message='This Journal day changed. Reopen it before deleting.'; end if;
 -- Keep only the revision tombstone so stale clients cannot resurrect deleted ciphertext.
 update journal_private.entries set envelope=null,revision=revision+1,updated_at=now() where user_id=owner_id and date=p_date;
 return jsonb_build_object('date',p_date,'envelope',null,'revision',p_expected_revision+1);
end $$;
revoke all on all functions in schema journal_private from public;
grant execute on function journal_private.read_state(),journal_private.save_keyring(jsonb,bigint),journal_private.save_entry(date,jsonb,bigint),journal_private.delete_entry(date,bigint,boolean) to authenticated;
create function public.journal_read_state() returns jsonb language sql security invoker set search_path='' as $$ select journal_private.read_state() $$;
create function public.journal_save_keyring(p_envelope jsonb,p_expected_revision bigint) returns jsonb language sql security invoker set search_path='' as $$ select journal_private.save_keyring(p_envelope,p_expected_revision) $$;
create function public.journal_save_entry(p_date date,p_envelope jsonb,p_expected_revision bigint) returns jsonb language sql security invoker set search_path='' as $$ select journal_private.save_entry(p_date,p_envelope,p_expected_revision) $$;
create function public.journal_delete_entry(p_date date,p_expected_revision bigint,p_confirm boolean) returns jsonb language sql security invoker set search_path='' as $$ select journal_private.delete_entry(p_date,p_expected_revision,p_confirm) $$;
revoke all on function public.journal_read_state(),public.journal_save_keyring(jsonb,bigint),public.journal_save_entry(date,jsonb,bigint),public.journal_delete_entry(date,bigint,boolean) from public,anon;
grant execute on function public.journal_read_state(),public.journal_save_keyring(jsonb,bigint),public.journal_save_entry(date,jsonb,bigint),public.journal_delete_entry(date,bigint,boolean) to authenticated;
