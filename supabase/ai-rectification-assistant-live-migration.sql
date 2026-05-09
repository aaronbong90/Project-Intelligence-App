-- ProjectAxis AI Rectification Assistant foundation.
-- Adds editable draft assistant fields for AI observations and official defects.

alter table public.ai_site_observations
  add column if not exists root_cause text not null default '';

alter table public.ai_site_observations
  add column if not exists responsible_trade text not null default '';

alter table public.ai_site_observations
  add column if not exists rectification_steps jsonb not null default '[]'::jsonb;

alter table public.ai_site_observations
  add column if not exists closure_checklist jsonb not null default '[]'::jsonb;

alter table public.defects
  add column if not exists root_cause text not null default '';

alter table public.defects
  add column if not exists responsible_trade text not null default '';

alter table public.defects
  add column if not exists rectification_steps jsonb not null default '[]'::jsonb;

alter table public.defects
  add column if not exists closure_checklist jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
