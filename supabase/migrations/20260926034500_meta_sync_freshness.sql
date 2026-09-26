-- Freshness and a cross-check for ad platform data:
--   ad_accounts.synced_at   when the account was last pulled (shown as "Meta as of …", and used to
--                            refresh automatically when it's stale)
--   ad_account_daily         the platform's own account-level spend per day, so the Health page can
--                            confirm the ad-level rows add up to what Ads Manager shows.

alter table public.ad_accounts add column synced_at timestamptz;

create table public.ad_account_daily (
  platform   text not null,
  account_id text not null,
  date       date not null,                -- in the ad account's time zone
  spend      numeric(12, 2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (platform, account_id, date),
  foreign key (platform, account_id) references public.ad_accounts (platform, id) on delete cascade
);

alter table public.ad_account_daily enable row level security;
