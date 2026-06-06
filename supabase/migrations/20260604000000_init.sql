create extension if not exists "pgcrypto";

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role = 'owner'),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  url_pattern text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  token text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  description text not null default '',
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'archived')),
  page_url text not null,
  page_title text not null default '',
  screenshot_path text not null,
  annotated_screenshot_path text not null,
  annotations jsonb not null default '[]'::jsonb,
  viewport_width integer not null,
  viewport_height integer not null,
  device_pixel_ratio numeric not null default 1,
  user_agent text not null,
  browser_metadata jsonb not null default '{}'::jsonb,
  assignee_ids uuid[] not null default '{}'::uuid[],
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.report_comments (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  body text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists reports_set_updated_at on public.reports;
create trigger reports_set_updated_at
before update on public.reports
for each row execute function public.set_updated_at();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships
    where organization_id = target_organization_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.create_workspace(workspace_name text, project_name text default 'Webサイトフィードバック')
returns table (organization_id uuid, project_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_organization_id uuid;
  new_project_id uuid;
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception '認証が必要です';
  end if;

  insert into public.organizations (name)
  values (coalesce(nullif(workspace_name, ''), 'フィードバック用ワークスペース'))
  returning id into new_organization_id;

  insert into public.memberships (organization_id, user_id, role)
  values (new_organization_id, current_user_id, 'owner');

  insert into public.projects (organization_id, name, created_by)
  values (new_organization_id, coalesce(nullif(project_name, ''), 'Webサイトフィードバック'), current_user_id)
  returning id into new_project_id;

  return query select new_organization_id, new_project_id;
end;
$$;

create or replace function public.accept_invitation(invitation_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_organization_id uuid;
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception '認証が必要です';
  end if;

  select organization_id
    into target_organization_id
  from public.invitations
  where token = invitation_token
  limit 1;

  if target_organization_id is null then
    raise exception '招待が見つかりません';
  end if;

  insert into public.memberships (organization_id, user_id, role)
  values (target_organization_id, current_user_id, 'owner')
  on conflict (organization_id, user_id) do update set role = 'owner';

  update public.invitations
  set accepted_at = now()
  where token = invitation_token;

  return target_organization_id;
end;
$$;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.projects enable row level security;
alter table public.invitations enable row level security;
alter table public.reports enable row level security;
alter table public.report_comments enable row level security;

drop policy if exists "members can read organizations" on public.organizations;
create policy "members can read organizations"
on public.organizations for select
using (public.is_org_member(id));

drop policy if exists "members can update organizations" on public.organizations;
create policy "members can update organizations"
on public.organizations for update
using (public.is_org_member(id))
with check (public.is_org_member(id));

drop policy if exists "members can read profiles" on public.profiles;
create policy "members can read profiles"
on public.profiles for select
to authenticated
using (
  id = auth.uid()
  or exists (
    select 1
    from public.memberships current_memberships
    join public.memberships profile_memberships
      on profile_memberships.organization_id = current_memberships.organization_id
    where current_memberships.user_id = auth.uid()
      and profile_memberships.user_id = profiles.id
  )
);

drop policy if exists "users can insert own profile" on public.profiles;
create policy "users can insert own profile"
on public.profiles for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "users can update own profile" on public.profiles;
create policy "users can update own profile"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "members can read memberships" on public.memberships;
create policy "members can read memberships"
on public.memberships for select
using (public.is_org_member(organization_id));

drop policy if exists "members can manage memberships" on public.memberships;
create policy "members can manage memberships"
on public.memberships for all
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

drop policy if exists "members can manage projects" on public.projects;
create policy "members can manage projects"
on public.projects for all
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

drop policy if exists "members can manage invitations" on public.invitations;
create policy "members can manage invitations"
on public.invitations for all
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

drop policy if exists "members can manage reports" on public.reports;
create policy "members can manage reports"
on public.reports for all
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

drop policy if exists "members can manage comments" on public.report_comments;
create policy "members can manage comments"
on public.report_comments for all
using (
  exists (
    select 1 from public.reports
    where reports.id = report_comments.report_id
      and public.is_org_member(reports.organization_id)
  )
)
with check (
  exists (
    select 1 from public.reports
    where reports.id = report_comments.report_id
      and public.is_org_member(reports.organization_id)
  )
);

insert into storage.buckets (id, name, public)
values ('report-assets', 'report-assets', true)
on conflict (id) do update set public = true;

drop policy if exists "members can upload report assets" on storage.objects;
create policy "members can upload report assets"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'report-assets'
  and public.is_org_member((storage.foldername(name))[1]::uuid)
);

drop policy if exists "members can update report assets" on storage.objects;
create policy "members can update report assets"
on storage.objects for update
to authenticated
using (
  bucket_id = 'report-assets'
  and public.is_org_member((storage.foldername(name))[1]::uuid)
)
with check (
  bucket_id = 'report-assets'
  and public.is_org_member((storage.foldername(name))[1]::uuid)
);

drop policy if exists "members can read report assets" on storage.objects;
create policy "members can read report assets"
on storage.objects for select
to authenticated
using (
  bucket_id = 'report-assets'
  and public.is_org_member((storage.foldername(name))[1]::uuid)
);

drop policy if exists "members can delete report assets" on storage.objects;
create policy "members can delete report assets"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'report-assets'
  and public.is_org_member((storage.foldername(name))[1]::uuid)
);
