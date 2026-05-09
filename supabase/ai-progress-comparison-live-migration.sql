-- ProjectAxis AI Progress Comparison foundation.
-- Run this after the AI Site Intelligence migration.

alter table public.ai_site_observations
  add column if not exists previous_observation_id uuid references public.ai_site_observations(id) on delete set null;

alter table public.ai_site_observations
  add column if not exists progress_status text not null default 'unknown';

update public.ai_site_observations
  set progress_status = case progress_status
    when 'progress_detected' then 'improved'
    when 'no_visible_change' then 'unchanged'
    when 'possible_delay' then 'delayed'
    when 'repeated_issue' then 'delayed'
    when 'worsening_condition' then 'worsened'
    else 'unknown'
  end
  where progress_status in (
    'new_baseline',
    'progress_detected',
    'no_visible_change',
    'possible_delay',
    'repeated_issue',
    'worsening_condition',
    'comparison_unavailable'
  );

alter table public.ai_site_observations
  add column if not exists progress_delta_summary text not null default '';

alter table public.ai_site_observations
  add column if not exists comparison_confidence numeric(5, 4) not null default 0;

alter table public.ai_site_observations
  drop constraint if exists ai_site_observations_comparison_confidence_check;

alter table public.ai_site_observations
  add constraint ai_site_observations_comparison_confidence_check
  check (comparison_confidence >= 0 and comparison_confidence <= 1);

alter table public.ai_site_observations
  drop constraint if exists ai_site_observations_progress_status_check;

alter table public.ai_site_observations
  add constraint ai_site_observations_progress_status_check
  check (
    progress_status in (
      'improved',
      'unchanged',
      'delayed',
      'worsened',
      'unknown'
    )
  );

create index if not exists ai_site_observations_location_trade_created_idx
on public.ai_site_observations (project_id, location, trade, created_at desc);

create index if not exists ai_site_observations_previous_idx
on public.ai_site_observations (previous_observation_id);

notify pgrst, 'reload schema';
