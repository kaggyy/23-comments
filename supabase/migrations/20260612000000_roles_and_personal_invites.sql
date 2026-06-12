alter table public.memberships
drop constraint if exists memberships_role_check;

alter table public.memberships
alter column role set default 'member';

alter table public.memberships
add constraint memberships_role_check check (role in ('owner', 'member'));

alter table public.invitations
add column if not exists display_name text not null default '',
add column if not exists role text not null default 'member',
add column if not exists invited_user_id uuid references auth.users(id) on delete cascade,
add column if not exists expires_at timestamptz not null default (now() + interval '24 hours');

alter table public.invitations
drop constraint if exists invitations_role_check;

alter table public.invitations
add constraint invitations_role_check check (role in ('owner', 'member'));

create or replace function public.is_org_owner(target_organization_id uuid)
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
      and role = 'owner'
  );
$$;

create or replace function public.get_invitation_info(invitation_token text)
returns table (email text, display_name text, role text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    invitations.email,
    invitations.display_name,
    invitations.role,
    invitations.expires_at
  from public.invitations
  where token = invitation_token
    and accepted_at is null
    and expires_at > now()
  limit 1;

  if not found then
    raise exception '招待が見つかりません';
  end if;
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
  target_role text;
  target_user_id uuid;
  target_display_name text;
  target_email text;
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception '認証が必要です';
  end if;

  select organization_id, role, invited_user_id, display_name, email
    into target_organization_id, target_role, target_user_id, target_display_name, target_email
  from public.invitations
  where token = invitation_token
    and accepted_at is null
    and expires_at > now()
  limit 1;

  if target_organization_id is null then
    raise exception '招待が見つかりません';
  end if;

  if target_user_id is not null and target_user_id <> current_user_id then
    raise exception '招待されたアカウントでログインしてください';
  end if;

  insert into public.profiles (id, display_name, email)
  values (current_user_id, target_display_name, target_email)
  on conflict (id) do update
  set display_name = excluded.display_name,
      email = excluded.email;

  insert into public.memberships (organization_id, user_id, role)
  values (target_organization_id, current_user_id, target_role)
  on conflict (organization_id, user_id) do update set role = excluded.role;

  update public.invitations
  set accepted_at = now()
  where token = invitation_token;

  return target_organization_id;
end;
$$;

drop policy if exists "members can update organizations" on public.organizations;
create policy "owners can update organizations"
on public.organizations for update
using (public.is_org_owner(id))
with check (public.is_org_owner(id));

drop policy if exists "members can manage memberships" on public.memberships;
create policy "owners can insert memberships"
on public.memberships for insert
with check (public.is_org_owner(organization_id));

create policy "owners can update memberships"
on public.memberships for update
using (public.is_org_owner(organization_id))
with check (public.is_org_owner(organization_id));

create policy "owners can delete memberships"
on public.memberships for delete
using (public.is_org_owner(organization_id));

drop policy if exists "members can manage projects" on public.projects;
create policy "members can read projects"
on public.projects for select
using (public.is_org_member(organization_id));

create policy "owners can insert projects"
on public.projects for insert
with check (public.is_org_owner(organization_id));

create policy "owners can update projects"
on public.projects for update
using (public.is_org_owner(organization_id))
with check (public.is_org_owner(organization_id));

create policy "owners can delete projects"
on public.projects for delete
using (public.is_org_owner(organization_id));

drop policy if exists "members can manage invitations" on public.invitations;
create policy "owners can manage invitations"
on public.invitations for all
using (public.is_org_owner(organization_id))
with check (public.is_org_owner(organization_id));

drop policy if exists "members can manage reports" on public.reports;
create policy "members can read reports"
on public.reports for select
using (public.is_org_member(organization_id));

create policy "members can insert reports"
on public.reports for insert
with check (public.is_org_member(organization_id));

create policy "members can update reports"
on public.reports for update
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

create policy "owners can delete reports"
on public.reports for delete
using (public.is_org_owner(organization_id));

drop policy if exists "members can manage comments" on public.report_comments;
create policy "members can read comments"
on public.report_comments for select
using (
  exists (
    select 1 from public.reports
    where reports.id = report_comments.report_id
      and public.is_org_member(reports.organization_id)
  )
);

create policy "members can insert comments"
on public.report_comments for insert
with check (
  created_by = auth.uid()
  and
  exists (
    select 1 from public.reports
    where reports.id = report_comments.report_id
      and public.is_org_member(reports.organization_id)
  )
);

create policy "owners or authors can update comments"
on public.report_comments for update
using (
  created_by = auth.uid()
  or exists (
    select 1 from public.reports
    where reports.id = report_comments.report_id
      and public.is_org_owner(reports.organization_id)
  )
)
with check (
  created_by = auth.uid()
  or exists (
    select 1 from public.reports
    where reports.id = report_comments.report_id
      and public.is_org_owner(reports.organization_id)
  )
);

create policy "owners or authors can delete comments"
on public.report_comments for delete
using (
  created_by = auth.uid()
  or exists (
    select 1 from public.reports
    where reports.id = report_comments.report_id
      and public.is_org_owner(reports.organization_id)
  )
);

drop policy if exists "members can delete report assets" on storage.objects;
create policy "owners can delete report assets"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'report-assets'
  and public.is_org_owner((storage.foldername(name))[1]::uuid)
);
