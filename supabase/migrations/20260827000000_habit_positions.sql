-- Habits gained a user-arranged list order (2026-08-26). Existing rows keep
-- their creation order, which is what the list showed before.

alter table habits add column position integer not null default 0;

update habits set position = numbered.rn
from (
  select id, row_number() over (partition by user_id order by created_at) - 1 as rn
  from habits
) numbered
where habits.id = numbered.id;
