create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null default 'consultant',
  is_suspended boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists is_suspended boolean not null default false;
alter table public.profiles add column if not exists client_owner_id uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists created_by_user_id uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('master_admin', 'client', 'contractor', 'subcontractor', 'consultant'));

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role text := lower(coalesce(new.raw_user_meta_data ->> 'role', ''));
  normalized_role text := 'consultant';
  requested_client_owner_id uuid := nullif(new.raw_user_meta_data ->> 'client_owner_id', '')::uuid;
  requested_created_by_user_id uuid := nullif(new.raw_user_meta_data ->> 'created_by_user_id', '')::uuid;
begin
  normalized_role := case
    when lower(coalesce(new.email, '')) = lower('aaronbong90@gmail.com') then 'master_admin'
    when requested_role in ('client', 'contractor', 'subcontractor', 'consultant') then requested_role
    else 'consultant'
  end;

  insert into public.profiles (id, email, role, client_owner_id, created_by_user_id)
  values (
    new.id,
    coalesce(new.email, ''),
    normalized_role,
    case
      when normalized_role = 'master_admin' then null
      when normalized_role = 'client' then new.id
      else requested_client_owner_id
    end,
    requested_created_by_user_id
  )
  on conflict (id) do update
  set email = excluded.email,
      role = case
        when lower(excluded.email) = lower('aaronbong90@gmail.com') then 'master_admin'
        else coalesce(nullif(excluded.role, ''), public.profiles.role)
      end,
      client_owner_id = case
        when lower(excluded.email) = lower('aaronbong90@gmail.com') then null
        when excluded.role = 'client' then excluded.id
        else coalesce(excluded.client_owner_id, public.profiles.client_owner_id)
      end,
      created_by_user_id = coalesce(excluded.created_by_user_id, public.profiles.created_by_user_id),
      updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user_profile();

insert into public.profiles (id, email, role, client_owner_id)
select
  users.id,
  coalesce(users.email, ''),
  case
    when lower(coalesce(users.email, '')) = lower('aaronbong90@gmail.com') then 'master_admin'
    when lower(coalesce(users.raw_user_meta_data ->> 'role', '')) in ('client', 'contractor', 'subcontractor', 'consultant')
      then lower(coalesce(users.raw_user_meta_data ->> 'role', ''))
    else 'consultant'
  end,
  case
    when lower(coalesce(users.email, '')) = lower('aaronbong90@gmail.com') then null
    when lower(coalesce(users.raw_user_meta_data ->> 'role', '')) = 'client' then users.id
    else nullif(users.raw_user_meta_data ->> 'client_owner_id', '')::uuid
  end
from auth.users as users
on conflict (id) do update
set email = excluded.email,
    role = case
      when lower(excluded.email) = lower('aaronbong90@gmail.com') then 'master_admin'
      else public.profiles.role
    end,
    updated_at = now();

update public.profiles
set client_owner_id = id
where role = 'client'
  and client_owner_id is null;

update public.profiles
set client_owner_id = null
where role = 'master_admin';
