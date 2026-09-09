-- Custom habit step ladders: entry values become free integer percents
-- (1-100) so a "3 tablets" habit can log 33/66/100 instead of quarters.

alter table habit_entries drop constraint habit_entries_value_check;
alter table habit_entries add constraint habit_entries_value_check
  check (value between 1 and 100);
