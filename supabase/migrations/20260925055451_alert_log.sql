-- alert_log: when each alert was last emailed, so an alert that keeps firing sends a reminder once a
-- day instead of an email on every check. Server-only, like every table (RLS on, no policies).

create table public.alert_log (
  id            text primary key,
  first_sent_at timestamptz not null default now(),
  last_sent_at  timestamptz not null,
  last_title    text not null
);

alter table public.alert_log enable row level security;
