alter table public.defects
  add column if not exists follow_up_date date;

alter table public.defects
  add column if not exists follow_up_reason text not null default '';

alter table public.ai_site_observations
  add column if not exists follow_up_date date;

alter table public.ai_site_observations
  add column if not exists follow_up_reason text not null default '';

