begin;
insert into auth.users(id,aud,role,email,created_at,updated_at) values('99999999-9999-4999-8999-999999999999','authenticated','authenticated','removals@example.invalid',now(),now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"99999999-9999-4999-8999-999999999999","role":"authenticated"}',true);
select public.manor_command(gen_random_uuid(),'save_profile','{"name":"Removal test","timezone":"America/Los_Angeles","settings":{},"expected_revision":0}');
select public.manor_command(gen_random_uuid(),'create_attempt',jsonb_build_object('id','removed-attempt','problem_id','neetcode-1-1','date',(now() at time zone 'America/Los_Angeles')::date,'solution','synthetic solution','expected_revision',0));
select public.manor_command(gen_random_uuid(),'save_mistake','{"id":"removed-mistake","text":"synthetic mistake","expected_revision":0}');
select public.manor_command(gen_random_uuid(),'create_note_folder','{"id":"removed-folder","name":"Synthetic folder","expected_revision":0}');
select public.manor_command(gen_random_uuid(),'create_note','{"id":"lifted-page","title":"Synthetic page","folder_id":"removed-folder","content_json":[],"expected_revision":0}');
select public.manor_command(gen_random_uuid(),'delete_attempt','{"id":"removed-attempt","expected_revision":1}');
select public.manor_command(gen_random_uuid(),'delete_mistake','{"id":"removed-mistake","expected_revision":1}');
select public.manor_command(gen_random_uuid(),'remove_note_folder','{"id":"removed-folder","expected_revision":1}');
do $$begin
 if exists(select 1 from public.leetcode_attempts where id='removed-attempt') or exists(select 1 from public.leetcode_notes where id='removed-mistake') or exists(select 1 from public.note_folders where id='removed-folder') then raise exception 'Removed records remained visible'; end if;
 if not exists(select 1 from public.note_pages where id='lifted-page' and folder_id is null) then raise exception 'Folder removal did not preserve and lift contents'; end if;
end $$;
reset role;
select public.manor_prepare_purge();
select public.manor_purge_expired();
do $$begin if not exists(select 1 from public.leetcode_attempts where id='removed-attempt') then raise exception 'Attempt was physically deleted without acknowledgement'; end if; end $$;
select public.manor_acknowledge_recovery(repeat('b',64),(select jsonb_agg(to_jsonb(t)) from manor_private.purge_tombstones t where user_id='99999999-9999-4999-8999-999999999999'));
select public.manor_purge_expired();
do $$begin
 if exists(select 1 from public.leetcode_attempts where id='removed-attempt') or exists(select 1 from public.leetcode_notes where id='removed-mistake') or exists(select 1 from public.note_folders where id='removed-folder') then raise exception 'Acknowledged removals were retained'; end if;
 if exists(select 1 from public.action_events where user_id='99999999-9999-4999-8999-999999999999' and object_id in ('removed-attempt','removed-mistake','removed-folder')) then raise exception 'Removed object history was not scrubbed'; end if;
end $$;
rollback;
