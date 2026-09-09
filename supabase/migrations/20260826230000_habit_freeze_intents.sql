-- Freezes stopped applying themselves (product decision 2026-08-26). The user
-- picks the day and habit a freeze covers, and that choice is input the nightly
-- reconciler reads; habit_freeze_usage stays the derived record of what the
-- pool could actually afford.

create table habit_freeze_intents (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  habit_id text not null references habits (id) on delete cascade,
  date date not null,
  created_at timestamptz not null,
  primary key (habit_id, date)
);

alter table habit_freeze_intents enable row level security;

create policy "habit_freeze_intents_owner" on habit_freeze_intents
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index habit_freeze_intents_user on habit_freeze_intents (user_id);

-- Every freeze already spent was auto-applied, so it stands as an explicit
-- request; without this the next reconcile would silently refund old freezes
-- and rewrite finalized streaks.
insert into habit_freeze_intents (user_id, habit_id, date, created_at)
select user_id, habit_id, date, now() from habit_freeze_usage;
