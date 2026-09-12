begin;
insert into auth.users(id,aud,role,email,created_at,updated_at) values('33333333-3333-4333-8333-333333333333','authenticated','authenticated','mcp-test@example.invalid',now(),now()),('44444444-4444-4444-8444-444444444444','authenticated','authenticated','journal-other@example.invalid',now(),now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}',true);
select public.manor_command('30000000-0000-4000-8000-000000000001','save_profile','{"name":"Synthetic MCP","timezone":"America/Los_Angeles","settings":{},"expected_revision":0}');
select public.manor_authorize_mcp_client('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
select public.journal_save_keyring(jsonb_build_object('version',1,'kdf','PBKDF2-SHA256','iterations',600000,'salt',encode(decode(repeat('01',32),'hex'),'base64'),'nonce',encode(decode(repeat('02',12),'hex'),'base64'),'wrappedKey',encode(decode(repeat('03',48),'hex'),'base64')),0);
select public.journal_save_entry('2026-09-09',jsonb_build_object('version',1,'nonce',encode(decode(repeat('04',12),'hex'),'base64'),'ciphertext',encode(decode(repeat('05',32),'hex'),'base64')),0);
do $$begin
 if jsonb_array_length(public.journal_read_state()->'entries')<>1 then raise exception 'Journal owner read failed'; end if;
 begin
  perform public.journal_save_entry('2026-09-09',jsonb_build_object('version',1,'nonce',encode(decode(repeat('06',12),'hex'),'base64'),'ciphertext',encode(decode(repeat('07',32),'hex'),'base64')),0);
  raise exception 'Journal stale revision was accepted';
 exception when sqlstate 'PT409' then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","client_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}',true);
do $$begin
 if public.manor_mcp_access()->>'read'<>'true' or public.manor_mcp_access()->>'write'<>'false' then raise exception 'Read-only scope was not enforced'; end if;
 begin
  perform public.manor_command('30000000-0000-4000-8000-000000000002','save_profile','{"name":"disallowed","timezone":"America/Los_Angeles","settings":{},"expected_revision":1}');
  raise exception 'Read-only MCP bypassed the command boundary';
 exception when insufficient_privilege then null; end;
 begin
  perform public.journal_read_state();
  raise exception using errcode='XX000',message='Remote client could read Journal';
 exception when raise_exception then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}',true);
select public.manor_revoke_mcp_client('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","client_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}',true);
do $$begin if exists(select 1 from public.profiles) then raise exception 'Revoked MCP client could read account data'; end if; end $$;
select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}',true);
select public.manor_command('40000000-0000-4000-8000-000000000001','save_profile','{"name":"Other Journal","timezone":"America/Los_Angeles","settings":{},"expected_revision":0}');
do $$begin if jsonb_array_length(public.journal_read_state()->'entries')<>0 then raise exception 'Journal leaked another owner ciphertext'; end if; end $$;
rollback;
