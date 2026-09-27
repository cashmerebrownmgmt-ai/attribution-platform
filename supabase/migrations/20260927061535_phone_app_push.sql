-- Phone app: web push subscriptions (one per installed device) and notification preferences.

create table public.push_subscriptions (
  endpoint        text primary key,              -- the push service URL for this device
  p256dh          text not null,                 -- device's public key (encrypts the message)
  auth            text not null,                 -- device's auth secret
  device          text,                          -- e.g. "iPhone", for the Settings list
  created_at      timestamptz not null default now(),
  last_success_at timestamptz
);

alter table public.push_subscriptions enable row level security;

-- Goals and on/off switches for push alerts: {"spendCap": 150, "revenueGoal": 500, "lossMinSpend": 50,
-- "on": {"spendCap": true, "loss": true, "revenueGoal": true, "daily": true}}
alter table public.settings add column notify jsonb not null default '{}'::jsonb;
