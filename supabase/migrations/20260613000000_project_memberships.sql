do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_id_organization_id_key'
  ) then
    alter table public.projects
    add constraint projects_id_organization_id_key unique (id, organization_id);
  end if;
end $$;

create table if not exists public.project_memberships (
  organization_id uuid not null,
  project_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id),
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id)
    on delete cascade,
  foreign key (organization_id, user_id)
    references public.memberships (organization_id, user_id)
    on delete cascade
);

insert into public.project_memberships (organization_id, project_id, user_id)
select projects.organization_id, projects.id, memberships.user_id
from public.projects
join public.memberships
  on memberships.organization_id = projects.organization_id
on conflict (project_id, user_id) do nothing;

alter table public.project_memberships enable row level security;

drop policy if exists "members can read project memberships" on public.project_memberships;
create policy "members can read project memberships"
on public.project_memberships for select
using (public.is_org_member(organization_id));

drop policy if exists "owners can insert project memberships" on public.project_memberships;
create policy "owners can insert project memberships"
on public.project_memberships for insert
with check (public.is_org_owner(organization_id));

drop policy if exists "owners can delete project memberships" on public.project_memberships;
create policy "owners can delete project memberships"
on public.project_memberships for delete
using (public.is_org_owner(organization_id));
