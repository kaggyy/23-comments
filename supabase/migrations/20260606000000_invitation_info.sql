create or replace function public.get_invitation_info(invitation_token text)
returns table (email text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select invitations.email
  from public.invitations
  where token = invitation_token
    and accepted_at is null
  limit 1;

  if not found then
    raise exception '招待が見つかりません';
  end if;
end;
$$;
