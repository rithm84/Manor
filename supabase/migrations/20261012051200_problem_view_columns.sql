-- Saved views can display every currently supported problem column.
begin;
alter table public.saved_problem_views drop constraint saved_problem_views_visible_columns_check;
alter table public.saved_problem_views add constraint saved_problem_views_visible_columns_check check(cardinality(visible_columns) between 1 and 8);
commit;
