-- Dedup key for ingested knowledge-base entries: source_ref holds the X post
-- id for x_bookmark rows (null for captures). The partial unique index lets
-- the ingest stop early and never double-insert a bookmark.

alter table kb_entries add column source_ref text;

create unique index kb_entries_user_source_ref
  on kb_entries (user_id, source_ref)
  where source_ref is not null;
