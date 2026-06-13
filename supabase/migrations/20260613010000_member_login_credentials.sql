alter table public.profiles
add column if not exists login_id text not null default '',
add column if not exists login_password text not null default '';

alter table public.invitations
add column if not exists login_id text not null default '',
add column if not exists login_password text not null default '';

update public.profiles
set login_id = display_name
where login_id = '';

update public.invitations
set login_id = display_name
where login_id = '';

create or replace function public.get_invitation_info(invitation_token text)
returns table (
  email text,
  display_name text,
  login_id text,
  role text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    invitations.email,
    invitations.display_name,
    coalesce(nullif(invitations.login_id, ''), invitations.display_name) as login_id,
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
  target_login_id text;
  target_login_password text;
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception '認証が必要です';
  end if;

  select organization_id, role, invited_user_id, display_name, email, login_id, login_password
    into target_organization_id, target_role, target_user_id, target_display_name, target_email, target_login_id, target_login_password
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

  insert into public.profiles (id, display_name, email, login_id, login_password)
  values (
    current_user_id,
    target_display_name,
    target_email,
    coalesce(nullif(target_login_id, ''), target_display_name),
    target_login_password
  )
  on conflict (id) do update
  set display_name = excluded.display_name,
      email = excluded.email,
      login_id = excluded.login_id,
      login_password = excluded.login_password;

  insert into public.memberships (organization_id, user_id, role)
  values (target_organization_id, current_user_id, target_role)
  on conflict (organization_id, user_id) do update set role = excluded.role;

  update public.invitations
  set accepted_at = now()
  where token = invitation_token;

  return target_organization_id;
end;
$$;
