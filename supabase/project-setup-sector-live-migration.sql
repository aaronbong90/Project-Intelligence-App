create table if not exists public.project_setup_records (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  phase text not null,
  category text not null default '',
  title text not null,
  owner text not null default '',
  status text not null default 'not_started',
  priority text not null default 'normal',
  due_date date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  constraint project_setup_records_phase_check check (
    phase in ('site_survey', 'due_diligence', 'design', 'tender', 'award')
  ),
  constraint project_setup_records_status_check check (
    status in ('not_started', 'in_progress', 'blocked', 'ready', 'closed')
  ),
  constraint project_setup_records_priority_check check (
    priority in ('normal', 'high', 'urgent')
  )
);

create index if not exists project_setup_records_project_phase_idx
on public.project_setup_records (project_id, phase, due_date);

alter table public.project_setup_records enable row level security;

drop policy if exists "project_setup_records_manage" on public.project_setup_records;
create policy "project_setup_records_manage"
on public.project_setup_records for all
using (public.has_module_access(project_id, 'overview', auth.uid()))
with check (public.has_module_access(project_id, 'overview', auth.uid()));

create or replace function public.module_key_from_section(section_type text)
returns text
language sql
stable
set search_path = public
as $$
  select case section_type
    when 'contractor_submission' then 'contractor_submissions'
    when 'consultant_submission' then 'contractor_submissions'
    when 'project_setup_record' then 'overview'
    when 'survey_item' then 'handover'
    when 'daily_report' then 'daily_reports'
    when 'weekly_report' then 'weekly_reports'
    when 'financial_record' then 'financials'
    when 'defect' then 'defects'
    when 'ai_site_observation' then 'site_intelligence'
    else 'overview'
  end;
$$;
