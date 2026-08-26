-- Local ids are app-generated strings ('task-airtel', 'habit-morning',
-- 'job-anthropic', 'imported-neetcode-1-1', 'note-<uuid>'), not guaranteed
-- uuids. Convert the pk/fk columns those ids land in to text so full-module
-- sync can mirror local state verbatim. Columns that stay uuid because the
-- ids are cloud-generated: resumes.id, note_attachments.id,
-- job_roles.resume_id, and every user_id.

-- Home: tasks, scratch blocks, saved task views
alter table scratch_blocks drop constraint scratch_blocks_task_id_fkey;
alter table tasks alter column id drop default;
alter table tasks alter column id type text using id::text;
alter table scratch_blocks alter column id drop default;
alter table scratch_blocks alter column id type text using id::text;
alter table scratch_blocks alter column task_id type text using task_id::text;
alter table scratch_blocks add constraint scratch_blocks_task_id_fkey
  foreign key (task_id) references tasks (id) on delete cascade;

alter table saved_task_views alter column id drop default;
alter table saved_task_views alter column id type text using id::text;

-- Habits
alter table habit_lifecycle drop constraint habit_lifecycle_habit_id_fkey;
alter table habit_entries drop constraint habit_entries_habit_id_fkey;
alter table habit_freeze_usage drop constraint habit_freeze_usage_habit_id_fkey;
alter table habits alter column id drop default;
alter table habits alter column id type text using id::text;
alter table habit_lifecycle alter column habit_id type text using habit_id::text;
alter table habit_entries alter column habit_id type text using habit_id::text;
alter table habit_freeze_usage alter column habit_id type text using habit_id::text;
alter table habit_lifecycle add constraint habit_lifecycle_habit_id_fkey
  foreign key (habit_id) references habits (id) on delete cascade;
alter table habit_entries add constraint habit_entries_habit_id_fkey
  foreign key (habit_id) references habits (id) on delete cascade;
alter table habit_freeze_usage add constraint habit_freeze_usage_habit_id_fkey
  foreign key (habit_id) references habits (id) on delete cascade;

-- LeetCode: seed attempts carry 'imported-…' ids (problem_id is already text)
alter table leetcode_attempts alter column id drop default;
alter table leetcode_attempts alter column id type text using id::text;

-- Jobs
alter table job_stage_transitions drop constraint job_stage_transitions_role_id_fkey;
alter table job_roles alter column id drop default;
alter table job_roles alter column id type text using id::text;
alter table job_stage_transitions alter column id drop default;
alter table job_stage_transitions alter column id type text using id::text;
alter table job_stage_transitions alter column role_id type text using role_id::text;
alter table job_stage_transitions add constraint job_stage_transitions_role_id_fkey
  foreign key (role_id) references job_roles (id) on delete cascade;

-- Notes
alter table note_folders drop constraint note_folders_parent_folder_id_fkey;
alter table note_pages drop constraint note_pages_folder_id_fkey;
alter table note_pages drop constraint note_pages_parent_page_id_fkey;
alter table note_attachments drop constraint note_attachments_note_id_fkey;
alter table note_folders alter column id drop default;
alter table note_folders alter column id type text using id::text;
alter table note_folders alter column parent_folder_id type text using parent_folder_id::text;
alter table note_pages alter column id drop default;
alter table note_pages alter column id type text using id::text;
alter table note_pages alter column folder_id type text using folder_id::text;
alter table note_pages alter column parent_page_id type text using parent_page_id::text;
alter table note_attachments alter column note_id type text using note_id::text;
alter table note_folders add constraint note_folders_parent_folder_id_fkey
  foreign key (parent_folder_id) references note_folders (id) on delete set null;
alter table note_pages add constraint note_pages_folder_id_fkey
  foreign key (folder_id) references note_folders (id) on delete set null;
alter table note_pages add constraint note_pages_parent_page_id_fkey
  foreign key (parent_page_id) references note_pages (id) on delete cascade;
alter table note_attachments add constraint note_attachments_note_id_fkey
  foreign key (note_id) references note_pages (id) on delete cascade;
