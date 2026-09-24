-- Dashboard foundation: ad platform data (filled by Phase 2 connectors), team members,
-- settings, and a per-order fact view. See docs/phase-3-spec.md.

-- Ad platform entities ---------------------------------------------------------
-- IDs are the platforms' own IDs; (platform, id) is the key everywhere.

create table public.ad_accounts (
  platform   text not null check (platform in ('meta', 'google', 'tiktok')),
  id         text not null,
  name       text,
  currency   text,
  timezone   text,
  created_at timestamptz not null default now(),
  primary key (platform, id)
);

create table public.campaigns (
  platform      text not null,
  id            text not null,
  account_id    text not null,
  name          text,
  status        text,
  objective     text,
  daily_budget  numeric(12, 2),
  updated_at    timestamptz not null default now(),
  primary key (platform, id),
  foreign key (platform, account_id) references public.ad_accounts (platform, id) on delete cascade
);

create table public.ad_groups (
  platform      text not null,
  id            text not null,
  campaign_id   text not null,
  name          text,
  status        text,
  daily_budget  numeric(12, 2),
  updated_at    timestamptz not null default now(),
  primary key (platform, id),
  foreign key (platform, campaign_id) references public.campaigns (platform, id) on delete cascade
);

create table public.ads (
  platform       text not null,
  id             text not null,
  ad_group_id    text not null,
  campaign_id    text not null,
  name           text,
  status         text,
  format         text,               -- image, video, carousel, text …
  headline       text,
  body           text,
  thumbnail_url  text,
  landing_url    text,               -- with UTMs, checked on the Health page
  launched_at    timestamptz,
  updated_at     timestamptz not null default now(),
  primary key (platform, id),
  foreign key (platform, ad_group_id) references public.ad_groups (platform, id) on delete cascade
);

create index ads_campaign_idx on public.ads (platform, campaign_id);

create table public.ad_insights_daily (
  platform                text not null,
  ad_id                   text not null,
  date                    date not null,     -- in the ad account's time zone
  spend                   numeric(12, 2) not null default 0,
  impressions             bigint not null default 0,
  clicks                  bigint not null default 0,
  reach                   bigint,
  video_views             bigint,
  platform_conversions    numeric(12, 2),    -- what the platform claims, for comparison
  platform_revenue        numeric(12, 2),
  updated_at              timestamptz not null default now(),
  primary key (platform, ad_id, date),
  foreign key (platform, ad_id) references public.ads (platform, id) on delete cascade
);

create index ad_insights_daily_date_idx on public.ad_insights_daily (date);

-- Team -------------------------------------------------------------------------

create table public.members (
  user_id     uuid primary key,            -- auth.users.id
  email       text not null unique,
  role        text not null check (role in ('owner', 'admin', 'viewer')),
  created_at  timestamptz not null default now()
);

create table public.invites (
  email       text primary key,            -- lowercased
  role        text not null check (role in ('admin', 'viewer')),
  invited_by  uuid references public.members (user_id) on delete set null,
  created_at  timestamptz not null default now()
);

-- join_team: called right after sign-in. The first person ever becomes owner; after that,
-- only invited emails get in (and their invite is used up). Returns the role, or null.
create function public.join_team(p_user_id uuid, p_email text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  existing text;
  invited text;
  email_norm text := lower(trim(p_email));
begin
  select role into existing from public.members where user_id = p_user_id;
  if existing is not null then
    return existing;
  end if;

  -- Serialize first-owner bootstrap so two simultaneous sign-ups can't both become owner.
  lock table public.members in share row exclusive mode;

  if not exists (select 1 from public.members) then
    insert into public.members (user_id, email, role) values (p_user_id, email_norm, 'owner');
    return 'owner';
  end if;

  delete from public.invites where email = email_norm returning role into invited;
  if invited is null then
    return null;
  end if;
  insert into public.members (user_id, email, role) values (p_user_id, email_norm, invited);
  return invited;
end;
$$;

-- Settings (single row) -----------------------------------------------------------

create table public.settings (
  id                  boolean primary key default true check (id),
  currency            text not null default 'USD',
  target_roas         numeric(6, 2),
  target_cpa          numeric(12, 2),
  breakeven_roas      numeric(6, 2),
  lookback_days       integer not null default 30 check (lookback_days between 1 and 90),
  business_name       text,
  business_profile    jsonb not null default '{}'::jsonb,  -- products, audience, voice, margins (for the AI advisor)
  updated_at          timestamptz not null default now()
);
insert into public.settings (id) values (true);

-- Order facts --------------------------------------------------------------------
-- One row per order with whether it's the customer's first order, plus its credited touchpoints.

create view public.order_facts
with (security_invoker = true) as
select
  o.id,
  o.name,
  o.created_at,
  coalesce(o.total_price, 0)::numeric(12, 2) as revenue,
  o.currency,
  o.cancelled_at,
  o.stitch_method,
  o.visitor_id,
  -- First order for this customer (by customer ID, else email hash); unknown customers count as new.
  case
    when o.customer_id is null and o.email_hash is null then true
    else not exists (
      select 1 from public.orders p
      where p.id <> o.id
        and p.created_at < o.created_at
        and ((o.customer_id is not null and p.customer_id = o.customer_id)
          or (o.email_hash is not null and p.email_hash = o.email_hash))
    )
  end as is_new_customer
from public.orders o;

-- RLS and grants -----------------------------------------------------------------

alter table public.ad_accounts       enable row level security;
alter table public.campaigns         enable row level security;
alter table public.ad_groups         enable row level security;
alter table public.ads               enable row level security;
alter table public.ad_insights_daily enable row level security;
alter table public.members           enable row level security;
alter table public.invites           enable row level security;
alter table public.settings          enable row level security;

revoke all on public.order_facts from anon, authenticated;
revoke execute on function public.join_team(uuid, text) from public, anon, authenticated;
