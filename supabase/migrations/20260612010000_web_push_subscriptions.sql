create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists web_push_subscriptions_set_updated_at on public.web_push_subscriptions;
create trigger web_push_subscriptions_set_updated_at
before update on public.web_push_subscriptions
for each row execute function public.set_updated_at();

alter table public.web_push_subscriptions enable row level security;

drop policy if exists "users can read own web push subscriptions" on public.web_push_subscriptions;
create policy "users can read own web push subscriptions"
on public.web_push_subscriptions for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "users can insert own web push subscriptions" on public.web_push_subscriptions;
create policy "users can insert own web push subscriptions"
on public.web_push_subscriptions for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "users can update own web push subscriptions" on public.web_push_subscriptions;
create policy "users can update own web push subscriptions"
on public.web_push_subscriptions for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "users can delete own web push subscriptions" on public.web_push_subscriptions;
create policy "users can delete own web push subscriptions"
on public.web_push_subscriptions for delete
to authenticated
using (user_id = auth.uid());
