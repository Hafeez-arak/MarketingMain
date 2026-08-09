-- ════════════════════════════════════════════════════════════════════════
-- Per-account analytics
--
-- One organisation can connect SEVERAL accounts on the same platform (two
-- Instagram accounts for two brands, a personal LinkedIn plus a company
-- page). Without an account key on the metrics, those collapse into one
-- "instagram" number — which isn't just less detail, it's WRONG: it
-- silently averages two different audiences together.
--
-- Zernio's per-day timeline response (`/analytics/post-timeline`) carries
-- platform + platformPostId but NOT accountId, so the account can't be
-- recovered at sync time. It has to be carried forward from PUBLISH time,
-- where we already resolve exactly which account we posted as — hence the
-- column on the post tables as well as on the metrics.
--
-- Run ONCE in the Supabase SQL editor. Idempotent + additive.
-- ════════════════════════════════════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array[
    'instagram_generated_posts',
    'linkedin_generated_posts',
    'generated_posts'
  ] loop
    execute format($f$
      alter table public.%I
        add column if not exists zernio_account_id text default '';
    $f$, t);
  end loop;
end $$;

alter table public.post_analytics
  add column if not exists zernio_account_id text default '';

create index if not exists post_analytics_account_idx
  on public.post_analytics(workspace_id, zernio_account_id)
  where zernio_account_id <> '';
