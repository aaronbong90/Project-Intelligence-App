-- ProjectAxis Drawing ↔ Photo Linking foundation.
-- Adds drawing sheets and polymorphic links to AI observations, defects, and daily reports.

create table if not exists public.drawing_sheets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null default '',
  revision text not null default '',
  discipline text not null default '',
  sheet_number text not null default '',
  file_path text not null unique,
  uploaded_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists drawing_sheets_project_created_idx
on public.drawing_sheets (project_id, created_at desc);

create index if not exists drawing_sheets_project_sheet_idx
on public.drawing_sheets (project_id, sheet_number, revision);

create table if not exists public.drawing_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  drawing_sheet_id uuid not null references public.drawing_sheets(id) on delete cascade,
  record_type text not null,
  record_id uuid not null,
  x_coordinate numeric(8, 6),
  y_coordinate numeric(8, 6),
  markup_label text not null default '',
  notes text not null default '',
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint drawing_links_record_type_check check (record_type in ('ai_site_observation', 'defect', 'daily_report')),
  constraint drawing_links_x_coordinate_check check (x_coordinate is null or (x_coordinate >= 0 and x_coordinate <= 1)),
  constraint drawing_links_y_coordinate_check check (y_coordinate is null or (y_coordinate >= 0 and y_coordinate <= 1))
);

create index if not exists drawing_links_project_created_idx
on public.drawing_links (project_id, created_at desc);

create index if not exists drawing_links_record_idx
on public.drawing_links (record_type, record_id);

create index if not exists drawing_links_sheet_idx
on public.drawing_links (drawing_sheet_id);

alter table public.drawing_sheets enable row level security;
alter table public.drawing_links enable row level security;

drop policy if exists "drawing_sheets_select" on public.drawing_sheets;
drop policy if exists "drawing_sheets_manage" on public.drawing_sheets;
drop policy if exists "drawing_links_select" on public.drawing_links;
drop policy if exists "drawing_links_manage" on public.drawing_links;

create policy "drawing_sheets_select"
on public.drawing_sheets for select
using (public.has_project_access(project_id, auth.uid()));

create policy "drawing_sheets_manage"
on public.drawing_sheets for all
using (public.has_project_access(project_id, auth.uid()))
with check (public.has_project_access(project_id, auth.uid()));

create policy "drawing_links_select"
on public.drawing_links for select
using (public.has_project_access(project_id, auth.uid()));

create policy "drawing_links_manage"
on public.drawing_links for all
using (
  public.has_project_access(project_id, auth.uid())
  and exists (
    select 1
    from public.drawing_sheets
    where drawing_sheets.id = drawing_links.drawing_sheet_id
      and drawing_sheets.project_id = drawing_links.project_id
  )
)
with check (
  public.has_project_access(project_id, auth.uid())
  and exists (
    select 1
    from public.drawing_sheets
    where drawing_sheets.id = drawing_links.drawing_sheet_id
      and drawing_sheets.project_id = drawing_links.project_id
  )
);

notify pgrst, 'reload schema';
