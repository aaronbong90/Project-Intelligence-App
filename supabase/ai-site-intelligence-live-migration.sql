-- ProjectAxis AI Site Intelligence live database migration.
-- Run this once in the Supabase SQL Editor for the connected project.

alter table public.project_members
  add column if not exists can_site_intelligence boolean not null default false;

-- Give existing users AI Site Intelligence where they already have defect access.
update public.project_members
set can_site_intelligence = true
where can_defects = true
  and can_site_intelligence = false;

create table if not exists public.ai_site_observations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  created_by_user_id uuid references auth.users(id) on delete set null,
  location text not null default '',
  trade text not null default '',
  image_path text not null,
  ai_summary text not null default '',
  detected_type text not null default 'unknown',
  confidence numeric(5, 4) not null default 0,
  status text not null default 'pending',
  linked_record_type text,
  linked_record_id uuid,
  created_at timestamptz not null default now()
);

alter table public.ai_site_observations
  drop constraint if exists ai_site_observations_confidence_check;

alter table public.ai_site_observations
  add constraint ai_site_observations_confidence_check
  check (confidence >= 0 and confidence <= 1);

alter table public.ai_site_observations
  drop constraint if exists ai_site_observations_status_check;

alter table public.ai_site_observations
  add constraint ai_site_observations_status_check
  check (status in ('pending', 'reviewed', 'approved', 'converted', 'dismissed', 'failed'));

alter table public.ai_site_observations
  drop constraint if exists ai_site_observations_linked_record_type_check;

alter table public.ai_site_observations
  add constraint ai_site_observations_linked_record_type_check
  check (
    linked_record_type is null
    or linked_record_type in ('defect', 'daily_report')
  );

create index if not exists ai_site_observations_project_created_idx
on public.ai_site_observations (project_id, created_at desc);

create or replace function public.has_module_access(project_uuid uuid, module_key text, check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_active_user(check_user_id)
    and (
      public.is_master_admin(check_user_id)
      or exists (
        select 1
        from public.projects
        where projects.id = project_uuid
          and projects.owner_id = check_user_id
      )
      or exists (
        select 1
        from public.project_members
        where project_members.project_id = project_uuid
          and project_members.user_id = check_user_id
          and (
            (module_key = 'overview' and project_members.can_overview)
            or (module_key = 'contractor_submissions' and project_members.can_contractor_submissions)
            or (module_key = 'handover' and project_members.can_handover)
            or (module_key = 'daily_reports' and project_members.can_daily_reports)
            or (module_key = 'weekly_reports' and project_members.can_weekly_reports)
            or (module_key = 'financials' and project_members.can_financials)
            or (module_key = 'completion' and project_members.can_completion)
            or (module_key = 'defects' and project_members.can_defects)
            or (module_key = 'site_intelligence' and project_members.can_site_intelligence)
          )
      )
  );
$$;

create or replace function public.module_key_from_section(section_type text)
returns text
language sql
stable
set search_path = public
as $$
  select case section_type
    when 'contractor_submission' then 'contractor_submissions'
    when 'consultant_submission' then 'contractor_submissions'
    when 'survey_item' then 'handover'
    when 'daily_report' then 'daily_reports'
    when 'weekly_report' then 'weekly_reports'
    when 'financial_record' then 'financials'
    when 'defect' then 'defects'
    when 'ai_site_observation' then 'site_intelligence'
    else 'overview'
  end;
$$;

alter table public.ai_site_observations enable row level security;

drop policy if exists "ai_site_observations_select" on public.ai_site_observations;
drop policy if exists "ai_site_observations_insert" on public.ai_site_observations;
drop policy if exists "ai_site_observations_update" on public.ai_site_observations;
drop policy if exists "ai_site_observations_delete" on public.ai_site_observations;

create policy "ai_site_observations_select"
on public.ai_site_observations for select
using (public.has_module_access(project_id, 'site_intelligence', auth.uid()));

create policy "ai_site_observations_insert"
on public.ai_site_observations for insert
with check (
  public.has_module_access(project_id, 'site_intelligence', auth.uid())
  and created_by_user_id = auth.uid()
);

create policy "ai_site_observations_update"
on public.ai_site_observations for update
using (public.has_module_access(project_id, 'site_intelligence', auth.uid()))
with check (public.has_module_access(project_id, 'site_intelligence', auth.uid()));

create policy "ai_site_observations_delete"
on public.ai_site_observations for delete
using (public.has_module_access(project_id, 'site_intelligence', auth.uid()));

notify pgrst, 'reload schema';
