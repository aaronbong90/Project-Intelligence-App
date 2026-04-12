create extension if not exists "pgcrypto";

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user_profile();
drop function if exists public.is_active_user(uuid);
drop function if exists public.is_master_admin(uuid);
drop function if exists public.get_user_role(uuid);
drop function if exists public.has_project_access(uuid, uuid);
drop function if exists public.project_role(uuid, uuid);
drop function if exists public.has_module_access(uuid, text, uuid);
drop function if exists public.can_view_financial_record(uuid, uuid);
drop function if exists public.can_delete_financial_record(uuid, uuid);
drop function if exists public.can_review_financials(uuid, uuid);
drop function if exists public.can_access_project_file(text, uuid);
drop function if exists public.module_key_from_section(text);
drop function if exists public.apply_financial_record_workflow();

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  location text,
  client_name text,
  contractor_name text,
  details text,
  handover_date date,
  completion_date date,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null default 'consultant',
  is_suspended boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_role_check check (role in ('master_admin', 'client', 'contractor', 'subcontractor', 'consultant'))
);

alter table public.profiles add column if not exists is_suspended boolean not null default false;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('master_admin', 'client', 'contractor', 'subcontractor', 'consultant'));

create table if not exists public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'consultant',
  can_overview boolean not null default true,
  can_handover boolean not null default false,
  can_daily_reports boolean not null default false,
  can_weekly_reports boolean not null default false,
  can_financials boolean not null default false,
  can_completion boolean not null default false,
  can_defects boolean not null default false,
  created_at timestamptz not null default now(),
  constraint project_members_role_check check (role in ('client', 'contractor', 'subcontractor', 'consultant')),
  constraint project_members_project_user_unique unique (project_id, user_id)
);

alter table public.project_members drop constraint if exists project_members_role_check;
alter table public.project_members
  add constraint project_members_role_check check (role in ('client', 'contractor', 'subcontractor', 'consultant'));

create table if not exists public.milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  due_date date not null,
  created_at timestamptz not null default now()
);

create table if not exists public.survey_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  area text not null,
  item text not null,
  status text not null default 'good',
  details text,
  created_at timestamptz not null default now()
);

create table if not exists public.daily_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  report_date date not null,
  location text not null,
  work_done text,
  manpower_by_trade text,
  created_at timestamptz not null default now()
);

create table if not exists public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  week_ending date not null,
  summary text,
  created_at timestamptz not null default now()
);

create table if not exists public.financial_records (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  document_type text not null,
  reference_number text,
  amount numeric(12,2) not null default 0,
  status text not null default 'pending',
  notes text,
  created_at timestamptz not null default now()
);

alter table public.financial_records add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;
alter table public.financial_records add column if not exists owner_email text not null default '';
alter table public.financial_records add column if not exists owner_role text not null default 'consultant';
alter table public.financial_records add column if not exists submitted_at timestamptz;
alter table public.financial_records add column if not exists reviewed_at timestamptz;
alter table public.financial_records add column if not exists reviewed_by_user_id uuid references auth.users(id) on delete set null;
alter table public.financial_records add column if not exists reviewed_by_email text not null default '';
alter table public.financial_records add column if not exists review_note text not null default '';
alter table public.financial_records drop constraint if exists financial_records_status_check;
alter table public.financial_records
  add constraint financial_records_status_check check (status in ('pending', 'submitted', 'approved', 'rejected', 'paid'));
alter table public.financial_records drop constraint if exists financial_records_document_type_check;
alter table public.financial_records
  add constraint financial_records_document_type_check check (document_type in ('quotation', 'invoice', 'variation_order'));
alter table public.financial_records drop constraint if exists financial_records_owner_role_check;
alter table public.financial_records
  add constraint financial_records_owner_role_check check (owner_role in ('master_admin', 'client', 'contractor', 'subcontractor', 'consultant'));
drop trigger if exists financial_records_workflow on public.financial_records;

create table if not exists public.completion_checklist_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  item text not null,
  status text not null default 'open',
  details text,
  created_at timestamptz not null default now()
);

