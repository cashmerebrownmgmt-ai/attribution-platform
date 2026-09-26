-- incrementality_tests: planned ad on/off (or budget-cut) tests. Results are computed from orders and
-- spend when viewed, so a test always reads out against the latest data. The platform never changes
-- ads; the owner pauses or cuts budgets in Ads Manager on the planned dates.

create table public.incrementality_tests (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(name) between 1 and 120),
  design        text not null check (design in ('pause', 'cut')),
  cut_share     numeric(4, 3) not null check (cut_share > 0 and cut_share <= 1),
  platform      text not null default 'meta' check (platform in ('meta', 'google', 'tiktok')),
  campaign_id   text,                                   -- null: every campaign on the platform
  start_date    date not null,                          -- store time zone
  end_date      date not null,
  baseline_days integer not null default 28 check (baseline_days between 14 and 90),
  exclude_email boolean not null default true,
  status        text not null default 'active' check (status in ('active', 'cancelled')),
  notes         text check (length(notes) <= 2000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (end_date >= start_date and end_date - start_date <= 90)
);

alter table public.incrementality_tests enable row level security;
