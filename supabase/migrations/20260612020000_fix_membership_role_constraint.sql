do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select conname
    from pg_constraint
    where conrelid = 'public.memberships'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%role%'
  loop
    execute format(
      'alter table public.memberships drop constraint %I',
      constraint_record.conname
    );
  end loop;
end $$;

alter table public.memberships
alter column role set default 'member';

alter table public.memberships
add constraint memberships_role_check
check (role in ('owner', 'member'));