create table if not exists public.defects (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  zone text,
  title text not null,
  status text not null default 'open',
  details text,
  created_at timestamptz not null default now()
);

create table if not exists public.defect_zones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'defect_zones_project_name_unique'
  ) then
    alter table public.defect_zones
      add constraint defect_zones_project_name_unique unique (project_id, name);
  end if;
end
$$;

alter table public.defects add column if not exists zone text;

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  section_type text not null,
  record_id uuid not null,
  name text not null,
  mime_type text not null,
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

create or replace function public.is_active_user(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from public.profiles
    where profiles.id = check_user_id
      and profiles.is_suspended
  );
$$;

create or replace function public.is_master_admin(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where profiles.id = check_user_id
      and profiles.role = 'master_admin'
  );
$$;

create or replace function public.get_user_role(check_user_id uuid default auth.uid())
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select profiles.role
      from public.profiles
      where profiles.id = check_user_id
    ),
    'consultant'
  );
$$;

create or replace function public.has_project_access(project_uuid uuid, check_user_id uuid default auth.uid())
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
      )
  );
$$;

create or replace function public.project_role(project_uuid uuid, check_user_id uuid default auth.uid())
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_master_admin(check_user_id) then 'master_admin'
    when exists (
      select 1
      from public.projects
      where projects.id = project_uuid
        and projects.owner_id = check_user_id
    ) then public.get_user_role(check_user_id)
    else coalesce(
      (
        select project_members.role
        from public.project_members
        where project_members.project_id = project_uuid
          and project_members.user_id = check_user_id
        limit 1
      ),
      public.get_user_role(check_user_id)
    )
  end;
$$;

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
            or (module_key = 'handover' and project_members.can_handover)
            or (module_key = 'daily_reports' and project_members.can_daily_reports)
            or (module_key = 'weekly_reports' and project_members.can_weekly_reports)
            or (module_key = 'financials' and project_members.can_financials)
            or (module_key = 'completion' and project_members.can_completion)
            or (module_key = 'defects' and project_members.can_defects)
          )
      )
  );
$$;

