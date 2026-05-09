-- ProjectAxis AI Recurring Issue Detection foundation.
-- Run this after the AI Site Intelligence migration.

alter table public.ai_site_observations
  add column if not exists recurrence_group_id uuid;

alter table public.ai_site_observations
  add column if not exists recurrence_count integer not null default 0;

alter table public.ai_site_observations
  add column if not exists recurrence_summary text not null default '';

alter table public.ai_site_observations
  add column if not exists is_recurring_issue boolean not null default false;

alter table public.ai_site_observations
  drop constraint if exists ai_site_observations_recurrence_count_check;

alter table public.ai_site_observations
  add constraint ai_site_observations_recurrence_count_check
  check (recurrence_count >= 0);

create index if not exists ai_site_observations_recurrence_group_idx
on public.ai_site_observations (recurrence_group_id);

create index if not exists ai_site_observations_recurring_project_idx
on public.ai_site_observations (project_id, is_recurring_issue, created_at desc);

notify pgrst, 'reload schema';
