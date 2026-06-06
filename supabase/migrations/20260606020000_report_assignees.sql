alter table public.reports
add column if not exists assignee_ids uuid[] not null default '{}'::uuid[];