create or replace function public.can_review_financials(project_uuid uuid, check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.has_module_access(project_uuid, 'financials', check_user_id)
    and (
      public.is_master_admin(check_user_id)
      or public.project_role(project_uuid, check_user_id) = 'client'
    );
$$;

create or replace function public.can_view_financial_record(financial_record_uuid uuid, check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.financial_records
    where financial_records.id = financial_record_uuid
      and public.has_module_access(financial_records.project_id, 'financials', check_user_id)
      and (
        public.is_master_admin(check_user_id)
        or public.project_role(financial_records.project_id, check_user_id) in ('client', 'consultant')
        or financial_records.owner_user_id = check_user_id
      )
  );
$$;

create or replace function public.can_delete_financial_record(financial_record_uuid uuid, check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.financial_records
    where financial_records.id = financial_record_uuid
      and (
        public.is_master_admin(check_user_id)
        or (
          financial_records.owner_user_id = check_user_id
          and financial_records.status in ('pending', 'rejected')
          and public.has_module_access(financial_records.project_id, 'financials', check_user_id)
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
    when 'survey_item' then 'handover'
    when 'daily_report' then 'daily_reports'
    when 'weekly_report' then 'weekly_reports'
    when 'financial_record' then 'financials'
    when 'defect' then 'defects'
    else 'overview'
  end;
$$;

create or replace function public.can_access_project_file(object_name text, check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when split_part(object_name, '/', 2) = 'financial_record' then
      public.can_view_financial_record(split_part(object_name, '/', 3)::uuid, check_user_id)
    else
      public.has_module_access(
        split_part(object_name, '/', 1)::uuid,
        public.module_key_from_section(split_part(object_name, '/', 2)),
        check_user_id
      )
  end;
$$;

create or replace function public.apply_financial_record_workflow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_user_id uuid := auth.uid();
  acting_email text := '';
begin
  if acting_user_id is null then
    raise exception 'Sign in first before changing financial records.';
  end if;

  if tg_op = 'INSERT' then
    if not public.has_module_access(new.project_id, 'financials', acting_user_id) then
      raise exception 'You do not have financial access for this project.';
    end if;

    if not public.is_master_admin(acting_user_id) and public.project_role(new.project_id, acting_user_id) = 'client' then
      raise exception 'Client accounts review financial submissions but do not create them.';
    end if;

    new.owner_user_id := coalesce(new.owner_user_id, acting_user_id);

    if not public.is_master_admin(acting_user_id) and new.owner_user_id <> acting_user_id then
      raise exception 'Financial records must be created under your own account.';
    end if;

    select coalesce(email, '') into acting_email
    from public.profiles
    where profiles.id = new.owner_user_id;

    new.owner_email := coalesce(nullif(new.owner_email, ''), acting_email, '');
    new.owner_role := coalesce(nullif(new.owner_role, ''), public.project_role(new.project_id, new.owner_user_id), 'consultant');
    new.status := 'pending';
    new.submitted_at := null;
    new.reviewed_at := null;
    new.reviewed_by_user_id := null;
    new.reviewed_by_email := '';
    new.review_note := '';

    return new;
  end if;

  if new.project_id <> old.project_id then
    raise exception 'Financial record project cannot be changed.';
  end if;

  new.owner_user_id := old.owner_user_id;
  new.owner_email := old.owner_email;
  new.owner_role := old.owner_role;

  if public.can_review_financials(old.project_id, acting_user_id) then
    if new.document_type is distinct from old.document_type
      or new.reference_number is distinct from old.reference_number
      or new.amount is distinct from old.amount
      or new.notes is distinct from old.notes then
      raise exception 'Client review can only approve, reject, or mark paid.';
    end if;

    if new.status = 'approved' then
      if old.status <> 'submitted' then
        raise exception 'Only submitted records can be approved.';
      end if;
    elsif new.status = 'rejected' then
      if old.status <> 'submitted' then
        raise exception 'Only submitted records can be rejected.';
      end if;

      if btrim(coalesce(new.review_note, '')) = '' then
        raise exception 'Add a rejection reason before rejecting this record.';
      end if;
    elsif new.status = 'paid' then
      if old.status <> 'approved' then
        raise exception 'Only approved records can be marked as paid.';
      end if;
    else
      raise exception 'Client review can only set approved, rejected, or paid statuses.';
    end if;

    select coalesce(email, '') into acting_email
    from public.profiles
    where profiles.id = acting_user_id;

    new.submitted_at := coalesce(old.submitted_at, now());
    new.reviewed_at := now();
    new.reviewed_by_user_id := acting_user_id;
    new.reviewed_by_email := acting_email;
    new.review_note := btrim(coalesce(new.review_note, ''));

    return new;
  end if;

  if old.owner_user_id <> acting_user_id then
    raise exception 'You can only edit financial records submitted from your own account.';
  end if;

  if old.status in ('approved', 'paid') then
    raise exception 'Approved or paid records can no longer be edited by the submitter.';
  end if;

  if new.status in ('approved', 'rejected', 'paid') then
    raise exception 'Only the client can approve, reject, or mark records as paid.';
  end if;

  new.reviewed_at := null;
  new.reviewed_by_user_id := null;
  new.reviewed_by_email := '';

  if new.status = 'submitted' then
    if old.status not in ('pending', 'rejected') then
      raise exception 'Only pending or rejected records can be submitted.';
    end if;

    new.submitted_at := now();
    new.review_note := '';

    return new;
  end if;

  if new.status = 'pending' then
    if old.status not in ('pending', 'rejected') then
      raise exception 'Only pending or rejected records can remain editable drafts.';
    end if;

    new.submitted_at := case when old.status = 'pending' then old.submitted_at else null end;
    new.review_note := case when old.status = 'pending' then old.review_note else '' end;

    return new;
  end if;

  raise exception 'Submitters can only save drafts or submit records for client approval.';
end;
$$;

create trigger financial_records_workflow
before insert or update on public.financial_records
for each row execute function public.apply_financial_record_workflow();

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (
    new.id,
    coalesce(new.email, ''),
    case
      when lower(coalesce(new.email, '')) = lower('aaronbong90@gmail.com') then 'master_admin'
      else 'consultant'
    end
  )
  on conflict (id) do update
  set email = excluded.email,
      role = case
        when lower(excluded.email) = lower('aaronbong90@gmail.com') then 'master_admin'
        else public.profiles.role
      end,
      updated_at = now();

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user_profile();

insert into public.profiles (id, email, role)
select
  users.id,
  coalesce(users.email, ''),
  case
    when lower(coalesce(users.email, '')) = lower('aaronbong90@gmail.com') then 'master_admin'
    else 'consultant'
  end
from auth.users as users
on conflict (id) do update
set email = excluded.email,
    role = case
      when lower(excluded.email) = lower('aaronbong90@gmail.com') then 'master_admin'
      else public.profiles.role
    end,
    updated_at = now();

update public.financial_records as financial_records
set owner_user_id = coalesce(financial_records.owner_user_id, projects.owner_id)
from public.projects
where projects.id = financial_records.project_id
  and financial_records.owner_user_id is null;

update public.financial_records as financial_records
set owner_email = coalesce(nullif(financial_records.owner_email, ''), profiles.email, ''),
    owner_role = coalesce(nullif(financial_records.owner_role, ''), public.project_role(financial_records.project_id, financial_records.owner_user_id), profiles.role, 'consultant')
from public.profiles
where profiles.id = financial_records.owner_user_id;

update public.financial_records
set submitted_at = case
      when status in ('submitted', 'approved', 'rejected', 'paid') and submitted_at is null then created_at
      else submitted_at
    end,
    reviewed_at = case
      when status in ('approved', 'rejected', 'paid') and reviewed_at is null then created_at
      else reviewed_at
    end;

alter table public.projects enable row level security;
alter table public.profiles enable row level security;
alter table public.project_members enable row level security;
alter table public.milestones enable row level security;
alter table public.survey_items enable row level security;
alter table public.daily_reports enable row level security;
alter table public.weekly_reports enable row level security;
alter table public.financial_records enable row level security;
alter table public.completion_checklist_items enable row level security;
alter table public.defect_zones enable row level security;
alter table public.defects enable row level security;
alter table public.attachments enable row level security;

drop policy if exists "profiles_select" on public.profiles;
drop policy if exists "profiles_update_by_admin" on public.profiles;
drop policy if exists "projects_select" on public.projects;
drop policy if exists "projects_insert" on public.projects;
drop policy if exists "projects_update" on public.projects;
drop policy if exists "projects_delete" on public.projects;
drop policy if exists "project_members_select" on public.project_members;
drop policy if exists "project_members_manage" on public.project_members;
drop policy if exists "milestones_manage" on public.milestones;
drop policy if exists "survey_items_manage" on public.survey_items;
drop policy if exists "daily_reports_manage" on public.daily_reports;
drop policy if exists "weekly_reports_manage" on public.weekly_reports;
drop policy if exists "financial_records_manage" on public.financial_records;
drop policy if exists "financial_records_select" on public.financial_records;
drop policy if exists "financial_records_insert" on public.financial_records;
drop policy if exists "financial_records_update" on public.financial_records;
drop policy if exists "financial_records_delete" on public.financial_records;
drop policy if exists "completion_checklist_manage" on public.completion_checklist_items;
drop policy if exists "defect_zones_manage" on public.defect_zones;
drop policy if exists "defects_manage" on public.defects;
drop policy if exists "attachments_manage" on public.attachments;
drop policy if exists "project_files_insert" on storage.objects;
drop policy if exists "project_files_update" on storage.objects;
drop policy if exists "project_files_delete" on storage.objects;

create policy "profiles_select"
on public.profiles for select
using (auth.uid() = id or public.is_master_admin(auth.uid()));

create policy "profiles_update_by_admin"
on public.profiles for update
using (public.is_active_user(auth.uid()) and public.is_master_admin(auth.uid()))
with check (public.is_active_user(auth.uid()) and public.is_master_admin(auth.uid()));

create policy "projects_select"
on public.projects for select
using (public.has_project_access(id, auth.uid()));

create policy "projects_insert"
on public.projects for insert
with check (public.is_active_user(auth.uid()) and (auth.uid() = owner_id or public.is_master_admin(auth.uid())));

create policy "projects_update"
on public.projects for update
using (public.has_module_access(id, 'overview', auth.uid()))
with check (public.has_module_access(id, 'overview', auth.uid()));

create policy "projects_delete"
on public.projects for delete
using (auth.uid() = owner_id or public.is_master_admin(auth.uid()));

create policy "project_members_select"
on public.project_members for select
using (auth.uid() = user_id or public.is_master_admin(auth.uid()));

create policy "project_members_manage"
on public.project_members for all
using (public.is_active_user(auth.uid()) and public.is_master_admin(auth.uid()))
with check (public.is_active_user(auth.uid()) and public.is_master_admin(auth.uid()));

create policy "milestones_manage"
on public.milestones for all
using (public.has_module_access(project_id, 'overview', auth.uid()))
with check (public.has_module_access(project_id, 'overview', auth.uid()));

create policy "survey_items_manage"
on public.survey_items for all
using (public.has_module_access(project_id, 'handover', auth.uid()))
with check (public.has_module_access(project_id, 'handover', auth.uid()));

create policy "daily_reports_manage"
on public.daily_reports for all
using (public.has_module_access(project_id, 'daily_reports', auth.uid()))
with check (public.has_module_access(project_id, 'daily_reports', auth.uid()));

create policy "weekly_reports_manage"
on public.weekly_reports for all
using (public.has_module_access(project_id, 'weekly_reports', auth.uid()))
with check (public.has_module_access(project_id, 'weekly_reports', auth.uid()));

create policy "financial_records_select"
on public.financial_records for select
using (public.can_view_financial_record(id, auth.uid()));

create policy "financial_records_insert"
on public.financial_records for insert
with check (public.has_module_access(project_id, 'financials', auth.uid()));

create policy "financial_records_update"
on public.financial_records for update
using (public.can_view_financial_record(id, auth.uid()))
with check (public.can_view_financial_record(id, auth.uid()));

create policy "financial_records_delete"
on public.financial_records for delete
using (public.can_delete_financial_record(id, auth.uid()));

create policy "completion_checklist_manage"
on public.completion_checklist_items for all
using (public.has_module_access(project_id, 'completion', auth.uid()))
with check (public.has_module_access(project_id, 'completion', auth.uid()));

create policy "defect_zones_manage"
on public.defect_zones for all
using (public.has_module_access(project_id, 'defects', auth.uid()))
with check (public.has_module_access(project_id, 'defects', auth.uid()));

create policy "defects_manage"
on public.defects for all
using (public.has_module_access(project_id, 'defects', auth.uid()))
with check (public.has_module_access(project_id, 'defects', auth.uid()));

create policy "attachments_manage"
on public.attachments for all
using (
  case
    when section_type = 'financial_record' then public.can_view_financial_record(record_id, auth.uid())
    else public.has_module_access(project_id, public.module_key_from_section(section_type), auth.uid())
  end
)
with check (
  case
    when section_type = 'financial_record' then public.can_view_financial_record(record_id, auth.uid())
    else public.has_module_access(project_id, public.module_key_from_section(section_type), auth.uid())
  end
);

insert into storage.buckets (id, name, public)
values ('project-files', 'project-files', true)
on conflict (id) do nothing;

create policy "project_files_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'project-files'
  and public.can_access_project_file(name, auth.uid())
);

create policy "project_files_update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'project-files'
  and public.can_access_project_file(name, auth.uid())
)
with check (
  bucket_id = 'project-files'
  and public.can_access_project_file(name, auth.uid())
);

create policy "project_files_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'project-files'
  and public.can_access_project_file(name, auth.uid())
);
