-- ════════════════════════════════════════════════════════════════════════
-- Competitor intelligence: identities, distribution rights, and lost deals
-- ════════════════════════════════════════════════════════════════════════
-- Three problems, found on 2026-09-16 when the sales team's list of 20 rivals
-- was reconciled against the 12 the agent had been researching. Exactly one
-- name overlapped, and the store held 16 signals in total — 12 of them with no
-- competitor attached at all.
--
-- ── 1. A NAME IS NOT AN IDENTITY ──
-- The watchlist stored a string. That is not enough to research anyone:
-- "Lumiere" is at least four different Saudi companies, and "Al Nasser" is at
-- least three (alnassergroup.com, al-nasser.com, alnasser.me) plus a separate
-- retail store. A lens handed a name alone has already gone to the wrong one.
-- So: `domain` is the identity, and everything that decides HOW a rival is
-- researched — which business lines, what kind of company, which city — sits
-- beside it in a column rather than in prose nobody parses.
--
-- `lines` and `kinds` are ARRAYS, and that is not tidiness. Four of the
-- seventeen rivals sell into both of our business lines, and Nassli runs two
-- businesses on two domains. Al Nasser is manufacturer AND distributor AND
-- retailer AND integrator. A single value would force a wrong answer on
-- exactly the companies that matter most.
--
-- ── 2. TIER IS ABOUT ENCOUNTER, NOT ABOUT WHO REMEMBERED IT ──
-- The first cut of this list tiered by SOURCE — sales-named was tier 1, agent-
-- discovered was tier 2 — which points the search budget at whoever came up in
-- a meeting. A rival met once a year is not tier 1. So `tier` records how often
-- a rival is actually encountered and how much a deal against them is worth,
-- `source` records who put them on the list, and they are different columns.
--
-- `tier` is NULLABLE ON PURPOSE. It can only come from the sales team, and a
-- default would be an invention dressed as data. Null means "not yet set", and
-- the loader falls back to list order until it is.
--
-- ── 3. THE TWO QUESTIONS NOTHING COULD ANSWER ──
-- `competitor_brands` — in lighting, distribution rights decide who can bid
-- what. Al Nasser is the exclusive Berker partner for Saudi Arabia; that single
-- fact says more about what they can win than any amount of social activity.
-- There was nowhere to put it.
--
-- `deal_outcomes` — "who are we losing to, and on what" is the question the
-- business actually wants answered, and every other part of this system
-- collects from the public web, where the answer is not. It is internal, it
-- comes from people, and without it the rest of competitor analysis is
-- interesting rather than useful.

-- ── The watchlist becomes a list of identities ──────────────────────────

alter table public.research_agenda
  -- The identity. Empty means unresolved, and the rivals lens is told to skip
  -- rather than guess: a search spent on the wrong company is worse than none.
  add column if not exists domain      text not null default '',
  -- Which of OUR business lines this rival competes in. Free text per element
  -- rather than an enum: the lines come from the brand's own configuration
  -- (customFields.business_lines) and differ per workspace.
  add column if not exists lines       text[] not null default '{}',
  -- What kind of company. Decides which axes are worth comparing at all — an
  -- ELV integrator has no follower count worth reading and a manufacturer has
  -- no commissioning bench.
  add column if not exists kinds       text[] not null default '{}',
  add column if not exists city        text not null default '',
  -- 1 = met on most shortlists, 3 = rarely encountered. Sales owns this.
  add column if not exists tier        int check (tier between 1 and 3),
  add column if not exists source      text not null default 'sales'
                                       check (source in ('sales', 'agent', 'research')),
  -- Whether the NAME even refers to a company. Some entries on a sales list
  -- are brands or showroom names, and the competitor is then whoever holds the
  -- agency — a different row entirely.
  add column if not exists resolution  text not null default 'unresolved'
                                       check (resolution in ('company', 'brand', 'showroom', 'unresolvable', 'unresolved'));

create index if not exists research_agenda_competitor_tier_idx
  on public.research_agenda (workspace_id, tier nulls last)
  where kind = 'competitor' and status = 'active';

