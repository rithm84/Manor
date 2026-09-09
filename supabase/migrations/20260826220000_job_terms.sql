-- Hiring cycle on both the shared feed and the user's own roles, so the
-- Jobs browse view can filter Summer 2026 apart from Summer 2027.

alter table job_listings add column if not exists term text not null default '';
alter table job_listings add column if not exists category text not null default '';
alter table job_roles add column if not exists term text;

create index if not exists job_listings_term on job_listings (term);
