-- An editor lease belongs to the account's sandbox, not to the problem it last opened. Deleting that problem clears
-- the lease's problem instead of deleting the lease, so the sandbox it names is still expired and deleted on schedule.
begin;
alter table manor_private.problem_editor_sessions drop constraint problem_editor_sessions_problem_id_fkey;
alter table manor_private.problem_editor_sessions add constraint problem_editor_sessions_problem_id_fkey foreign key(problem_id) references public.leetcode_problems(id) on delete set null;
commit;
