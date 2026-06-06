alter table public.organizations
add column if not exists invite_token text;

update public.organizations
set invite_token = encode(gen_random_bytes(24), 'hex')
where invite_token is null;

alter table public.organizations
alter column invite_token set default encode(gen_random_bytes(24), 'hex');

alter table public.organizations
alter column invite_token set not null;

create unique index if not exists organizations_invite_token_unique
on public.organizations (invite_token);

create or replace function public.get_invitation_info(invitation_token text)
returns table (organization_name text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select organizations.name
  from public.organizations
  where invite_token = invitation_token
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
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception '認証が必要です';
  end if;

  select id
    into target_organization_id
  from public.organizations
  where invite_token = invitation_token
  limit 1;

  if target_organization_id is null then
    raise exception '招待が見つかりません';
  end if;

  insert into public.memberships (organization_id, user_id, role)
  values (target_organization_id, current_user_id, 'owner')
  on conflict (organization_id, user_id) do update set role = 'owner';

  return target_organization_id;
end;
$$;
