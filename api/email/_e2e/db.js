import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

// ─── A real Postgres for the email end-to-end tests ────────────────────────
// PGlite runs Postgres in-process, so the tests meet the real check
// constraints, unique indexes, defaults and the email_campaign_stats view,
// built from the same migration files that were applied to production.
// The prelude stands in for what those migrations lean on from elsewhere:
// Supabase's auth schema and roles, workspaces, membership, research tables.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

export const EMAIL_MIGRATIONS = [
  '20260927_email_marketing',
  '20260928_email_ai_drafts',
  '20260929_cold_sending',
  '20260930_mailbox_microsoft_signin',
  '20261001_newsletter_subscribe',
  '20261002_research_outreach_dismissed',
  '20261003_website_signup_key',
]

const PRELUDE = `
create schema if not exists auth;
create table auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select 'service_role'::text $$;
do $$ begin
  create role anon; exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role; exception when duplicate_object then null; end $$;

create table public.workspaces (id uuid primary key, name text not null default '');
create table public.workspace_members (workspace_id uuid references public.workspaces(id), user_id uuid, role text default 'member');
create or replace function public.is_workspace_member(ws_id uuid) returns boolean language sql stable as $$
  select exists (select 1 from public.workspace_members m where m.workspace_id = ws_id and m.user_id = auth.uid())
$$;

create table public.research_runs (id uuid primary key default gen_random_uuid(), workspace_id uuid references public.workspaces(id));
create table public.research_opportunities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  type text not null default 'project', name text not null, headline text not null default '',
  client text not null default '', contractor text not null default '', consultant text not null default '',
  location text not null default '', scope text not null default '', stage text not null default '',
  deadline date, timing text not null default 'unconfirmed', relevance text not null default 'medium',
  suggested_action text not null default '', source_url text not null default '', sources jsonb not null default '[]',
  status text not null default 'new', owner_note text not null default '', fingerprint text not null default '',
  first_run_id uuid, last_run_id uuid, first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(), times_seen int not null default 1, last_change text not null default '',
  line text not null default '', updated_at timestamptz not null default now(), created_at timestamptz not null default now()
);
`

export async function freshDatabase() {
  const pg = new PGlite()
  await pg.exec(PRELUDE)
  for (const name of EMAIL_MIGRATIONS) {
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations', `${name}.sql`), 'utf8')
    try {
      await pg.exec(sql)
    } catch (err) {
      throw new Error(`Migration ${name} failed: ${err.message}`, { cause: err })
    }
  }
  return pg
}
