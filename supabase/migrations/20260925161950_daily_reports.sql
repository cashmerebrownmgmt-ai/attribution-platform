-- daily_reports: the morning snapshot of yesterday's report (in the store's time zone), so it reads
-- the same whenever it's opened and past days stay available. Server-only (RLS on, no policies).

create table public.daily_reports (
  day          date primary key,
  generated_at timestamptz not null,
  report       jsonb not null
);

alter table public.daily_reports enable row level security;
