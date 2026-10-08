-- ════════════════════════════════════════════════════════════════════════
-- Battle cards: what sales collects, asks and answers on every deal
-- ════════════════════════════════════════════════════════════════════════
-- A battle card is the salesperson's one-page "gun": what to know before the
-- call, what to find out during it, how to answer the objections our own
-- won and lost deals keep raising, and what to record after it.
--
-- Two cards per company — outbound (we contact them) and inbound (they
-- contact us) — kept as data, like the ICP, so each company writes its own
-- and nothing about a client or a playbook sits in this public repository.
--
-- Its own column rather than a key inside `config`: the ICP editor rewrites
-- `config` whole, and a card stored there would vanish on the next save.

alter table public.sales_icp
  add column if not exists battle_cards jsonb not null default '{}'::jsonb;

comment on column public.sales_icp.battle_cards is
  'Battle cards as data: { outbound: card, inbound: card }. See src/lib/sales/battleCard.js for the shape.';