-- ── Distribution rights ─────────────────────────────────────────────────

create table if not exists public.competitor_brands (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  -- Null when the brand was seen on a company not yet on the watchlist. That
  -- is a signal too, so the row is kept rather than dropped.
  competitor_id  uuid references public.research_agenda(id) on delete cascade,
  competitor     text not null default '',
  brand          text not null,
  -- 'claimed' is what the competitor says; 'unconfirmed' is what we inferred.
  -- Keeping them apart is the difference between evidence and repetition.
  relationship   text not null default 'unconfirmed'
                 check (relationship in ('exclusive', 'non_exclusive', 'claimed', 'unconfirmed', 'ended')),
  -- Which of our lines this brand competes in, when it is line-specific.
  line           text not null default '',
  -- True when we carry it too. Computed by a person or by code against the
  -- brand's own product index — never asserted by a model.
  we_carry_it    boolean,
  source_url     text not null default '',
  source_title   text not null default '',
  observed_at    date,
  note           text not null default '',
  fingerprint    text not null,
  first_run_id   uuid references public.research_runs(id) on delete set null,
  last_run_id    uuid references public.research_runs(id) on delete set null,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

create unique index if not exists competitor_brands_fp_idx
  on public.competitor_brands (workspace_id, fingerprint);
create index if not exists competitor_brands_brand_idx
  on public.competitor_brands (workspace_id, lower(brand));

-- ── Lost and contested deals ────────────────────────────────────────────
-- The only table here a model never writes to. Every row is entered by a
-- person after a bid, and `created_by` records which one.

create table if not exists public.deal_outcomes (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  project         text not null,
  -- Free text as well as a link: the winner is often not on the watchlist yet,
  -- and refusing the row until it is would lose the very thing worth knowing.
  competitor      text not null default '',
  competitor_id   uuid references public.research_agenda(id) on delete set null,
  line            text not null default '',
  outcome         text not null default 'lost'
                  check (outcome in ('lost', 'won', 'open', 'no_bid')),
  -- What actually decided it. The whole point of the table.
  decided_by      text not null default 'unknown'
                  check (decided_by in ('price', 'lead_time', 'spec_lock_in', 'relationship',
                                        'agency_rights', 'compliance', 'scope', 'other', 'unknown')),
  -- Roughly how far off we were, in percent. Rough is fine and useful; precise
  -- is not available and waiting for it is how a log like this dies.
  price_delta_pct numeric,
  value_sar       numeric,
  client          text not null default '',
  consultant      text not null default '',
  contractor      text not null default '',
  decided_on      date,
  note            text not null default '',
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists deal_outcomes_recent_idx
  on public.deal_outcomes (workspace_id, decided_on desc nulls last);
create index if not exists deal_outcomes_competitor_idx
  on public.deal_outcomes (workspace_id, lower(competitor));

-- ── RLS ──
-- Membership, not isolation: the operators belong to every workspace, so this
-- passes all of them at once. Every query in application code carries its own
-- workspace_id filter. RLS is not isolation in this database.
alter table public.competitor_brands enable row level security;
alter table public.deal_outcomes enable row level security;

drop policy if exists competitor_brands_member on public.competitor_brands;
create policy competitor_brands_member on public.competitor_brands
  for all to authenticated
  using (exists (select 1 from public.workspace_members m
                 where m.workspace_id = competitor_brands.workspace_id and m.user_id = auth.uid()))
  with check (exists (select 1 from public.workspace_members m
                      where m.workspace_id = competitor_brands.workspace_id and m.user_id = auth.uid()));

drop policy if exists deal_outcomes_member on public.deal_outcomes;
create policy deal_outcomes_member on public.deal_outcomes
  for all to authenticated
  using (exists (select 1 from public.workspace_members m
                 where m.workspace_id = deal_outcomes.workspace_id and m.user_id = auth.uid()))
  with check (exists (select 1 from public.workspace_members m
                      where m.workspace_id = deal_outcomes.workspace_id and m.user_id = auth.uid()));
