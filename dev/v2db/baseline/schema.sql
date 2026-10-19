-- ─── v2 baseline: production's schema, rebuilt from its catalog ──────────
-- GENERATED FILE. Made by dev/v2db/baseline/generate-schema.sql (read-only
-- catalog queries against production, no rows from application tables) and
-- dev/v2db/baseline/build-schema.py. Do not edit by hand: regenerate it, and
-- put local-only adjustments in local-fixes.sql. See dev/v2db/README.md.
-- 1362 statements.

SET client_min_messages = warning;
-- Function bodies reference tables/views created later in this file.
SET check_function_bodies = off;
SET search_path = public, extensions;


-- ═══ Extensions ════════════════════

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- ═══ Tables (columns, defaults, generated columns, NOT NULL) ════════════════════

CREATE TABLE public.access_invites (
  email text NOT NULL,
  invited_at timestamp with time zone DEFAULT now() NOT NULL,
  invited_by uuid,
  workspace_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  role text DEFAULT 'member'::text NOT NULL
);

CREATE TABLE public.account_analytics (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  account_id text NOT NULL,
  platform text DEFAULT 'instagram'::text NOT NULL,
  publish_provider text DEFAULT 'meta'::text NOT NULL,
  metric_date date NOT NULL,
  followers_count integer DEFAULT 0,
  follows_count integer DEFAULT 0,
  media_count integer DEFAULT 0,
  reach integer DEFAULT 0,
  views integer DEFAULT 0,
  profile_views integer DEFAULT 0,
  accounts_engaged integer DEFAULT 0,
  total_interactions integer DEFAULT 0,
  likes integer DEFAULT 0,
  comments integer DEFAULT 0,
  saves integer DEFAULT 0,
  shares integer DEFAULT 0,
  clicks integer DEFAULT 0,
  metrics_present text[] DEFAULT '{}'::text[],
  synced_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.agent_cap_log (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  changed_by uuid,
  old_cap numeric,
  new_cap numeric,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.agent_digest (
  workspace_id uuid NOT NULL,
  digest text DEFAULT ''::text NOT NULL,
  approx_tokens integer DEFAULT 0 NOT NULL,
  built_through timestamp with time zone,
  built_at timestamp with time zone DEFAULT now() NOT NULL,
  build_error text DEFAULT ''::text NOT NULL
);

CREATE TABLE public.agent_edit_log (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  user_id uuid,
  chat_id uuid,
  tool text DEFAULT ''::text NOT NULL,
  table_name text NOT NULL,
  row_id text DEFAULT ''::text NOT NULL,
  action text NOT NULL,
  before jsonb,
  after jsonb,
  undoes uuid,
  undone_at timestamp with time zone,
  undone_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.agent_notes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  kind text NOT NULL,
  body text NOT NULL,
  fingerprint text NOT NULL,
  source text NOT NULL,
  source_id uuid,
  status text DEFAULT 'new'::text NOT NULL,
  seen_count integer DEFAULT 1 NOT NULL,
  expires_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.agent_usage (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  surface text DEFAULT 'chat'::text NOT NULL,
  stage text DEFAULT ''::text,
  run_id uuid,
  chat_id uuid,
  model text DEFAULT ''::text NOT NULL,
  tokens_in integer DEFAULT 0 NOT NULL,
  tokens_cache_read integer DEFAULT 0 NOT NULL,
  tokens_cache_write integer DEFAULT 0 NOT NULL,
  tokens_out integer DEFAULT 0 NOT NULL,
  cost_usd numeric DEFAULT 0 NOT NULL,
  error text DEFAULT ''::text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  searches integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.app_config (
  key text NOT NULL,
  value text DEFAULT ''::text NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.brand_assets (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  kind text DEFAULT 'other'::text NOT NULL,
  storage_path text NOT NULL,
  public_url text NOT NULL,
  title text DEFAULT ''::text,
  caption text DEFAULT ''::text,
  tags text[] DEFAULT '{}'::text[],
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  project text DEFAULT ''::text
);

CREATE TABLE public.brand_competitors (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  positioning text DEFAULT ''::text,
  strengths text DEFAULT ''::text,
  how_we_differ text DEFAULT ''::text,
  watch_url text DEFAULT ''::text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.brand_directory_columns (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  section_key text NOT NULL,
  key text NOT NULL,
  label text NOT NULL,
  placeholder text DEFAULT ''::text,
  wide boolean DEFAULT false NOT NULL,
  in_prompt boolean DEFAULT true NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.brand_directory_rows (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  section_key text NOT NULL,
  data jsonb DEFAULT '{}'::jsonb NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.brand_edit_feedback (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  platform text NOT NULL,
  post_id text,
  field text NOT NULL,
  original_text text,
  edited_text text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  workspace_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL
);

CREATE TABLE public.brand_fields (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  section_key text NOT NULL,
  key text NOT NULL,
  label text NOT NULL,
  hint text DEFAULT ''::text,
  placeholder text DEFAULT ''::text,
  input_type text DEFAULT 'textarea'::text NOT NULL,
  options text[] DEFAULT '{}'::text[],
  rows integer DEFAULT 4,
  storage_column text DEFAULT ''::text,
  prompt_label text DEFAULT ''::text,
  include_in_prompt boolean DEFAULT true NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  tasks text[] DEFAULT '{}'::text[] NOT NULL
);

CREATE TABLE public.brand_memory (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  scope text DEFAULT 'global'::text NOT NULL,
  rule text NOT NULL,
  detail text DEFAULT ''::text,
  evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
  source text DEFAULT 'human'::text NOT NULL,
  status text DEFAULT 'proposed'::text NOT NULL,
  tasks text[] DEFAULT '{}'::text[] NOT NULL,
  confidence numeric,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  reviewed_at timestamp with time zone,
  reviewed_by uuid
);

CREATE TABLE public.brand_message_templates (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  channel text DEFAULT 'whatsapp'::text NOT NULL,
  name text NOT NULL,
  category text DEFAULT ''::text,
  subject text DEFAULT ''::text,
  body text DEFAULT ''::text,
  status text DEFAULT 'draft'::text,
  notes text DEFAULT ''::text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.brand_products (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  category text DEFAULT ''::text,
  supplier text DEFAULT ''::text,
  description text DEFAULT ''::text,
  specs text DEFAULT ''::text,
  price_range text DEFAULT ''::text,
  image_url text DEFAULT ''::text,
  tags text[] DEFAULT '{}'::text[],
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.brand_profile (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  voice_descriptors text,
  tone_dos text,
  tone_donts text,
  target_personas text,
  key_projects text,
  visual_style_notes text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  workspace_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
  mission text DEFAULT ''::text,
  positioning text DEFAULT ''::text,
  value_proposition text DEFAULT ''::text,
  brand_story text DEFAULT ''::text,
  company_facts text DEFAULT ''::text,
  visual_identity text DEFAULT ''::text,
  market_context text DEFAULT ''::text,
  product_sheet_path text DEFAULT ''::text,
  product_index text DEFAULT ''::text,
  contact_info text DEFAULT ''::text,
  languages text DEFAULT ''::text,
  brand_colors text DEFAULT ''::text,
  compliance_notes text DEFAULT ''::text,
  offers_ctas text DEFAULT ''::text,
  caption_language text DEFAULT 'both'::text,
  arabic_dialect text DEFAULT 'saudi'::text,
  custom_fields jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE public.brand_sections (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  key text NOT NULL,
  title text NOT NULL,
  description text DEFAULT ''::text,
  kind text DEFAULT 'fields'::text NOT NULL,
  icon text DEFAULT ''::text,
  sort_order integer DEFAULT 0 NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  tasks text[] DEFAULT '{}'::text[] NOT NULL
);

CREATE TABLE public.brand_suppliers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  category text DEFAULT ''::text,
  brand_lines text DEFAULT ''::text,
  notes text DEFAULT ''::text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.ceo_briefs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  period_start timestamp with time zone NOT NULL,
  period_end timestamp with time zone NOT NULL,
  kpis jsonb DEFAULT '[]'::jsonb NOT NULL,
  facts jsonb DEFAULT '{}'::jsonb NOT NULL,
  brief jsonb DEFAULT '{}'::jsonb NOT NULL,
  trigger text DEFAULT 'manual'::text NOT NULL,
  created_by uuid,
  model text DEFAULT ''::text NOT NULL,
  cost_usd numeric DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.competitor_brands (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  competitor_id uuid,
  competitor text DEFAULT ''::text NOT NULL,
  brand text NOT NULL,
  relationship text DEFAULT 'unconfirmed'::text NOT NULL,
  line text DEFAULT ''::text NOT NULL,
  we_carry_it boolean,
  source_url text DEFAULT ''::text NOT NULL,
  source_title text DEFAULT ''::text NOT NULL,
  observed_at date,
  note text DEFAULT ''::text NOT NULL,
  fingerprint text NOT NULL,
  first_run_id uuid,
  last_run_id uuid,
  first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.competitor_snapshots (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  run_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  agenda_id uuid,
  competitor_name text NOT NULL,
  ig_handle text DEFAULT ''::text,
  is_self boolean DEFAULT false NOT NULL,
  data_source text DEFAULT 'web_only'::text NOT NULL,
  followers integer,
  follows integer,
  media_count integer,
  posts_in_period integer,
  posts_per_week numeric,
  format_mix jsonb DEFAULT '{}'::jsonb NOT NULL,
  avg_engagement numeric,
  engagement_per_1k numeric,
  top_posts jsonb DEFAULT '[]'::jsonb NOT NULL,
  post_hours jsonb DEFAULT '{}'::jsonb NOT NULL,
  sample_size integer,
  captured_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.content_plans (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  name text DEFAULT ''::text NOT NULL,
  month text DEFAULT ''::text,
  start_date date,
  end_date date,
  goal text DEFAULT ''::text,
  goal_category text DEFAULT ''::text,
  platforms text[] DEFAULT '{}'::text[],
  status text DEFAULT 'draft'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  featured_products text[] DEFAULT '{}'::text[],
  reference_pool text[] DEFAULT '{}'::text[],
  posting_days text[] DEFAULT '{}'::text[],
  default_time text DEFAULT '19:00'::text,
  content_mix_target text,
  kind text DEFAULT 'monthly'::text,
  generation_result jsonb,
  generation_error text DEFAULT ''::text,
  generation_started_at timestamp with time zone,
  generation_mode text DEFAULT 'new'::text
);

CREATE TABLE public.creative_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  created_by uuid,
  title text DEFAULT ''::text,
  intent text DEFAULT 'image'::text NOT NULL,
  aspect_ratio text DEFAULT '1:1'::text NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  storyboard jsonb,
  clip_run_status text DEFAULT ''::text NOT NULL,
  plan_idea_id uuid,
  brief jsonb
);

CREATE TABLE public.creative_versions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  session_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  round integer DEFAULT 0 NOT NULL,
  parent_version_id uuid,
  kind text NOT NULL,
  provider text DEFAULT ''::text NOT NULL,
  user_prompt text DEFAULT ''::text,
  reference_url text DEFAULT ''::text,
  reference_notes text DEFAULT ''::text,
  image_url text DEFAULT ''::text,
  video_url text DEFAULT ''::text,
  media_type text DEFAULT 'image'::text NOT NULL,
  aspect_ratio text DEFAULT ''::text,
  overlay_state jsonb,
  status text DEFAULT 'pending'::text NOT NULL,
  error text DEFAULT ''::text,
  is_selected boolean DEFAULT false NOT NULL,
  is_final boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  original_prompt text DEFAULT ''::text,
  prompt_source text DEFAULT 'raw'::text NOT NULL,
  duration text DEFAULT ''::text,
  resolution text DEFAULT ''::text,
  generate_audio boolean DEFAULT false NOT NULL,
  model text DEFAULT 'seedance-2'::text NOT NULL,
  clip_index integer,
  clip_attempt integer,
  clip_role text
);

CREATE TABLE public.deal_outcomes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  project text NOT NULL,
  competitor text DEFAULT ''::text NOT NULL,
  competitor_id uuid,
  line text DEFAULT ''::text NOT NULL,
  outcome text DEFAULT 'lost'::text NOT NULL,
  decided_by text DEFAULT 'unknown'::text NOT NULL,
  price_delta_pct numeric,
  value_sar numeric,
  client text DEFAULT ''::text NOT NULL,
  consultant text DEFAULT ''::text NOT NULL,
  contractor text DEFAULT ''::text NOT NULL,
  decided_on date,
  note text DEFAULT ''::text NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.email_ai_drafts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  week_of date NOT NULL,
  status text DEFAULT 'running'::text NOT NULL,
  options jsonb DEFAULT '[]'::jsonb NOT NULL,
  note text DEFAULT ''::text NOT NULL,
  inputs jsonb DEFAULT '{}'::jsonb NOT NULL,
  research_run_id uuid,
  model text DEFAULT ''::text NOT NULL,
  cost_usd numeric(10,4) DEFAULT 0 NOT NULL,
  error text DEFAULT ''::text NOT NULL,
  trigger text DEFAULT 'scheduled'::text NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  finished_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.email_campaigns (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  audience text NOT NULL,
  name text DEFAULT ''::text NOT NULL,
  subject text DEFAULT ''::text NOT NULL,
  preheader text DEFAULT ''::text NOT NULL,
  body text DEFAULT ''::text NOT NULL,
  language text DEFAULT 'en'::text NOT NULL,
  group_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  follow_ups jsonb DEFAULT '[]'::jsonb NOT NULL,
  status text DEFAULT 'draft'::text NOT NULL,
  scheduled_for timestamp with time zone,
  from_name text DEFAULT ''::text NOT NULL,
  from_email text DEFAULT ''::text NOT NULL,
  reply_to text DEFAULT ''::text NOT NULL,
  recipients integer DEFAULT 0 NOT NULL,
  launched_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  language_only boolean DEFAULT false NOT NULL,
  design jsonb,
  mailbox_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  variants jsonb DEFAULT '[]'::jsonb NOT NULL
);

CREATE TABLE public.email_contacts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  email text NOT NULL,
  first_name text DEFAULT ''::text NOT NULL,
  last_name text DEFAULT ''::text NOT NULL,
  company text DEFAULT ''::text NOT NULL,
  job_title text DEFAULT ''::text NOT NULL,
  phone text DEFAULT ''::text NOT NULL,
  city text DEFAULT ''::text NOT NULL,
  country text DEFAULT ''::text NOT NULL,
  contact_type text DEFAULT ''::text NOT NULL,
  audience text DEFAULT 'marketing'::text NOT NULL,
  language text DEFAULT 'en'::text NOT NULL,
  consent text DEFAULT 'business_contact'::text NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  source text DEFAULT 'manual'::text NOT NULL,
  notes text DEFAULT ''::text NOT NULL,
  replied_at timestamp with time zone,
  opportunity_id uuid,
  unsubscribe_token uuid DEFAULT gen_random_uuid() NOT NULL,
  unsubscribed_at timestamp with time zone,
  last_sent_at timestamp with time zone,
  last_opened_at timestamp with time zone,
  last_clicked_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  subscribed_at timestamp with time zone,
  subscribed_campaign_id uuid,
  custom jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE public.email_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid,
  send_id uuid,
  provider_id text,
  type text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.email_group_exclusions (
  group_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  excluded_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.email_group_members (
  group_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  added_at timestamp with time zone DEFAULT now() NOT NULL,
  added_by text DEFAULT 'person'::text NOT NULL
);

CREATE TABLE public.email_groups (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  description text DEFAULT ''::text NOT NULL,
  audience text DEFAULT 'marketing'::text NOT NULL,
  color text DEFAULT 'steel'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  managed_by text DEFAULT ''::text NOT NULL
);

CREATE TABLE public.email_mailbox_secrets (
  mailbox_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  secret text NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.email_mailboxes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  provider text DEFAULT 'smtp'::text NOT NULL,
  email text NOT NULL,
  from_name text DEFAULT ''::text NOT NULL,
  signature text DEFAULT ''::text NOT NULL,
  smtp_host text DEFAULT ''::text NOT NULL,
  smtp_port integer DEFAULT 465 NOT NULL,
  imap_host text DEFAULT ''::text NOT NULL,
  imap_port integer DEFAULT 993 NOT NULL,
  username text DEFAULT ''::text NOT NULL,
  daily_limit integer DEFAULT 15 NOT NULL,
  warmup_started_on date,
  first_sent_on date,
  last_sent_at timestamp with time zone,
  next_send_at timestamp with time zone,
  status text DEFAULT 'active'::text NOT NULL,
  status_reason text DEFAULT ''::text NOT NULL,
  last_error text DEFAULT ''::text NOT NULL,
  last_checked_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  auth_method text DEFAULT 'password'::text NOT NULL,
  inbox_checked_at timestamp with time zone,
  tenant text DEFAULT ''::text NOT NULL,
  warmup_per_day integer DEFAULT 0 NOT NULL,
  warmup_days integer DEFAULT 14 NOT NULL,
  dns_check jsonb DEFAULT '{}'::jsonb NOT NULL,
  dns_checked_at timestamp with time zone
);

CREATE TABLE public.email_sends (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  contact_id uuid,
  email text NOT NULL,
  step integer DEFAULT 0 NOT NULL,
  status text DEFAULT 'queued'::text NOT NULL,
  due_at timestamp with time zone DEFAULT now() NOT NULL,
  subject text DEFAULT ''::text NOT NULL,
  body text DEFAULT ''::text NOT NULL,
  provider_id text,
  error text DEFAULT ''::text NOT NULL,
  sent_at timestamp with time zone,
  delivered_at timestamp with time zone,
  opened_at timestamp with time zone,
  clicked_at timestamp with time zone,
  bounced_at timestamp with time zone,
  complained_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  mailbox_id uuid,
  message_id text,
  replied_at timestamp with time zone,
  thread_id text,
  subscribed_at timestamp with time zone,
  variant smallint DEFAULT 0 NOT NULL
);

CREATE TABLE public.email_settings (
  workspace_id uuid NOT NULL,
  from_name text DEFAULT ''::text NOT NULL,
  from_email text DEFAULT ''::text NOT NULL,
  reply_to text DEFAULT ''::text NOT NULL,
  company_address text DEFAULT ''::text NOT NULL,
  warmup_started_on date,
  warmup_enabled boolean DEFAULT true NOT NULL,
  provider_daily_limit integer DEFAULT 100 NOT NULL,
  provider_monthly_limit integer DEFAULT 3000 NOT NULL,
  cold_from_name text DEFAULT ''::text NOT NULL,
  cold_from_email text DEFAULT ''::text NOT NULL,
  cold_daily_limit integer DEFAULT 20 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  cold_sending_enabled boolean DEFAULT false NOT NULL,
  newsletter_name text DEFAULT ''::text NOT NULL,
  subscribe_offer text DEFAULT ''::text NOT NULL,
  subscribe_gift_url text DEFAULT ''::text NOT NULL,
  website_signup_key text
);

CREATE TABLE public.generated_posts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  platform text NOT NULL,
  caption text DEFAULT ''::text,
  caption_ar text DEFAULT ''::text,
  caption_en text DEFAULT ''::text,
  hashtags text DEFAULT ''::text,
  first_comment text DEFAULT ''::text,
  topic text DEFAULT ''::text,
  format text DEFAULT ''::text,
  media_type text DEFAULT 'image'::text,
  aspect_ratio text DEFAULT ''::text,
  style text DEFAULT ''::text,
  image_url text DEFAULT ''::text,
  image_urls text[] DEFAULT '{}'::text[],
  image_prompt text DEFAULT ''::text,
  video_url text DEFAULT ''::text,
  cover_image_url text DEFAULT ''::text,
  motion_prompt text DEFAULT ''::text,
  post_kind text DEFAULT 'caption_image'::text,
  scheduled_date date,
  publish_time text DEFAULT ''::text,
  status text DEFAULT 'pending_review'::text NOT NULL,
  source text DEFAULT 'manual'::text NOT NULL,
  plan_id uuid,
  plan_idea_id uuid,
  campaign_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  zernio_post_id text DEFAULT ''::text,
  publish_status text DEFAULT 'not_published'::text,
  published_at timestamp with time zone,
  scheduled_publish_at timestamp with time zone,
  publish_error text DEFAULT ''::text,
  platform_post_url text DEFAULT ''::text,
  zernio_account_id text DEFAULT ''::text,
  creative_session_id uuid,
  creative_version_id uuid,
  tone text,
  post_strategy text,
  publish_provider text DEFAULT 'zernio'::text,
  meta_container_id text DEFAULT ''::text,
  publish_started_at timestamp with time zone,
  platform_options jsonb DEFAULT '{}'::jsonb NOT NULL,
  tags text[] DEFAULT '{}'::text[] NOT NULL,
  media jsonb
);

CREATE TABLE public.idea_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  plan_id uuid,
  idea_id uuid,
  event text NOT NULL,
  reason text DEFAULT ''::text,
  before jsonb DEFAULT '{}'::jsonb NOT NULL,
  after jsonb DEFAULT '{}'::jsonb NOT NULL,
  actor uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.instagram_generated_posts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  scheduled_date date,
  topic text NOT NULL,
  caption text NOT NULL,
  hashtags text DEFAULT ''::text NOT NULL,
  image_url text NOT NULL,
  image_prompt text,
  post_strategy text,
  tone text DEFAULT 'professional'::text NOT NULL,
  style text DEFAULT 'photorealistic'::text NOT NULL,
  aspect_ratio text DEFAULT '1:1'::text NOT NULL,
  campaign_id text,
  status text DEFAULT 'pending_publish'::text NOT NULL,
  source text DEFAULT 'scheduled'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  image_urls text[],
  workspace_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
  plan_id uuid,
  plan_idea_id uuid,
  publish_time text,
  reference_image_urls text[] DEFAULT '{}'::text[],
  caption_ar text DEFAULT ''::text,
  caption_en text DEFAULT ''::text,
  post_kind text DEFAULT 'caption_image'::text,
  first_comment text,
  video_url text DEFAULT ''::text,
  cover_image_url text DEFAULT ''::text,
  motion_prompt text DEFAULT ''::text,
  zernio_post_id text DEFAULT ''::text,
  publish_status text DEFAULT 'not_published'::text,
  published_at timestamp with time zone,
  scheduled_publish_at timestamp with time zone,
  publish_error text DEFAULT ''::text,
  platform_post_url text DEFAULT ''::text,
  zernio_account_id text DEFAULT ''::text,
  creative_session_id uuid,
  creative_version_id uuid,
  publish_provider text DEFAULT 'zernio'::text,
  meta_container_id text DEFAULT ''::text,
  publish_started_at timestamp with time zone
);

CREATE TABLE public.instagram_manual_posts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  topic text,
  caption text,
  hashtags text,
  image_url text,
  image_prompt text,
  post_strategy text,
  tone text,
  style text,
  aspect_ratio text,
  visual_mode text,
  content_route text DEFAULT 'instructions'::text,
  campaign_id text,
  status text DEFAULT 'pending_review'::text,
  source text DEFAULT 'manual'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  workspace_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL
);

CREATE TABLE public.instagram_reels (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  reel_format text,
  reel_duration text,
  hook text,
  brief text,
  music_note text,
  cta text,
  caption text,
  hashtags text,
  motion_prompt text,
  cover_image_url text,
  video_url text,
  publish_time text,
  tone text,
  status text DEFAULT 'ready'::text,
  source text DEFAULT 'manual'::text,
  created_at timestamp with time zone DEFAULT now(),
  workspace_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL
);

CREATE TABLE public.instagram_schedule (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  scheduled_date date NOT NULL,
  topic text NOT NULL,
  tone text DEFAULT 'professional'::text NOT NULL,
  visual_mode text,
  style text DEFAULT 'photorealistic'::text NOT NULL,
  custom_type text,
  aspect_ratio text DEFAULT '1:1'::text NOT NULL,
  notes text,
  instructions text,
  campaign_id text,
  status text DEFAULT 'pending'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  upload_type text DEFAULT 'generate'::text,
  uploaded_image_urls text[],
  publish_time text,
  webapp_id text,
  workspace_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
  reference_image_urls text[] DEFAULT '{}'::text[]
);

CREATE TABLE public.lead_agent_secrets (
  workspace_id uuid NOT NULL,
  openrouter_key text NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.lead_agent_settings (
  workspace_id uuid NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  intake_key uuid DEFAULT gen_random_uuid() NOT NULL,
  last_intake_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  export_key uuid DEFAULT gen_random_uuid() NOT NULL,
  last_export_at timestamp with time zone,
  alert_emails text[] DEFAULT '{}'::text[] NOT NULL,
  alert_state jsonb DEFAULT '{}'::jsonb NOT NULL,
  last_health_at timestamp with time zone,
  website_contact_group text DEFAULT ''::text NOT NULL,
  website_consent_since timestamp with time zone,
  read_before timestamp with time zone
);

CREATE TABLE public.lead_cards (
  lead_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  card jsonb DEFAULT '{}'::jsonb NOT NULL,
  decision text DEFAULT ''::text NOT NULL,
  quote_due date,
  target_price text DEFAULT ''::text NOT NULL,
  decides text DEFAULT ''::text NOT NULL,
  built_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  competitors text DEFAULT ''::text NOT NULL
);

CREATE TABLE public.lead_crm (
  workspace_id uuid NOT NULL,
  kind text DEFAULT 'odoo'::text NOT NULL,
  url text DEFAULT ''::text NOT NULL,
  db text DEFAULT ''::text NOT NULL,
  login text DEFAULT ''::text NOT NULL,
  api_key text DEFAULT ''::text NOT NULL,
  odoo_uid integer,
  server_version text DEFAULT ''::text NOT NULL,
  last_checked_at timestamp with time zone,
  last_error text DEFAULT ''::text NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.lead_domains (
  domain text NOT NULL,
  ok boolean DEFAULT false NOT NULL,
  title text DEFAULT ''::text NOT NULL,
  description text DEFAULT ''::text NOT NULL,
  text text DEFAULT ''::text NOT NULL,
  error text DEFAULT ''::text NOT NULL,
  checked_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.lead_mailbox_secrets (
  mailbox_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  secret text NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.lead_mailboxes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  email text NOT NULL,
  display_name text DEFAULT ''::text NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  read_from timestamp with time zone DEFAULT now() NOT NULL,
  last_checked_at timestamp with time zone,
  last_error text DEFAULT ''::text NOT NULL,
  last_counts jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  label text DEFAULT ''::text NOT NULL,
  tenant text DEFAULT ''::text NOT NULL,
  history_from timestamp with time zone DEFAULT '2026-06-30 21:00:00+00'::timestamp with time zone NOT NULL,
  history_until timestamp with time zone DEFAULT '2026-09-30 21:00:00+00'::timestamp with time zone NOT NULL,
  history_cursor timestamp with time zone,
  history_done boolean DEFAULT false NOT NULL,
  warmup_tag text DEFAULT ''::text NOT NULL,
  contact_group text DEFAULT ''::text NOT NULL,
  can_send boolean DEFAULT false NOT NULL
);

CREATE TABLE public.lead_reads (
  lead_id uuid NOT NULL,
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  read_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.leads (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  source text NOT NULL,
  source_ref text NOT NULL,
  received_at timestamp with time zone,
  name text DEFAULT ''::text NOT NULL,
  company text DEFAULT ''::text NOT NULL,
  email text DEFAULT ''::text NOT NULL,
  phone text DEFAULT ''::text NOT NULL,
  subject text DEFAULT ''::text NOT NULL,
  message text DEFAULT ''::text NOT NULL,
  language text DEFAULT 'en'::text NOT NULL,
  verdict text,
  category text DEFAULT ''::text NOT NULL,
  confidence text DEFAULT ''::text NOT NULL,
  reason text DEFAULT ''::text NOT NULL,
  summary text DEFAULT ''::text NOT NULL,
  details jsonb DEFAULT '{}'::jsonb NOT NULL,
  ask_next jsonb DEFAULT '[]'::jsonb NOT NULL,
  duplicate_of uuid,
  model text DEFAULT ''::text NOT NULL,
  cost_usd numeric DEFAULT 0 NOT NULL,
  error text DEFAULT ''::text NOT NULL,
  human_verdict text,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  mailbox text DEFAULT ''::text NOT NULL,
  link text DEFAULT ''::text NOT NULL,
  conversation_id text DEFAULT ''::text NOT NULL,
  sender_type text DEFAULT ''::text NOT NULL,
  sender_evidence text DEFAULT ''::text NOT NULL,
  source_check text DEFAULT ''::text NOT NULL,
  source_evidence text DEFAULT ''::text NOT NULL,
  project_type text DEFAULT ''::text NOT NULL,
  project_evidence text DEFAULT ''::text NOT NULL,
  request_type text DEFAULT ''::text NOT NULL,
  philips text DEFAULT ''::text NOT NULL,
  rule text DEFAULT ''::text NOT NULL,
  website text DEFAULT ''::text NOT NULL,
  folder text DEFAULT ''::text NOT NULL,
  email_kind text DEFAULT ''::text NOT NULL,
  criteria_version integer DEFAULT 1 NOT NULL,
  phones jsonb DEFAULT '[]'::jsonb NOT NULL,
  human_reason text DEFAULT ''::text NOT NULL,
  approved_at timestamp with time zone,
  approved_by uuid,
  crm_status text,
  crm_id text DEFAULT ''::text NOT NULL,
  crm_url text DEFAULT ''::text NOT NULL,
  crm_error text DEFAULT ''::text NOT NULL,
  crm_sent_at timestamp with time zone,
  corrected boolean GENERATED ALWAYS AS (((human_verdict IS NOT NULL) AND (human_verdict IS DISTINCT FROM verdict))) STORED,
  human_project_type text,
  project_set_by uuid,
  project_set_at timestamp with time zone,
  project_final text GENERATED ALWAYS AS (
CASE
    WHEN (human_project_type IS NULL) THEN COALESCE(project_type, ''::text)
    WHEN (human_project_type = 'none'::text) THEN ''::text
    ELSE human_project_type
END) STORED,
  assigned_to uuid,
  assigned_at timestamp with time zone,
  assigned_by uuid,
  forward_status text,
  forward_to text DEFAULT ''::text NOT NULL,
  forward_error text DEFAULT ''::text NOT NULL,
  forwarded_at timestamp with time zone,
  channel text DEFAULT ''::text NOT NULL,
  added_by uuid,
  stage text,
  stage_at timestamp with time zone,
  stage_by uuid,
  lost_reason text DEFAULT ''::text NOT NULL,
  lost_to text DEFAULT ''::text NOT NULL,
  next_step text DEFAULT ''::text NOT NULL,
  follow_up date
);

CREATE TABLE public.media_library (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  url text NOT NULL,
  platform text,
  topic text,
  source text DEFAULT 'manual'::text,
  mime_type text DEFAULT 'image/webp'::text,
  size_bytes bigint DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  workspace_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
  tags text[] DEFAULT '{}'::text[],
  storage_path text,
  width integer,
  height integer
);

CREATE TABLE public.notifications (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  workspace_id uuid,
  kind text DEFAULT 'info'::text NOT NULL,
  title text NOT NULL,
  body text DEFAULT ''::text NOT NULL,
  link text DEFAULT ''::text NOT NULL,
  request_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  read_at timestamp with time zone
);

CREATE TABLE public.plan_ideas (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  platform text DEFAULT 'instagram'::text,
  scheduled_date date,
  title text DEFAULT ''::text,
  topic text DEFAULT ''::text,
  angle text DEFAULT ''::text,
  tone text DEFAULT ''::text,
  occasion text DEFAULT ''::text,
  content_pillar text DEFAULT ''::text,
  rationale text DEFAULT ''::text,
  suggested_format text DEFAULT 'post'::text,
  suggested_style text DEFAULT ''::text,
  status text DEFAULT 'proposed'::text NOT NULL,
  "position" integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  reference_image_urls text[] DEFAULT '{}'::text[],
  image_idea text DEFAULT ''::text,
  suggested_aspect_ratio text DEFAULT ''::text,
  image_mode text DEFAULT 'studio'::text,
  publish_time text DEFAULT ''::text,
  objective text DEFAULT ''::text,
  cta text DEFAULT ''::text,
  post_kind text DEFAULT 'caption_image'::text,
  slide_count integer DEFAULT 1,
  image_text text DEFAULT ''::text,
  generation_status text DEFAULT 'not_started'::text,
  generation_error text DEFAULT ''::text,
  hashtags text,
  first_comment text,
  reject_reason text,
  series text,
  caption_options jsonb DEFAULT '[]'::jsonb,
  media_prompt_options jsonb DEFAULT '[]'::jsonb,
  caption_ar text DEFAULT ''::text,
  caption_en text DEFAULT ''::text,
  media_prompt text DEFAULT ''::text,
  motion_prompt text DEFAULT ''::text,
  draft_status text DEFAULT 'not_started'::text,
  draft_error text DEFAULT ''::text,
  drafted_at timestamp with time zone,
  format text DEFAULT ''::text,
  aspect_ratio text DEFAULT ''::text,
  media_type text DEFAULT 'image'::text,
  group_id uuid,
  wants_caption boolean DEFAULT true,
  preview_image_url text DEFAULT ''::text,
  generation_started_at timestamp with time zone,
  platforms text[] DEFAULT '{}'::text[],
  media_status text DEFAULT 'none'::text NOT NULL,
  media_version_id uuid,
  preview_video_url text DEFAULT ''::text,
  copy_mode text DEFAULT 'ai'::text NOT NULL,
  source text DEFAULT 'planner'::text NOT NULL,
  platform_options jsonb DEFAULT '{}'::jsonb NOT NULL,
  slides jsonb DEFAULT '[]'::jsonb NOT NULL
);

CREATE TABLE public.post_analytics (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  zernio_post_id text,
  platform text NOT NULL,
  platform_post_id text DEFAULT ''::text,
  post_table text DEFAULT ''::text,
  post_id uuid,
  metric_date date NOT NULL,
  impressions integer DEFAULT 0,
  reach integer DEFAULT 0,
  likes integer DEFAULT 0,
  comments integer DEFAULT 0,
  shares integer DEFAULT 0,
  saves integer DEFAULT 0,
  clicks integer DEFAULT 0,
  views integer DEFAULT 0,
  metrics_present text[] DEFAULT '{}'::text[],
  synced_at timestamp with time zone DEFAULT now() NOT NULL,
  zernio_account_id text DEFAULT ''::text,
  publish_provider text DEFAULT 'zernio'::text,
  origin text DEFAULT 'app'::text NOT NULL
);

CREATE TABLE public.request_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  request_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  actor uuid,
  kind text NOT NULL,
  body text DEFAULT ''::text NOT NULL,
  from_status text,
  to_status text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.request_people (
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  can_be_tagged boolean DEFAULT true NOT NULL,
  gets_new_requests boolean DEFAULT false NOT NULL,
  label text DEFAULT ''::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.requests (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  kind text DEFAULT 'improvement'::text NOT NULL,
  title text NOT NULL,
  body text DEFAULT ''::text NOT NULL,
  brief text DEFAULT ''::text NOT NULL,
  page text DEFAULT ''::text NOT NULL,
  context jsonb DEFAULT '{}'::jsonb NOT NULL,
  chat_id uuid,
  created_by uuid,
  assigned_to uuid,
  status text DEFAULT 'new'::text NOT NULL,
  resolution text DEFAULT ''::text NOT NULL,
  link text DEFAULT ''::text NOT NULL,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  closed_at timestamp with time zone
);

CREATE TABLE public.research_agenda (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  kind text DEFAULT 'question'::text NOT NULL,
  subject text NOT NULL,
  why text DEFAULT ''::text,
  status text DEFAULT 'proposed'::text NOT NULL,
  cadence text DEFAULT 'weekly'::text NOT NULL,
  ig_handle text DEFAULT ''::text,
  ig_user_id text DEFAULT ''::text,
  ig_confidence numeric,
  ig_verified_at timestamp with time zone,
  ig_status text DEFAULT 'unresolved'::text NOT NULL,
  source_row_id uuid,
  created_by text DEFAULT 'human'::text NOT NULL,
  last_seen_run_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  reviewed_at timestamp with time zone,
  domain text DEFAULT ''::text NOT NULL,
  lines text[] DEFAULT '{}'::text[] NOT NULL,
  kinds text[] DEFAULT '{}'::text[] NOT NULL,
  city text DEFAULT ''::text NOT NULL,
  tier integer,
  source text DEFAULT 'sales'::text NOT NULL,
  resolution text DEFAULT 'unresolved'::text NOT NULL,
  source_type text DEFAULT ''::text NOT NULL
);

CREATE TABLE public.research_chats (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  title text DEFAULT ''::text,
  run_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  user_id uuid
);

CREATE TABLE public.research_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  start_date date,
  end_date date,
  venue text DEFAULT ''::text NOT NULL,
  city text DEFAULT ''::text NOT NULL,
  organizer text DEFAULT ''::text NOT NULL,
  url text DEFAULT ''::text NOT NULL,
  exhibitor_deadline date,
  competitors_exhibiting text[] DEFAULT '{}'::text[] NOT NULL,
  relevance text DEFAULT 'medium'::text NOT NULL,
  recommendation text DEFAULT ''::text NOT NULL,
  status text DEFAULT 'upcoming'::text NOT NULL,
  decision text DEFAULT 'undecided'::text NOT NULL,
  source_url text DEFAULT ''::text NOT NULL,
  fingerprint text NOT NULL,
  first_run_id uuid,
  last_run_id uuid,
  first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  last_change text DEFAULT ''::text NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  takeaway text DEFAULT ''::text NOT NULL
);

CREATE TABLE public.research_findings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  run_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  agenda_id uuid,
  kind text DEFAULT 'trend'::text NOT NULL,
  headline text NOT NULL,
  detail text DEFAULT ''::text,
  sources jsonb DEFAULT '[]'::jsonb NOT NULL,
  evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
  confidence numeric,
  novelty text DEFAULT 'new'::text NOT NULL,
  promoted_idea_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.research_lens_results (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  lens text NOT NULL,
  status text DEFAULT 'ok'::text NOT NULL,
  findings jsonb DEFAULT '[]'::jsonb NOT NULL,
  sources jsonb DEFAULT '[]'::jsonb NOT NULL,
  note text DEFAULT ''::text NOT NULL,
  error text DEFAULT ''::text NOT NULL,
  cost_usd numeric(12,6) DEFAULT 0 NOT NULL,
  duration_ms integer,
  timed_out boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.research_messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  chat_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  role text NOT NULL,
  content text DEFAULT ''::text NOT NULL,
  tool_calls jsonb DEFAULT '[]'::jsonb NOT NULL,
  sources jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  attachments jsonb DEFAULT '[]'::jsonb NOT NULL
);

CREATE TABLE public.research_opportunities (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  type text DEFAULT 'project'::text NOT NULL,
  name text NOT NULL,
  headline text DEFAULT ''::text NOT NULL,
  client text DEFAULT ''::text NOT NULL,
  contractor text DEFAULT ''::text NOT NULL,
  consultant text DEFAULT ''::text NOT NULL,
  location text DEFAULT ''::text NOT NULL,
  scope text DEFAULT ''::text NOT NULL,
  stage text DEFAULT ''::text NOT NULL,
  deadline date,
  timing text DEFAULT 'unconfirmed'::text NOT NULL,
  relevance text DEFAULT 'medium'::text NOT NULL,
  suggested_action text DEFAULT ''::text NOT NULL,
  source_url text NOT NULL,
  sources jsonb DEFAULT '[]'::jsonb NOT NULL,
  status text DEFAULT 'new'::text NOT NULL,
  owner_note text DEFAULT ''::text NOT NULL,
  fingerprint text NOT NULL,
  first_run_id uuid,
  last_run_id uuid,
  first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  times_seen integer DEFAULT 1 NOT NULL,
  last_change text DEFAULT ''::text NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  line text DEFAULT ''::text NOT NULL,
  outreach_dismissed_at timestamp with time zone,
  segment text DEFAULT ''::text NOT NULL,
  buyer text DEFAULT ''::text NOT NULL,
  value_sar numeric,
  track text DEFAULT ''::text NOT NULL,
  why_fit text DEFAULT ''::text NOT NULL,
  red_flags text DEFAULT ''::text NOT NULL,
  contact text DEFAULT ''::text NOT NULL,
  value_kind text DEFAULT ''::text NOT NULL,
  package text DEFAULT ''::text NOT NULL,
  package_value_sar numeric
);

CREATE TABLE public.research_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  trigger text DEFAULT 'manual'::text NOT NULL,
  status text DEFAULT 'running'::text NOT NULL,
  stage text,
  period_start date,
  period_end date,
  report jsonb DEFAULT '{}'::jsonb NOT NULL,
  error text DEFAULT ''::text,
  model text DEFAULT ''::text,
  tokens_in integer DEFAULT 0,
  tokens_out integer DEFAULT 0,
  searches integer DEFAULT 0,
  tool_calls integer DEFAULT 0,
  cost_estimate numeric,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  finished_at timestamp with time zone
);

CREATE TABLE public.research_signals (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  competitor text DEFAULT ''::text NOT NULL,
  category text DEFAULT 'other'::text NOT NULL,
  channel text DEFAULT 'other'::text NOT NULL,
  summary text NOT NULL,
  detail text DEFAULT ''::text NOT NULL,
  relevance text DEFAULT 'medium'::text NOT NULL,
  source_url text NOT NULL,
  source_title text DEFAULT ''::text NOT NULL,
  event_date date,
  fingerprint text NOT NULL,
  first_run_id uuid,
  last_run_id uuid,
  first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  times_seen integer DEFAULT 1 NOT NULL,
  reported_in date,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  line text DEFAULT ''::text NOT NULL
);

CREATE TABLE public.research_source_checks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  source_id uuid NOT NULL,
  status text DEFAULT 'claimed'::text NOT NULL,
  queries text[] DEFAULT '{}'::text[] NOT NULL,
  results jsonb DEFAULT '[]'::jsonb NOT NULL,
  result_count integer DEFAULT 0 NOT NULL,
  provider text DEFAULT ''::text NOT NULL,
  error text DEFAULT ''::text NOT NULL,
  findings integer,
  checked_at timestamp with time zone DEFAULT now() NOT NULL,
  new_count integer
);

CREATE TABLE public.sales_accounts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  orders integer,
  value_sar numeric,
  first_year integer,
  last_order date,
  bought text DEFAULT ''::text NOT NULL,
  plays text[] DEFAULT '{}'::text[] NOT NULL,
  open_deals integer,
  open_value_sar numeric,
  why text DEFAULT ''::text NOT NULL,
  priority integer DEFAULT 2 NOT NULL,
  status text DEFAULT 'new'::text NOT NULL,
  owner text DEFAULT ''::text NOT NULL,
  owner_note text DEFAULT ''::text NOT NULL,
  next_step_on date,
  source text DEFAULT ''::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.sales_icp (
  workspace_id uuid NOT NULL,
  config jsonb DEFAULT '{}'::jsonb NOT NULL,
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  battle_cards jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE public.sales_seats (
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  all_website_leads boolean DEFAULT false NOT NULL,
  odoo_login text DEFAULT ''::text NOT NULL,
  odoo_user_id integer
);

CREATE TABLE public.social_accounts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  zernio_account_id text NOT NULL,
  platform text NOT NULL,
  username text DEFAULT ''::text,
  display_name text DEFAULT ''::text,
  profile_picture text DEFAULT ''::text,
  profile_url text DEFAULT ''::text,
  is_active boolean DEFAULT true,
  needs_reconnection boolean DEFAULT false,
  followers_count integer DEFAULT 0,
  last_synced_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  publish_provider text DEFAULT 'zernio'::text,
  connected_at timestamp with time zone DEFAULT now(),
  zernio_profile_id text,
  login_method text,
  account_type text,
  is_protected boolean DEFAULT false NOT NULL
);

CREATE TABLE public.social_connections (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  platform text NOT NULL,
  external_account_id text,
  display_name text,
  access_token text,
  refresh_token text,
  token_expires_at timestamp with time zone,
  scopes text[],
  status text DEFAULT 'connected'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.subscriptions (
  workspace_id uuid NOT NULL,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text DEFAULT 'trial'::text NOT NULL,
  status text DEFAULT 'trialing'::text NOT NULL,
  generation_credits_remaining integer DEFAULT 50 NOT NULL,
  current_period_end timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.user_access (
  user_id uuid NOT NULL,
  email text NOT NULL,
  full_name text,
  status text DEFAULT 'pending'::text NOT NULL,
  role text DEFAULT 'member'::text NOT NULL,
  requested_at timestamp with time zone DEFAULT now() NOT NULL,
  decided_at timestamp with time zone,
  decided_by uuid,
  leads_approver boolean DEFAULT false NOT NULL
);

CREATE TABLE public.workspace_members (
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text DEFAULT 'owner'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.workspace_webhooks (
  workspace_id uuid NOT NULL,
  webhooks jsonb DEFAULT '{}'::jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.workspaces (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  slug text,
  plan text DEFAULT 'trial'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  admin_only boolean DEFAULT false NOT NULL,
  zernio_profile_id text,
  agent_monthly_cap_usd numeric,
  ceo_brief_enabled boolean DEFAULT false NOT NULL
);


-- ═══ Functions ════════════════════

CREATE OR REPLACE FUNCTION public.agent_usage_warn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  cap numeric;
  month_start timestamptz := date_trunc('month', now());
  after_sum numeric;
  before_sum numeric;
  name text;
  level int;
begin
  select agent_monthly_cap_usd, w.name into cap, name from public.workspaces w where w.id = new.workspace_id;
  if cap is null or cap <= 0 or coalesce(new.cost_usd, 0) <= 0 then return new; end if;
  select coalesce(sum(cost_usd), 0) into after_sum
    from public.agent_usage where workspace_id = new.workspace_id and created_at >= month_start;
  before_sum := after_sum - new.cost_usd;
  level := case
    when before_sum < cap and after_sum >= cap then 100
    when before_sum < cap * 0.8 and after_sum >= cap * 0.8 then 80
    else 0 end;
  if level = 0 then return new; end if;
  insert into public.notifications (user_id, workspace_id, kind, title, body, link)
    select ua.user_id, new.workspace_id, 'ai_limit_' || level,
           case level when 100 then name || ' has reached its monthly AI limit'
                      else name || ' has used 80% of its monthly AI limit' end,
           '$' || round(after_sum, 2) || ' of $' || cap || ' used this month.' ||
             case level when 100 then ' The assistant and research runs stop until the 1st, or until the limit is raised in Settings.'
                        else ' Raise the limit in Settings if this month needs more.' end,
           '/settings'
      from public.user_access ua
      join public.workspace_members m on m.user_id = ua.user_id and m.workspace_id = new.workspace_id
     where ua.role = 'admin' and ua.status = 'approved';
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.approve_access(target_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_access_admin() then
    raise exception 'Only the access admin can approve access';
  end if;

  if not exists (select 1 from public.user_access where user_id = target_user) then
    raise exception 'No access request found for that user';
  end if;

  perform public.grant_access_to_user(target_user, auth.uid());
end;
$function$
;

CREATE OR REPLACE FUNCTION public.can_approve_leads(ws_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select (public.is_access_admin() and public.is_workspace_member(ws_id))
      or (public.is_sales_member(ws_id) and exists (
            select 1 from public.user_access ua
             where ua.user_id = auth.uid() and ua.status = 'approved' and ua.leads_approver));
$function$
;

CREATE OR REPLACE FUNCTION public.can_see_lead(ws uuid, owner uuid, src text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.is_sales_member(ws) and (
       owner = auth.uid()
    or exists (select 1 from public.user_access ua
                where ua.user_id = auth.uid() and ua.status = 'approved' and ua.leads_approver)
    or (src = 'website_form' and exists (
          select 1 from public.sales_seats s
           where s.user_id = auth.uid() and s.workspace_id = ws and s.all_website_leads))
  );
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_invite(target_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_access_admin() then
    raise exception 'Only the access admin can remove invites';
  end if;
  delete from public.access_invites where email = lower(trim(coalesce(target_email, '')));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.chat_visible(owner uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select owner = auth.uid() or (owner is null and public.is_access_admin());
$function$
;

CREATE OR REPLACE FUNCTION public.create_company(company_name text, member_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  new_id uuid;
begin
  if not public.has_app_access() then
    raise exception 'Your access has not been approved yet';
  end if;

  -- Deciding who sees a company is the admin's privilege everywhere else
  -- (set_user_workspaces), so it is here too. A member can still create a
  -- company; it reaches them and the administrators and nobody else.
  if coalesce(cardinality(member_ids), 0) > 0 and not public.is_access_admin() then
    raise exception 'Only the access admin can choose who gets a company';
  end if;

  insert into public.workspaces (name)
    values (coalesce(nullif(trim(company_name), ''), 'My Company'))
    returning id into new_id;

  -- Approved people only: membership IS the permission, so a row for someone
  -- pending or revoked would be a way in that skipped the approval.
  insert into public.workspace_members (workspace_id, user_id, role)
  select new_id, ua.user_id, 'owner'
  from public.user_access ua
  where ua.user_id = any (coalesce(member_ids, '{}'::uuid[]))
    and ua.status = 'approved'
  on conflict (workspace_id, user_id) do nothing;

  return new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.email_group_members_hand_edit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(current_setting('arak.lead_sync', true), '') = 'on' then return null; end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from email_groups g where g.id = old.group_id and g.managed_by <> '')
       and exists (select 1 from email_contacts c where c.id = old.contact_id) then
      insert into email_group_exclusions (group_id, contact_id, workspace_id)
      values (old.group_id, old.contact_id, old.workspace_id) on conflict do nothing;
    end if;
  else
    delete from email_group_exclusions where group_id = new.group_id and contact_id = new.contact_id;
  end if;
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.generated_post_is_locked(p public.generated_posts)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(p.publish_status, '') in ('publishing', 'published')
      or p.published_at is not null
      or (p.publish_status = 'scheduled'
          and p.scheduled_publish_at is not null
          and p.scheduled_publish_at <= now());
$function$
;

CREATE OR REPLACE FUNCTION public.generated_posts_lock_sent()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  jwt_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '');
begin
  if jwt_role = 'service_role' or current_user in ('postgres', 'supabase_admin', 'service_role') then
    return coalesce(new, old);
  end if;

  if not public.generated_post_is_locked(old) then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'This post has already gone out, so its record cannot be deleted.'
      using errcode = 'P0001', hint = 'post_locked';
  end if;

  if (new.caption, new.caption_ar, new.caption_en, new.hashtags, new.first_comment,
      new.topic, new.format, new.media_type, new.aspect_ratio, new.post_kind,
      new.image_url, new.image_urls, new.video_url, new.cover_image_url,
      new.platform_options, new.tags, new.platform, new.workspace_id,
      new.scheduled_date, new.publish_time, new.scheduled_publish_at, new.status,
      new.publish_status, new.published_at, new.zernio_post_id, new.zernio_account_id,
      new.platform_post_url, new.plan_id, new.plan_idea_id)
     is distinct from
     (old.caption, old.caption_ar, old.caption_en, old.hashtags, old.first_comment,
      old.topic, old.format, old.media_type, old.aspect_ratio, old.post_kind,
      old.image_url, old.image_urls, old.video_url, old.cover_image_url,
      old.platform_options, old.tags, old.platform, old.workspace_id,
      old.scheduled_date, old.publish_time, old.scheduled_publish_at, old.status,
      old.publish_status, old.published_at, old.zernio_post_id, old.zernio_account_id,
      old.platform_post_url, old.plan_id, old.plan_idea_id)
  then
    raise exception 'This post has already gone out, so it cannot be edited.'
      using errcode = 'P0001', hint = 'post_locked';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.grant_access_to_user(target_user uuid, actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.user_access (user_id, email, status, role, decided_at, decided_by)
  select target_user, u.email, 'approved', 'member', now(), actor
  from auth.users u where u.id = target_user
  on conflict (user_id) do update
    set status = 'approved', decided_at = now(), decided_by = excluded.decided_by;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  invited_to  uuid[];
  invited_as  text;
  pre_cleared boolean;
begin
  select i.workspace_ids, i.role into invited_to, invited_as
    from public.access_invites i where i.email = lower(new.email);
  pre_cleared := found;

  insert into public.user_access (user_id, email, full_name, status, role, leads_approver, decided_at)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), ''),
    case when pre_cleared then 'approved' else 'pending' end,
    case when pre_cleared and invited_as in ('sales', 'sales_admin') then 'sales' else 'member' end,
    pre_cleared and invited_as = 'sales_admin',
    case when pre_cleared then now() else null end
  )
  on conflict (user_id) do nothing;

  if pre_cleared then
    perform public.place_user_companies(new.id, invited_to, false);
    delete from public.access_invites where email = lower(new.email);
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.has_app_access()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.user_access ua
    where ua.user_id = auth.uid() and ua.status = 'approved' and ua.role <> 'sales'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.invite_access(target_email text, ws_ids uuid[] DEFAULT NULL::uuid[], as_role text DEFAULT 'member'::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  norm    text := lower(trim(coalesce(target_email, '')));
  found   uuid;
  current_status text;
  wanted  uuid[];
  r       text := coalesce(nullif(as_role, ''), 'member');
begin
  if not public.is_access_admin() then
    raise exception 'Only the access admin can add people';
  end if;
  if r not in ('member', 'sales', 'sales_admin') then
    raise exception 'A person can be added as member, sales or sales admin';
  end if;
  if norm !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That does not look like an email address';
  end if;

  select coalesce(array_agg(w.id), '{}'::uuid[]) into wanted
    from public.workspaces w
   where w.id = any (coalesce(ws_ids, '{}'::uuid[]));

  select u.id into found from auth.users u where lower(u.email) = norm;

  if found is null then
    insert into public.access_invites (email, invited_by, workspace_ids, role)
    values (norm, auth.uid(), wanted, r)
    on conflict (email) do update set workspace_ids = excluded.workspace_ids, role = excluded.role;
    return 'invited';
  end if;

  select ua.status into current_status from public.user_access ua where ua.user_id = found;
  if current_status = 'approved' then
    return 'already';
  end if;

  perform public.grant_access_to_user(found, auth.uid());
  update public.user_access
     set role = case when r = 'sales_admin' then 'sales' else r end,
         leads_approver = (r = 'sales_admin')
   where user_id = found and role <> 'admin';
  perform public.place_user_companies(found, wanted, false);

  return 'approved';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_access_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.user_access ua
    where ua.user_id = auth.uid() and ua.role = 'admin' and ua.status = 'approved'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_sales_access()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select exists (select 1 from public.user_access ua where ua.user_id = auth.uid() and ua.role = 'sales' and ua.status = 'approved'); $function$
;

CREATE OR REPLACE FUNCTION public.is_sales_member(ws_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.is_sales_access() and exists (
    select 1 from public.sales_seats s where s.user_id = auth.uid() and s.workspace_id = ws_id
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_workspace_member(ws_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
      from public.workspace_members wm
     where wm.workspace_id = ws_id
       and wm.user_id      = auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.lead_files_expired(max_rows integer DEFAULT 500)
 RETURNS SETOF text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'storage', 'public'
AS $function$
  select name from storage.objects
   where bucket_id = 'lead-files' and created_at < now() - interval '1 day'
   order by created_at
   limit greatest(1, least(max_rows, 1000));
$function$
;

CREATE OR REPLACE FUNCTION public.lead_read_before(ws uuid)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select s.read_before from public.lead_agent_settings s
   where s.workspace_id = ws
     and (public.is_sales_member(ws) or public.is_workspace_member(ws));
$function$
;

CREATE OR REPLACE FUNCTION public.leads_sync_contact()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'DELETE' then
    perform sync_lead_contact(old.workspace_id, old.email);
    return null;
  end if;
  if tg_op = 'UPDATE' and old.email is distinct from new.email then
    perform sync_lead_contact(old.workspace_id, old.email);
  end if;
  perform sync_lead_contact(new.workspace_id, new.email);
  perform sync_lead_contact(d.workspace_id, d.email) from leads d
    where d.duplicate_of = new.id and lower(btrim(d.email)) <> lower(btrim(new.email));
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.my_sales_companies()
 RETURNS TABLE(id uuid, name text, slug text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select w.id, w.name, w.slug, w.created_at
    from public.sales_seats s join public.workspaces w on w.id = s.workspace_id
   where s.user_id = auth.uid() and public.is_sales_access()
   order by w.created_at;
$function$
;

CREATE OR REPLACE FUNCTION public.place_user_companies(target_user uuid, ws_ids uuid[], replace_all boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  is_sales boolean := exists (select 1 from public.user_access where user_id = target_user and role = 'sales');
  wanted   uuid[] := coalesce(ws_ids, '{}'::uuid[]);
begin
  if is_sales then
    delete from public.workspace_members where user_id = target_user;
    if replace_all then
      delete from public.sales_seats where user_id = target_user and not (workspace_id = any (wanted));
    end if;
    insert into public.sales_seats (user_id, workspace_id)
    select target_user, w.id from public.workspaces w where w.id = any (wanted)
    on conflict do nothing;
  else
    delete from public.sales_seats where user_id = target_user;
    if replace_all then
      delete from public.workspace_members where user_id = target_user and not (workspace_id = any (wanted));
    end if;
    insert into public.workspace_members (workspace_id, user_id, role)
    select w.id, target_user, 'owner' from public.workspaces w where w.id = any (wanted)
    on conflict (workspace_id, user_id) do nothing;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.request_comment_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.requests;
  who text;
begin
  if new.kind <> 'comment' then return new; end if;
  select * into r from public.requests where id = new.request_id;
  select coalesce(nullif(trim(full_name), ''), split_part(email, '@', 1)) into who
    from public.user_access where user_id = new.actor;
  insert into public.notifications (user_id, workspace_id, kind, title, body, link, request_id)
    select distinct u, r.workspace_id, 'comment', coalesce(who, 'Someone') || ' commented on: ' || r.title,
           left(new.body, 400), '/requests?id=' || r.id, r.id
      from unnest(array[r.created_by, r.assigned_to]) as u
     where u is not null and u is distinct from new.actor;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.requests_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := coalesce(auth.uid(), new.updated_by, new.created_by);
  asker text;
  link  text := '/requests?id=' || new.id;
begin
  select coalesce(nullif(trim(full_name), ''), split_part(email, '@', 1)) into asker
    from public.user_access where user_id = actor;
  asker := coalesce(asker, 'Someone');

  if tg_op = 'INSERT' then
    insert into public.request_events (request_id, workspace_id, actor, kind, body, to_status)
      values (new.id, new.workspace_id, new.created_by, 'created', new.body, new.status);

    if new.assigned_to is not null and new.assigned_to is distinct from actor then
      insert into public.notifications (user_id, workspace_id, kind, title, body, link, request_id)
        values (new.assigned_to, new.workspace_id, 'tagged',
                asker || ' tagged you: ' || new.title, left(coalesce(nullif(new.brief, ''), new.body), 400), link, new.id);
    end if;

    if new.assigned_to is null then
      insert into public.notifications (user_id, workspace_id, kind, title, body, link, request_id)
        select rp.user_id, new.workspace_id, 'new_request',
               'New request from ' || asker || ': ' || new.title, left(coalesce(nullif(new.brief, ''), new.body), 400), link, new.id
          from public.request_people rp
         where rp.workspace_id = new.workspace_id and rp.gets_new_requests and rp.user_id is distinct from actor;
    end if;
    return new;
  end if;

  new.updated_at := now();
  if new.status in ('done', 'declined') and old.status not in ('done', 'declined') then
    new.closed_at := now();
  elsif new.status not in ('done', 'declined') then
    new.closed_at := null;
  end if;

  if new.status is distinct from old.status then
    insert into public.request_events (request_id, workspace_id, actor, kind, body, from_status, to_status)
      values (new.id, new.workspace_id, actor, 'status', new.resolution, old.status, new.status);
    if new.created_by is not null and new.created_by is distinct from actor then
      insert into public.notifications (user_id, workspace_id, kind, title, body, link, request_id)
        values (new.created_by, new.workspace_id, 'request_' || new.status,
                case new.status
                  when 'done' then 'Done: ' || new.title
                  when 'declined' then 'Declined: ' || new.title
                  when 'in_progress' then asker || ' started on: ' || new.title
                  else 'Reopened: ' || new.title end,
                left(new.resolution, 400), link, new.id);
    end if;
  end if;

  if new.assigned_to is distinct from old.assigned_to and new.assigned_to is not null then
    insert into public.request_events (request_id, workspace_id, actor, kind, body)
      values (new.id, new.workspace_id, actor, 'assigned', '');
    if new.assigned_to is distinct from actor then
      insert into public.notifications (user_id, workspace_id, kind, title, body, link, request_id)
        values (new.assigned_to, new.workspace_id, 'tagged',
                asker || ' gave you: ' || new.title, left(coalesce(nullif(new.brief, ''), new.body), 400), link, new.id);
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.revoke_access(target_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target_role text;
begin
  if not public.is_access_admin() then
    raise exception 'Only the access admin can revoke access';
  end if;
  select role into target_role from public.user_access where user_id = target_user;
  if target_role is null then
    raise exception 'No access record found for that user';
  end if;
  if target_role = 'admin' then
    raise exception 'The access admin cannot be revoked';
  end if;
  update public.user_access
     set status = 'revoked', decided_at = now(), decided_by = auth.uid()
   where user_id = target_user;
  delete from public.workspace_members where user_id = target_user;
  delete from public.sales_seats where user_id = target_user;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sales_team(ws_id uuid)
 RETURNS TABLE(user_id uuid, email text, full_name text, approver boolean, all_website_leads boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select ua.user_id, ua.email, coalesce(ua.full_name, ''), ua.leads_approver, s.all_website_leads
    from public.sales_seats s join public.user_access ua on ua.user_id = s.user_id
   where s.workspace_id = ws_id and ua.status = 'approved' and ua.role = 'sales'
     and (public.is_sales_member(ws_id) or (public.is_access_admin() and public.is_workspace_member(ws_id)))
   order by coalesce(nullif(ua.full_name, ''), ua.email);
$function$
;

CREATE OR REPLACE FUNCTION public.set_agent_cap(ws uuid, cap numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  before numeric;
  who text;
begin
  if not (public.is_access_admin() and public.is_workspace_member(ws)) then
    raise exception 'Only an administrator of this company can change its AI limit.' using errcode = '42501';
  end if;
  if cap is null or cap < 1 or cap > 5000 then
    raise exception 'The monthly limit must be between $1 and $5,000.' using errcode = '22023';
  end if;
  select agent_monthly_cap_usd into before from public.workspaces where id = ws;
  update public.workspaces set agent_monthly_cap_usd = round(cap, 2) where id = ws;
  insert into public.agent_cap_log (workspace_id, changed_by, old_cap, new_cap) values (ws, auth.uid(), before, round(cap, 2));

  select coalesce(nullif(trim(full_name), ''), split_part(email, '@', 1)) into who from public.user_access where user_id = auth.uid();
  insert into public.notifications (user_id, workspace_id, kind, title, body, link)
    select ua.user_id, ws, 'ai_limit',
           coalesce(who, 'Someone') || ' changed the monthly AI limit to $' || round(cap, 2),
           'It was ' || coalesce('$' || before::text, 'not set') || '.', '/settings'
      from public.user_access ua
      join public.workspace_members m on m.user_id = ua.user_id and m.workspace_id = ws
     where ua.role = 'admin' and ua.status = 'approved' and ua.user_id <> auth.uid();
  return round(cap, 2);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_user_role(target_user uuid, new_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  held uuid[];
begin
  if not public.is_access_admin() then
    raise exception 'Only the access admin can change roles';
  end if;
  if new_role not in ('member', 'sales', 'sales_admin') then
    raise exception 'A person can be member, sales or sales admin';
  end if;
  if exists (select 1 from public.user_access where user_id = target_user and role = 'admin') then
    raise exception 'The access admin''s role does not change';
  end if;
  select coalesce(array_agg(ws), '{}'::uuid[]) into held from (
    select workspace_id as ws from public.workspace_members where user_id = target_user
    union select workspace_id from public.sales_seats where user_id = target_user
  ) h;
  update public.user_access
     set role = case when new_role = 'sales_admin' then 'sales' else new_role end,
         leads_approver = (new_role = 'sales_admin')
   where user_id = target_user;
  perform public.place_user_companies(target_user, held, true);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_user_workspaces(target_user uuid, ws_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target_status text;
begin
  if not public.is_access_admin() then
    raise exception 'Only the access admin can assign companies';
  end if;
  select status into target_status from public.user_access where user_id = target_user;
  if target_status is null then
    raise exception 'No access record found for that user';
  end if;
  if target_status <> 'approved' then
    raise exception 'Approve this person before assigning companies';
  end if;
  perform public.place_user_companies(target_user, ws_ids, true);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_lead_contact(p_workspace uuid, p_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare prev text := coalesce(current_setting('arak.lead_sync', true), '');
begin
  perform set_config('arak.lead_sync', 'on', true);
  perform sync_lead_contact_run(p_workspace, p_email);
  perform set_config('arak.lead_sync', prev, true);
end $function$
;

CREATE OR REPLACE FUNCTION public.sync_lead_contact_run(p_workspace uuid, p_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  e        text := lower(btrim(coalesce(p_email, '')));
  managed  text[];
  wanted   text[] := '{}';
  latest   public.leads%rowtype;
  c        public.email_contacts%rowtype;
  first    text;
  g        text;
  gid      uuid;
begin
  if p_workspace is null or e !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then return; end if;

  select coalesce(array_agg(distinct t.name), '{}') into managed from (
    select contact_group as name from lead_mailboxes where workspace_id = p_workspace and contact_group <> ''
    union select website_contact_group from lead_agent_settings where workspace_id = p_workspace and website_contact_group <> ''
  ) t;
  if cardinality(managed) = 0 then return; end if;

  if split_part(e, '@', 2) not in (
    select lower(split_part(email, '@', 2)) from lead_mailboxes where workspace_id = p_workspace
    union select lower(split_part(label, '@', 2)) from lead_mailboxes where workspace_id = p_workspace and label like '%@%'
    union select lower(split_part(email, '@', 2)) from email_mailboxes where workspace_id = p_workspace
  ) then
    with own as (
      select x.source, coalesce(x.received_at, x.created_at) as at,
             case when coalesce(x.human_verdict, x.verdict) = 'duplicate'
                  then (select coalesce(o.human_verdict, o.verdict) from leads o where o.id = x.duplicate_of)
                  else coalesce(x.human_verdict, x.verdict) end as verdict,
             case when x.source = 'website_form' then coalesce(s.website_contact_group, '')
                  else coalesce((select m.contact_group from lead_mailboxes m
                                  where m.workspace_id = x.workspace_id and x.mailbox <> '' and x.mailbox in (m.email, m.label)
                                  limit 1), '') end as grp,
             s.website_consent_since as since
      from leads x
      left join lead_agent_settings s on s.workspace_id = x.workspace_id
      where x.workspace_id = p_workspace and lower(btrim(x.email)) = e
    )
    select coalesce(array_agg(distinct grp), '{}') into wanted from own
    where verdict in ('qualified', 'needs_review') and grp <> ''
      and (source <> 'website_form' or since is null or at < since
           or exists (select 1 from email_contacts ct where ct.workspace_id = p_workspace and ct.email = e and ct.consent = 'opted_in'));
  end if;

  select * into c from email_contacts where workspace_id = p_workspace and email = e;

  if c.id is not null then
    select coalesce(array_agg(w), '{}') into wanted from unnest(wanted) w
    where not exists (
      select 1 from email_group_exclusions x join email_groups gr on gr.id = x.group_id
      where x.contact_id = c.id and lower(gr.name) = lower(w));
  end if;

  if cardinality(wanted) > 0 then
    if c.id is null then
      select * into latest from leads
        where workspace_id = p_workspace and lower(btrim(email)) = e
        order by coalesce(received_at, created_at) desc limit 1;
      first := split_part(btrim(latest.name), ' ', 1);
      insert into email_contacts (workspace_id, email, first_name, last_name, company, phone, language,
                                  audience, consent, status, source, notes)
      values (p_workspace, e, left(first, 100), left(btrim(substr(btrim(latest.name), length(first) + 1)), 100),
              left(latest.company, 200), left(latest.phone, 50), latest.language,
              'marketing', 'business_contact', 'active', 'enquiry',
              left('Contacted us ' || to_char(coalesce(latest.received_at, latest.created_at) at time zone 'Asia/Riyadh', 'YYYY-MM-DD')
                   || case when latest.source = 'website_form' then ' from the website' else ' at ' || latest.mailbox end, 300))
      on conflict (workspace_id, email) do nothing;
      select * into c from email_contacts where workspace_id = p_workspace and email = e;
    elsif c.status = 'active' and c.audience = 'cold' then
      update email_contacts set audience = 'marketing',
             consent = case when consent = 'none' then 'business_contact' else consent end, updated_at = now()
        where id = c.id;
      update email_sends set status = 'cancelled', error = 'Contacted us with an enquiry', updated_at = now()
        where contact_id = c.id and workspace_id = p_workspace and status = 'queued';
      delete from email_group_members
        where contact_id = c.id and workspace_id = p_workspace
          and group_id in (select id from email_groups where workspace_id = p_workspace and audience = 'cold');
    end if;
  end if;
  if c.id is null then return; end if;

  foreach g in array managed loop
    select id into gid from email_groups where workspace_id = p_workspace and lower(name) = lower(g) and audience = 'marketing';
    if g = any(wanted) then
      continue when c.status <> 'active';
      if gid is null then
        insert into email_groups (workspace_id, name, audience, description, managed_by)
        values (p_workspace, g, 'marketing', 'Asked us for a quote, a product or a project. The lead agent adds and removes people by its verdict.', 'lead_agent')
        on conflict do nothing;
        select id into gid from email_groups where workspace_id = p_workspace and lower(name) = lower(g) and audience = 'marketing';
      end if;
      if gid is not null then
        insert into email_group_members (group_id, contact_id, workspace_id, added_by) values (gid, c.id, p_workspace, 'lead_agent')
        on conflict do nothing;
      end if;
    elsif gid is not null then
      delete from email_group_members where group_id = gid and contact_id = c.id and added_by = 'lead_agent';
    end if;
  end loop;
end $function$
;

CREATE OR REPLACE FUNCTION public.sync_lead_contacts_all(p_workspace uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n integer := 0; e text;
begin
  for e in select distinct lower(btrim(email)) from leads where workspace_id = p_workspace and btrim(email) <> '' loop
    perform sync_lead_contact(p_workspace, e);
    n := n + 1;
  end loop;
  return n;
end $function$
;

CREATE OR REPLACE FUNCTION public.sync_workspace_roster()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  select new.id, ua.user_id, 'owner'
  from public.user_access ua
  where ua.status = 'approved'
    and (ua.role = 'admin' or ua.user_id = auth.uid())
  on conflict (workspace_id, user_id) do nothing;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.taggable_people(ws uuid)
 RETURNS TABLE(user_id uuid, name text, label text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select rp.user_id,
         coalesce(nullif(trim(ua.full_name), ''), split_part(ua.email, '@', 1)) as name,
         rp.label
    from public.request_people rp
    join public.user_access ua on ua.user_id = rp.user_id and ua.status = 'approved'
   where rp.workspace_id = ws
     and rp.can_be_tagged
     and public.is_workspace_member(ws)
   order by 2;
$function$
;

CREATE OR REPLACE FUNCTION public.unassign_on_seat_removed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n integer;
  who text;
begin
  update public.leads
     set assigned_to = null, assigned_at = null, assigned_by = null,
         forward_status = null, forward_to = '', forward_error = '', forwarded_at = null,
         updated_at = now()
   where workspace_id = old.workspace_id
     and assigned_to = old.user_id
     and coalesce(stage, '') not in ('won', 'lost');
  get diagnostics n = row_count;
  if n > 0 then
    select coalesce(nullif(full_name, ''), email) into who from public.user_access where user_id = old.user_id;
    insert into public.notifications (user_id, workspace_id, kind, title, body, link)
    select ua.user_id, old.workspace_id, 'lead',
           n || case when n = 1 then ' lead is' else ' leads are' end || ' unassigned: ' || coalesce(who, 'a salesperson') || ' no longer has access',
           'They keep their stage and battle card. Give them to someone in the Pipeline (Owner: Unassigned).',
           '/leads?view=pipeline'
      from public.sales_seats s join public.user_access ua on ua.user_id = s.user_id
     where s.workspace_id = old.workspace_id and s.user_id <> old.user_id
       and ua.leads_approver and ua.status = 'approved';
  end if;
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.workspace_people(ws uuid)
 RETURNS TABLE(user_id uuid, name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select ua.user_id, coalesce(nullif(trim(ua.full_name), ''), split_part(ua.email, '@', 1))
    from public.user_access ua
   where public.is_workspace_member(ws)
     and (
       exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = ua.user_id)
       or exists (select 1 from public.request_people rp where rp.workspace_id = ws and rp.user_id = ua.user_id)
       or ua.role = 'admin'
     );
$function$
;

CREATE OR REPLACE FUNCTION public.workspaces_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is not null and not public.is_access_admin() and (
       new.agent_monthly_cap_usd is distinct from old.agent_monthly_cap_usd
    or new.admin_only            is distinct from old.admin_only
    or new.zernio_profile_id     is distinct from old.zernio_profile_id
  ) then
    raise exception 'Only an administrator can change the AI limit or the company''s access settings.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$
;


-- ═══ Primary key, unique and check constraints ════════════════════

ALTER TABLE ONLY public.access_invites ADD CONSTRAINT access_invites_role_check CHECK ((role = ANY (ARRAY['member'::text, 'sales'::text, 'sales_admin'::text])));
ALTER TABLE ONLY public.access_invites ADD CONSTRAINT access_invites_pkey PRIMARY KEY (email);
ALTER TABLE ONLY public.account_analytics ADD CONSTRAINT account_analytics_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.account_analytics ADD CONSTRAINT account_analytics_workspace_id_account_id_metric_date_key UNIQUE (workspace_id, account_id, metric_date);
ALTER TABLE ONLY public.agent_cap_log ADD CONSTRAINT agent_cap_log_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.agent_digest ADD CONSTRAINT agent_digest_pkey PRIMARY KEY (workspace_id);
ALTER TABLE ONLY public.agent_edit_log ADD CONSTRAINT agent_edit_log_action_check CHECK ((action = ANY (ARRAY['create'::text, 'update'::text, 'delete'::text, 'undo'::text])));
ALTER TABLE ONLY public.agent_edit_log ADD CONSTRAINT agent_edit_log_table_name_check CHECK ((table_name = ANY (ARRAY['brand_profile'::text, 'brand_sections'::text, 'brand_fields'::text, 'brand_directory_rows'::text, 'brand_memory'::text, 'research_agenda'::text, 'sales_icp'::text, 'plan_ideas'::text, 'generated_posts'::text])));
ALTER TABLE ONLY public.agent_edit_log ADD CONSTRAINT agent_edit_log_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.agent_notes ADD CONSTRAINT agent_notes_kind_check CHECK ((kind = ANY (ARRAY['idea_proposed'::text, 'idea_outcome'::text, 'correction'::text, 'constraint'::text, 'fact'::text, 'question_asked'::text, 'run_headline'::text])));
ALTER TABLE ONLY public.agent_notes ADD CONSTRAINT agent_notes_source_check CHECK ((source = ANY (ARRAY['run'::text, 'chat'::text, 'human'::text])));
ALTER TABLE ONLY public.agent_notes ADD CONSTRAINT agent_notes_status_check CHECK ((status = ANY (ARRAY['new'::text, 'folded'::text, 'dropped'::text])));
ALTER TABLE ONLY public.agent_notes ADD CONSTRAINT agent_notes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.agent_usage ADD CONSTRAINT agent_usage_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.app_config ADD CONSTRAINT app_config_pkey PRIMARY KEY (key);
ALTER TABLE ONLY public.brand_assets ADD CONSTRAINT brand_assets_kind_check CHECK ((kind = ANY (ARRAY['logo'::text, 'product_photo'::text, 'project_photo'::text, 'reference'::text, 'music'::text, 'other'::text])));
ALTER TABLE ONLY public.brand_assets ADD CONSTRAINT brand_assets_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.brand_competitors ADD CONSTRAINT brand_competitors_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.brand_directory_columns ADD CONSTRAINT brand_directory_columns_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.brand_directory_columns ADD CONSTRAINT brand_directory_columns_workspace_id_section_key_key_key UNIQUE (workspace_id, section_key, key);
ALTER TABLE ONLY public.brand_directory_rows ADD CONSTRAINT brand_directory_rows_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.brand_edit_feedback ADD CONSTRAINT brand_edit_feedback_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.brand_fields ADD CONSTRAINT brand_fields_input_type_check CHECK ((input_type = ANY (ARRAY['text'::text, 'textarea'::text, 'select'::text])));
ALTER TABLE ONLY public.brand_fields ADD CONSTRAINT brand_fields_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.brand_fields ADD CONSTRAINT brand_fields_workspace_id_key_key UNIQUE (workspace_id, key);
ALTER TABLE ONLY public.brand_memory ADD CONSTRAINT brand_memory_scope_check CHECK ((scope = ANY (ARRAY['plan'::text, 'caption'::text, 'image'::text, 'timing'::text, 'competitor'::text, 'trend'::text, 'global'::text])));
ALTER TABLE ONLY public.brand_memory ADD CONSTRAINT brand_memory_source_check CHECK ((source = ANY (ARRAY['rejections'::text, 'edits'::text, 'analytics'::text, 'research'::text, 'human'::text])));
ALTER TABLE ONLY public.brand_memory ADD CONSTRAINT brand_memory_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'active'::text, 'retired'::text])));
ALTER TABLE ONLY public.brand_memory ADD CONSTRAINT brand_memory_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.brand_message_templates ADD CONSTRAINT brand_message_templates_channel_check CHECK ((channel = ANY (ARRAY['whatsapp'::text, 'email'::text, 'social'::text, 'other'::text])));
ALTER TABLE ONLY public.brand_message_templates ADD CONSTRAINT brand_message_templates_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'pending'::text, 'approved'::text, 'rejected'::text])));
ALTER TABLE ONLY public.brand_message_templates ADD CONSTRAINT brand_message_templates_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.brand_products ADD CONSTRAINT brand_products_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.brand_profile ADD CONSTRAINT brand_profile_caption_language_check CHECK ((caption_language = ANY (ARRAY['ar'::text, 'en'::text, 'both'::text])));
ALTER TABLE ONLY public.brand_profile ADD CONSTRAINT brand_profile_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.brand_profile ADD CONSTRAINT brand_profile_workspace_unique UNIQUE (workspace_id);
ALTER TABLE ONLY public.brand_sections ADD CONSTRAINT brand_sections_kind_check CHECK ((kind = ANY (ARRAY['fields'::text, 'directory'::text, 'assets'::text])));
ALTER TABLE ONLY public.brand_sections ADD CONSTRAINT brand_sections_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.brand_sections ADD CONSTRAINT brand_sections_workspace_id_key_key UNIQUE (workspace_id, key);
ALTER TABLE ONLY public.brand_suppliers ADD CONSTRAINT brand_suppliers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.ceo_briefs ADD CONSTRAINT ceo_briefs_trigger_check CHECK ((trigger = ANY (ARRAY['manual'::text, 'schedule'::text])));
ALTER TABLE ONLY public.ceo_briefs ADD CONSTRAINT ceo_briefs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.competitor_brands ADD CONSTRAINT competitor_brands_relationship_check CHECK ((relationship = ANY (ARRAY['exclusive'::text, 'non_exclusive'::text, 'claimed'::text, 'unconfirmed'::text, 'ended'::text])));
ALTER TABLE ONLY public.competitor_brands ADD CONSTRAINT competitor_brands_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.competitor_snapshots ADD CONSTRAINT competitor_snapshots_data_source_check CHECK ((data_source = ANY (ARRAY['instagram'::text, 'web_only'::text])));
ALTER TABLE ONLY public.competitor_snapshots ADD CONSTRAINT competitor_snapshots_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.content_plans ADD CONSTRAINT content_plans_kind_check CHECK ((kind = ANY (ARRAY['monthly'::text, 'quick'::text])));
ALTER TABLE ONLY public.content_plans ADD CONSTRAINT content_plans_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'approved'::text, 'active'::text, 'generating'::text, 'archived'::text])));
ALTER TABLE ONLY public.content_plans ADD CONSTRAINT content_plans_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.creative_sessions ADD CONSTRAINT creative_sessions_intent_check CHECK ((intent = ANY (ARRAY['image'::text, 'video'::text, 'image_video'::text, 'multi_video'::text])));
ALTER TABLE ONLY public.creative_sessions ADD CONSTRAINT creative_sessions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])));
ALTER TABLE ONLY public.creative_sessions ADD CONSTRAINT creative_sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.creative_versions ADD CONSTRAINT creative_versions_kind_check CHECK ((kind = ANY (ARRAY['generate'::text, 'edit'::text, 'overlay'::text, 'canva'::text, 'video'::text])));
ALTER TABLE ONLY public.creative_versions ADD CONSTRAINT creative_versions_media_type_check CHECK ((media_type = ANY (ARRAY['image'::text, 'video'::text])));
ALTER TABLE ONLY public.creative_versions ADD CONSTRAINT creative_versions_prompt_source_check CHECK ((prompt_source = ANY (ARRAY['raw'::text, 'enhanced'::text, 'enhanced_edited'::text])));
ALTER TABLE ONLY public.creative_versions ADD CONSTRAINT creative_versions_provider_check CHECK ((provider = ANY (ARRAY['openai'::text, 'gemini'::text, 'seedance'::text, 'manual'::text, ''::text])));
ALTER TABLE ONLY public.creative_versions ADD CONSTRAINT creative_versions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'ready'::text, 'failed'::text])));
ALTER TABLE ONLY public.creative_versions ADD CONSTRAINT creative_versions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.deal_outcomes ADD CONSTRAINT deal_outcomes_decided_by_check CHECK ((decided_by = ANY (ARRAY['price'::text, 'lead_time'::text, 'spec_lock_in'::text, 'relationship'::text, 'agency_rights'::text, 'compliance'::text, 'scope'::text, 'other'::text, 'unknown'::text])));
ALTER TABLE ONLY public.deal_outcomes ADD CONSTRAINT deal_outcomes_outcome_check CHECK ((outcome = ANY (ARRAY['lost'::text, 'won'::text, 'open'::text, 'no_bid'::text])));
ALTER TABLE ONLY public.deal_outcomes ADD CONSTRAINT deal_outcomes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.email_ai_drafts ADD CONSTRAINT email_ai_drafts_status_check CHECK ((status = ANY (ARRAY['running'::text, 'ready'::text, 'failed'::text])));
ALTER TABLE ONLY public.email_ai_drafts ADD CONSTRAINT email_ai_drafts_trigger_check CHECK ((trigger = ANY (ARRAY['scheduled'::text, 'manual'::text])));
ALTER TABLE ONLY public.email_ai_drafts ADD CONSTRAINT email_ai_drafts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.email_campaigns ADD CONSTRAINT email_campaigns_audience_check CHECK ((audience = ANY (ARRAY['marketing'::text, 'cold'::text])));
ALTER TABLE ONLY public.email_campaigns ADD CONSTRAINT email_campaigns_language_check CHECK ((language = ANY (ARRAY['en'::text, 'ar'::text])));
ALTER TABLE ONLY public.email_campaigns ADD CONSTRAINT email_campaigns_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'scheduled'::text, 'sending'::text, 'sent'::text, 'paused'::text, 'cancelled'::text])));
ALTER TABLE ONLY public.email_campaigns ADD CONSTRAINT email_campaigns_variants_check CHECK (((jsonb_typeof(variants) = 'array'::text) AND (jsonb_array_length(variants) <= 2)));
ALTER TABLE ONLY public.email_campaigns ADD CONSTRAINT email_campaigns_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.email_contacts ADD CONSTRAINT email_contacts_audience_check CHECK ((audience = ANY (ARRAY['marketing'::text, 'cold'::text])));
ALTER TABLE ONLY public.email_contacts ADD CONSTRAINT email_contacts_consent_check CHECK ((consent = ANY (ARRAY['opted_in'::text, 'customer'::text, 'business_contact'::text, 'none'::text])));
ALTER TABLE ONLY public.email_contacts ADD CONSTRAINT email_contacts_custom_check CHECK ((jsonb_typeof(custom) = 'object'::text));
ALTER TABLE ONLY public.email_contacts ADD CONSTRAINT email_contacts_email_check CHECK (((email = lower(btrim(email))) AND (POSITION(('@'::text) IN (email)) > 1)));
ALTER TABLE ONLY public.email_contacts ADD CONSTRAINT email_contacts_language_check CHECK ((language = ANY (ARRAY['en'::text, 'ar'::text])));
ALTER TABLE ONLY public.email_contacts ADD CONSTRAINT email_contacts_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'import'::text, 'website'::text, 'event'::text, 'research'::text, 'reply'::text, 'enquiry'::text, 'other'::text])));
ALTER TABLE ONLY public.email_contacts ADD CONSTRAINT email_contacts_status_check CHECK ((status = ANY (ARRAY['active'::text, 'unsubscribed'::text, 'bounced'::text, 'complained'::text])));
ALTER TABLE ONLY public.email_contacts ADD CONSTRAINT email_contacts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.email_events ADD CONSTRAINT email_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.email_group_exclusions ADD CONSTRAINT email_group_exclusions_pkey PRIMARY KEY (group_id, contact_id);
ALTER TABLE ONLY public.email_group_members ADD CONSTRAINT email_group_members_added_by_check CHECK ((added_by = ANY (ARRAY['person'::text, 'lead_agent'::text])));
ALTER TABLE ONLY public.email_group_members ADD CONSTRAINT email_group_members_pkey PRIMARY KEY (group_id, contact_id);
ALTER TABLE ONLY public.email_groups ADD CONSTRAINT email_groups_audience_check CHECK ((audience = ANY (ARRAY['marketing'::text, 'cold'::text])));
ALTER TABLE ONLY public.email_groups ADD CONSTRAINT email_groups_managed_by_check CHECK ((managed_by = ANY (ARRAY[''::text, 'lead_agent'::text])));
ALTER TABLE ONLY public.email_groups ADD CONSTRAINT email_groups_name_check CHECK ((length(btrim(name)) > 0));
ALTER TABLE ONLY public.email_groups ADD CONSTRAINT email_groups_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.email_mailbox_secrets ADD CONSTRAINT email_mailbox_secrets_pkey PRIMARY KEY (mailbox_id);
ALTER TABLE ONLY public.email_mailboxes ADD CONSTRAINT email_mailboxes_auth_method_check CHECK ((auth_method = ANY (ARRAY['password'::text, 'google'::text])));
ALTER TABLE ONLY public.email_mailboxes ADD CONSTRAINT email_mailboxes_daily_limit_check CHECK (((daily_limit >= 0) AND (daily_limit <= 40)));
ALTER TABLE ONLY public.email_mailboxes ADD CONSTRAINT email_mailboxes_email_check CHECK (((email = lower(btrim(email))) AND (POSITION(('@'::text) IN (email)) > 1)));
ALTER TABLE ONLY public.email_mailboxes ADD CONSTRAINT email_mailboxes_imap_port_check CHECK (((imap_port >= 1) AND (imap_port <= 65535)));
ALTER TABLE ONLY public.email_mailboxes ADD CONSTRAINT email_mailboxes_provider_check CHECK ((provider = ANY (ARRAY['smtp'::text, 'instantly'::text, 'microsoft'::text])));
ALTER TABLE ONLY public.email_mailboxes ADD CONSTRAINT email_mailboxes_smtp_port_check CHECK (((smtp_port >= 1) AND (smtp_port <= 65535)));
ALTER TABLE ONLY public.email_mailboxes ADD CONSTRAINT email_mailboxes_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'error'::text])));
ALTER TABLE ONLY public.email_mailboxes ADD CONSTRAINT email_mailboxes_warmup_days_check CHECK (((warmup_days >= 14) AND (warmup_days <= 60)));
ALTER TABLE ONLY public.email_mailboxes ADD CONSTRAINT email_mailboxes_warmup_per_day_check CHECK (((warmup_per_day >= 0) AND (warmup_per_day <= 40)));
ALTER TABLE ONLY public.email_mailboxes ADD CONSTRAINT email_mailboxes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.email_sends ADD CONSTRAINT email_sends_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'sending'::text, 'sent'::text, 'delivered'::text, 'opened'::text, 'clicked'::text, 'bounced'::text, 'complained'::text, 'failed'::text, 'skipped'::text, 'cancelled'::text])));
ALTER TABLE ONLY public.email_sends ADD CONSTRAINT email_sends_variant_check CHECK (((variant >= 0) AND (variant <= 2)));
ALTER TABLE ONLY public.email_sends ADD CONSTRAINT email_sends_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.email_settings ADD CONSTRAINT email_settings_cold_daily_limit_check CHECK ((cold_daily_limit >= 0));
ALTER TABLE ONLY public.email_settings ADD CONSTRAINT email_settings_provider_daily_limit_check CHECK ((provider_daily_limit >= 0));
ALTER TABLE ONLY public.email_settings ADD CONSTRAINT email_settings_provider_monthly_limit_check CHECK ((provider_monthly_limit >= 0));
ALTER TABLE ONLY public.email_settings ADD CONSTRAINT email_settings_pkey PRIMARY KEY (workspace_id);
ALTER TABLE ONLY public.generated_posts ADD CONSTRAINT generated_posts_media_is_array CHECK (((media IS NULL) OR (jsonb_typeof(media) = 'array'::text)));
ALTER TABLE ONLY public.generated_posts ADD CONSTRAINT generated_posts_media_type_check CHECK ((media_type = ANY (ARRAY['image'::text, 'video'::text, 'none'::text])));
ALTER TABLE ONLY public.generated_posts ADD CONSTRAINT generated_posts_platform_check CHECK ((platform = ANY (ARRAY['instagram'::text, 'tiktok'::text, 'snapchat'::text, 'linkedin'::text])));
ALTER TABLE ONLY public.generated_posts ADD CONSTRAINT generated_posts_publish_status_check CHECK ((publish_status = ANY (ARRAY['not_published'::text, 'scheduled'::text, 'publishing'::text, 'published'::text, 'failed'::text])));
ALTER TABLE ONLY public.generated_posts ADD CONSTRAINT generated_posts_source_check CHECK ((source = ANY (ARRAY['scheduled'::text, 'manual'::text, 'plan'::text, 'generated'::text, 'studio'::text])));
ALTER TABLE ONLY public.generated_posts ADD CONSTRAINT generated_posts_status_check CHECK ((status = ANY (ARRAY['pending_review'::text, 'pending_publish'::text, 'approved'::text, 'scheduled'::text, 'published'::text, 'rejected'::text, 'draft'::text])));
ALTER TABLE ONLY public.generated_posts ADD CONSTRAINT generated_posts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.idea_events ADD CONSTRAINT idea_events_event_check CHECK ((event = ANY (ARRAY['created'::text, 'approved'::text, 'rejected'::text, 'edited'::text, 'redrafted'::text, 'deleted'::text])));
ALTER TABLE ONLY public.idea_events ADD CONSTRAINT idea_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.instagram_generated_posts ADD CONSTRAINT instagram_generated_posts_publish_status_check CHECK ((publish_status = ANY (ARRAY['not_published'::text, 'scheduled'::text, 'publishing'::text, 'published'::text, 'failed'::text])));
ALTER TABLE ONLY public.instagram_generated_posts ADD CONSTRAINT instagram_generated_posts_source_check CHECK ((source = ANY (ARRAY['scheduled'::text, 'manual'::text, 'plan'::text, 'generated'::text, 'studio'::text])));
ALTER TABLE ONLY public.instagram_generated_posts ADD CONSTRAINT instagram_generated_posts_status_check CHECK ((status = ANY (ARRAY['pending_review'::text, 'pending_publish'::text, 'approved'::text, 'scheduled'::text, 'published'::text, 'rejected'::text, 'draft'::text])));
ALTER TABLE ONLY public.instagram_generated_posts ADD CONSTRAINT instagram_generated_posts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.instagram_manual_posts ADD CONSTRAINT instagram_manual_posts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.instagram_reels ADD CONSTRAINT instagram_reels_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.instagram_schedule ADD CONSTRAINT instagram_schedule_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'generated'::text, 'failed'::text])));
ALTER TABLE ONLY public.instagram_schedule ADD CONSTRAINT instagram_schedule_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.lead_agent_secrets ADD CONSTRAINT lead_agent_secrets_pkey PRIMARY KEY (workspace_id);
ALTER TABLE ONLY public.lead_agent_settings ADD CONSTRAINT lead_agent_settings_pkey PRIMARY KEY (workspace_id);
ALTER TABLE ONLY public.lead_cards ADD CONSTRAINT lead_cards_decision_check CHECK ((decision = ANY (ARRAY[''::text, 'quote_today'::text, 'project_quote'::text, 'park'::text, 'decline'::text])));
ALTER TABLE ONLY public.lead_cards ADD CONSTRAINT lead_cards_pkey PRIMARY KEY (lead_id);
ALTER TABLE ONLY public.lead_crm ADD CONSTRAINT lead_crm_kind_check CHECK ((kind = 'odoo'::text));
ALTER TABLE ONLY public.lead_crm ADD CONSTRAINT lead_crm_pkey PRIMARY KEY (workspace_id);
ALTER TABLE ONLY public.lead_domains ADD CONSTRAINT lead_domains_pkey PRIMARY KEY (domain);
ALTER TABLE ONLY public.lead_mailbox_secrets ADD CONSTRAINT lead_mailbox_secrets_pkey PRIMARY KEY (mailbox_id);
ALTER TABLE ONLY public.lead_mailboxes ADD CONSTRAINT lead_mailboxes_status_check CHECK ((status = ANY (ARRAY['active'::text, 'reconnect'::text])));
ALTER TABLE ONLY public.lead_mailboxes ADD CONSTRAINT lead_mailboxes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.lead_mailboxes ADD CONSTRAINT lead_mailboxes_workspace_id_email_key UNIQUE (workspace_id, email);
ALTER TABLE ONLY public.lead_reads ADD CONSTRAINT lead_reads_pkey PRIMARY KEY (lead_id, user_id);
ALTER TABLE ONLY public.leads ADD CONSTRAINT leads_channel_check CHECK ((channel = ANY (ARRAY[''::text, 'phone'::text, 'whatsapp'::text, 'walk_in'::text, 'referral'::text, 'exhibition'::text, 'site_visit'::text, 'outbound'::text, 'other'::text])));
ALTER TABLE ONLY public.leads ADD CONSTRAINT leads_crm_status_check CHECK ((crm_status = ANY (ARRAY['queued'::text, 'sending'::text, 'sent'::text, 'failed'::text])));
ALTER TABLE ONLY public.leads ADD CONSTRAINT leads_forward_status_check CHECK ((forward_status = ANY (ARRAY['sending'::text, 'sent'::text, 'failed'::text])));
ALTER TABLE ONLY public.leads ADD CONSTRAINT leads_human_project_type_check CHECK ((human_project_type = ANY (ARRAY['jih'::text, 'tender'::text, 'maintenance'::text, 'none'::text])));
ALTER TABLE ONLY public.leads ADD CONSTRAINT leads_human_verdict_check CHECK ((human_verdict = ANY (ARRAY['qualified'::text, 'unqualified'::text, 'needs_review'::text])));
ALTER TABLE ONLY public.leads ADD CONSTRAINT leads_language_check CHECK ((language = ANY (ARRAY['en'::text, 'ar'::text])));
ALTER TABLE ONLY public.leads ADD CONSTRAINT leads_lost_reason_check CHECK ((lost_reason = ANY (ARRAY[''::text, 'price'::text, 'brand'::text, 'lead_time'::text, 'no_reply'::text, 'cancelled'::text, 'other'::text])));
ALTER TABLE ONLY public.leads ADD CONSTRAINT leads_source_check CHECK ((source = ANY (ARRAY['website_form'::text, 'email'::text, 'manual'::text])));
ALTER TABLE ONLY public.leads ADD CONSTRAINT leads_stage_check CHECK ((stage = ANY (ARRAY['new'::text, 'contacted'::text, 'rfq'::text, 'quotation'::text, 'negotiating'::text, 'won'::text, 'lost'::text])));
ALTER TABLE ONLY public.leads ADD CONSTRAINT leads_verdict_check CHECK ((verdict = ANY (ARRAY['qualified'::text, 'unqualified'::text, 'needs_review'::text, 'duplicate'::text])));
ALTER TABLE ONLY public.leads ADD CONSTRAINT leads_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.leads ADD CONSTRAINT leads_workspace_id_source_source_ref_key UNIQUE (workspace_id, source, source_ref);
ALTER TABLE ONLY public.media_library ADD CONSTRAINT media_library_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.plan_ideas ADD CONSTRAINT plan_ideas_copy_mode_check CHECK ((copy_mode = ANY (ARRAY['ai'::text, 'own'::text])));
ALTER TABLE ONLY public.plan_ideas ADD CONSTRAINT plan_ideas_draft_status_check CHECK ((draft_status = ANY (ARRAY['not_started'::text, 'drafting'::text, 'ready'::text, 'failed'::text])));
ALTER TABLE ONLY public.plan_ideas ADD CONSTRAINT plan_ideas_generation_status_check CHECK ((generation_status = ANY (ARRAY['not_started'::text, 'processing'::text, 'completed'::text, 'failed'::text])));
ALTER TABLE ONLY public.plan_ideas ADD CONSTRAINT plan_ideas_image_mode_check CHECK ((image_mode = ANY (ARRAY['generate'::text, 'use_reference'::text, 'studio'::text])));
ALTER TABLE ONLY public.plan_ideas ADD CONSTRAINT plan_ideas_media_status_check CHECK ((media_status = ANY (ARRAY['none'::text, 'in_studio'::text, 'ready'::text])));
ALTER TABLE ONLY public.plan_ideas ADD CONSTRAINT plan_ideas_media_type_check CHECK ((media_type = ANY (ARRAY['image'::text, 'video'::text, 'none'::text])));
ALTER TABLE ONLY public.plan_ideas ADD CONSTRAINT plan_ideas_post_kind_check CHECK ((post_kind = ANY (ARRAY['caption_only'::text, 'image_only'::text, 'caption_image'::text, 'carousel'::text, 'text_image'::text, 'video'::text, 'text_only'::text])));
ALTER TABLE ONLY public.plan_ideas ADD CONSTRAINT plan_ideas_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'approved'::text, 'rejected'::text])));
ALTER TABLE ONLY public.plan_ideas ADD CONSTRAINT plan_ideas_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.post_analytics ADD CONSTRAINT post_analytics_external_identified CHECK (((origin <> 'external'::text) OR ((platform_post_id IS NOT NULL) AND (platform_post_id <> ''::text))));
ALTER TABLE ONLY public.post_analytics ADD CONSTRAINT post_analytics_origin_check CHECK ((origin = ANY (ARRAY['app'::text, 'external'::text])));
ALTER TABLE ONLY public.post_analytics ADD CONSTRAINT post_analytics_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.post_analytics ADD CONSTRAINT post_analytics_zernio_post_id_platform_metric_date_key UNIQUE (zernio_post_id, platform, metric_date);
ALTER TABLE ONLY public.request_events ADD CONSTRAINT request_events_kind_check CHECK ((kind = ANY (ARRAY['created'::text, 'status'::text, 'assigned'::text, 'comment'::text])));
ALTER TABLE ONLY public.request_events ADD CONSTRAINT request_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.request_people ADD CONSTRAINT request_people_pkey PRIMARY KEY (workspace_id, user_id);
ALTER TABLE ONLY public.requests ADD CONSTRAINT requests_kind_check CHECK ((kind = ANY (ARRAY['improvement'::text, 'bug'::text, 'content'::text, 'question'::text, 'task'::text])));
ALTER TABLE ONLY public.requests ADD CONSTRAINT requests_status_check CHECK ((status = ANY (ARRAY['new'::text, 'in_progress'::text, 'done'::text, 'declined'::text])));
ALTER TABLE ONLY public.requests ADD CONSTRAINT requests_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.research_agenda ADD CONSTRAINT research_agenda_cadence_check CHECK ((cadence = ANY (ARRAY['weekly'::text, 'monthly'::text])));
ALTER TABLE ONLY public.research_agenda ADD CONSTRAINT research_agenda_created_by_check CHECK ((created_by = ANY (ARRAY['human'::text, 'agent'::text])));
ALTER TABLE ONLY public.research_agenda ADD CONSTRAINT research_agenda_ig_status_check CHECK ((ig_status = ANY (ARRAY['unresolved'::text, 'resolved'::text, 'not_found'::text, 'private'::text, 'human_set'::text])));
ALTER TABLE ONLY public.research_agenda ADD CONSTRAINT research_agenda_kind_check CHECK ((kind = ANY (ARRAY['question'::text, 'competitor'::text, 'metric'::text, 'source'::text])));
ALTER TABLE ONLY public.research_agenda ADD CONSTRAINT research_agenda_resolution_check CHECK ((resolution = ANY (ARRAY['company'::text, 'brand'::text, 'showroom'::text, 'unresolvable'::text, 'unresolved'::text])));
ALTER TABLE ONLY public.research_agenda ADD CONSTRAINT research_agenda_source_check CHECK ((source = ANY (ARRAY['sales'::text, 'agent'::text, 'research'::text])));
ALTER TABLE ONLY public.research_agenda ADD CONSTRAINT research_agenda_source_type_check CHECK ((source_type = ANY (ARRAY[''::text, 'website'::text, 'news'::text, 'tender_portal'::text, 'exchange'::text, 'government'::text, 'instagram'::text, 'linkedin'::text, 'x'::text, 'hashtag'::text, 'keyword'::text])));
ALTER TABLE ONLY public.research_agenda ADD CONSTRAINT research_agenda_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'active'::text, 'retired'::text])));
ALTER TABLE ONLY public.research_agenda ADD CONSTRAINT research_agenda_tier_check CHECK (((tier >= 1) AND (tier <= 3)));
ALTER TABLE ONLY public.research_agenda ADD CONSTRAINT research_agenda_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.research_chats ADD CONSTRAINT research_chats_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.research_events ADD CONSTRAINT research_events_decision_check CHECK ((decision = ANY (ARRAY['undecided'::text, 'visiting'::text, 'exhibiting'::text, 'sponsoring'::text, 'skipping'::text])));
ALTER TABLE ONLY public.research_events ADD CONSTRAINT research_events_relevance_check CHECK ((relevance = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text])));
ALTER TABLE ONLY public.research_events ADD CONSTRAINT research_events_status_check CHECK ((status = ANY (ARRAY['upcoming'::text, 'concluded'::text, 'tbc'::text])));
ALTER TABLE ONLY public.research_events ADD CONSTRAINT research_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.research_findings ADD CONSTRAINT research_findings_kind_check CHECK ((kind = ANY (ARRAY['competitor'::text, 'trend'::text, 'gap'::text, 'our_performance'::text])));
ALTER TABLE ONLY public.research_findings ADD CONSTRAINT research_findings_novelty_check CHECK ((novelty = ANY (ARRAY['new'::text, 'continuing'::text, 'changed'::text, 'resolved'::text])));
ALTER TABLE ONLY public.research_findings ADD CONSTRAINT research_findings_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.research_lens_results ADD CONSTRAINT research_lens_results_status_check CHECK ((status = ANY (ARRAY['ok'::text, 'failed'::text])));
ALTER TABLE ONLY public.research_lens_results ADD CONSTRAINT research_lens_results_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.research_messages ADD CONSTRAINT research_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])));
ALTER TABLE ONLY public.research_messages ADD CONSTRAINT research_messages_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.research_opportunities ADD CONSTRAINT research_opportunities_relevance_check CHECK ((relevance = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text])));
ALTER TABLE ONLY public.research_opportunities ADD CONSTRAINT research_opportunities_status_check CHECK ((status = ANY (ARRAY['new'::text, 'assigned'::text, 'pursued'::text, 'won'::text, 'lost'::text, 'dropped'::text])));
ALTER TABLE ONLY public.research_opportunities ADD CONSTRAINT research_opportunities_timing_check CHECK ((timing = ANY (ARRAY['open'::text, 'closed'::text, 'unconfirmed'::text])));
ALTER TABLE ONLY public.research_opportunities ADD CONSTRAINT research_opportunities_track_check CHECK ((track = ANY (ARRAY[''::text, 'core'::text, 'broader'::text])));
ALTER TABLE ONLY public.research_opportunities ADD CONSTRAINT research_opportunities_type_check CHECK ((type = ANY (ARRAY['tender'::text, 'project'::text, 'lead'::text])));
ALTER TABLE ONLY public.research_opportunities ADD CONSTRAINT research_opportunities_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.research_runs ADD CONSTRAINT research_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'complete'::text, 'failed'::text])));
ALTER TABLE ONLY public.research_runs ADD CONSTRAINT research_runs_trigger_check CHECK ((trigger = ANY (ARRAY['manual'::text, 'scheduled'::text, 'chat'::text])));
ALTER TABLE ONLY public.research_runs ADD CONSTRAINT research_runs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.research_signals ADD CONSTRAINT research_signals_category_check CHECK ((category = ANY (ARRAY['project'::text, 'partnership'::text, 'product'::text, 'pricing'::text, 'hiring'::text, 'expansion'::text, 'content'::text, 'event'::text, 'award'::text, 'leadership'::text, 'regulation'::text, 'gigaproject'::text, 'tech'::text, 'tender'::text, 'other'::text])));
ALTER TABLE ONLY public.research_signals ADD CONSTRAINT research_signals_channel_check CHECK ((channel = ANY (ARRAY['website'::text, 'linkedin'::text, 'instagram'::text, 'tiktok'::text, 'x'::text, 'youtube'::text, 'news'::text, 'jobs'::text, 'tender_portal'::text, 'event_site'::text, 'government'::text, 'other'::text])));
ALTER TABLE ONLY public.research_signals ADD CONSTRAINT research_signals_relevance_check CHECK ((relevance = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text])));
ALTER TABLE ONLY public.research_signals ADD CONSTRAINT research_signals_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.research_source_checks ADD CONSTRAINT research_source_checks_status_check CHECK ((status = ANY (ARRAY['claimed'::text, 'done'::text, 'failed'::text])));
ALTER TABLE ONLY public.research_source_checks ADD CONSTRAINT research_source_checks_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.research_source_checks ADD CONSTRAINT research_source_checks_run_id_source_id_key UNIQUE (run_id, source_id);
ALTER TABLE ONLY public.sales_accounts ADD CONSTRAINT sales_accounts_bought_check CHECK ((bought = ANY (ARRAY[''::text, 'lighting'::text, 'controls'::text, 'both'::text])));
ALTER TABLE ONLY public.sales_accounts ADD CONSTRAINT sales_accounts_priority_check CHECK (((priority >= 1) AND (priority <= 3)));
ALTER TABLE ONLY public.sales_accounts ADD CONSTRAINT sales_accounts_status_check CHECK ((status = ANY (ARRAY['new'::text, 'contacted'::text, 'meeting'::text, 'quoted'::text, 'won'::text, 'parked'::text])));
ALTER TABLE ONLY public.sales_accounts ADD CONSTRAINT sales_accounts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.sales_accounts ADD CONSTRAINT sales_accounts_workspace_id_name_key UNIQUE (workspace_id, name);
ALTER TABLE ONLY public.sales_icp ADD CONSTRAINT sales_icp_pkey PRIMARY KEY (workspace_id);
ALTER TABLE ONLY public.sales_seats ADD CONSTRAINT sales_seats_pkey PRIMARY KEY (user_id, workspace_id);
ALTER TABLE ONLY public.social_accounts ADD CONSTRAINT social_accounts_account_type_check CHECK (((account_type IS NULL) OR (account_type = ANY (ARRAY['personal'::text, 'organization'::text]))));
ALTER TABLE ONLY public.social_accounts ADD CONSTRAINT social_accounts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.social_accounts ADD CONSTRAINT social_accounts_workspace_id_zernio_account_id_key UNIQUE (workspace_id, zernio_account_id);
ALTER TABLE ONLY public.social_connections ADD CONSTRAINT social_connections_platform_check CHECK ((platform = ANY (ARRAY['instagram'::text, 'facebook'::text, 'linkedin'::text, 'tiktok'::text, 'x'::text, 'pinterest'::text, 'youtube'::text, 'google_business'::text])));
ALTER TABLE ONLY public.social_connections ADD CONSTRAINT social_connections_status_check CHECK ((status = ANY (ARRAY['connected'::text, 'expired'::text, 'revoked'::text, 'error'::text])));
ALTER TABLE ONLY public.social_connections ADD CONSTRAINT social_connections_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.social_connections ADD CONSTRAINT social_connections_workspace_id_platform_external_account_i_key UNIQUE (workspace_id, platform, external_account_id);
ALTER TABLE ONLY public.subscriptions ADD CONSTRAINT subscriptions_plan_check CHECK ((plan = ANY (ARRAY['trial'::text, 'starter'::text, 'growth'::text, 'agency'::text])));
ALTER TABLE ONLY public.subscriptions ADD CONSTRAINT subscriptions_status_check CHECK ((status = ANY (ARRAY['trialing'::text, 'active'::text, 'past_due'::text, 'canceled'::text])));
ALTER TABLE ONLY public.subscriptions ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (workspace_id);
ALTER TABLE ONLY public.user_access ADD CONSTRAINT user_access_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text, 'sales'::text])));
ALTER TABLE ONLY public.user_access ADD CONSTRAINT user_access_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'revoked'::text])));
ALTER TABLE ONLY public.user_access ADD CONSTRAINT user_access_pkey PRIMARY KEY (user_id);
ALTER TABLE ONLY public.workspace_members ADD CONSTRAINT workspace_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'editor'::text, 'viewer'::text])));
ALTER TABLE ONLY public.workspace_members ADD CONSTRAINT workspace_members_pkey PRIMARY KEY (workspace_id, user_id);
ALTER TABLE ONLY public.workspace_webhooks ADD CONSTRAINT workspace_webhooks_pkey PRIMARY KEY (workspace_id);
ALTER TABLE ONLY public.workspaces ADD CONSTRAINT workspaces_plan_check CHECK ((plan = ANY (ARRAY['trial'::text, 'starter'::text, 'growth'::text, 'agency'::text])));
ALTER TABLE ONLY public.workspaces ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.workspaces ADD CONSTRAINT workspaces_slug_key UNIQUE (slug);

-- ═══ Indexes not backing a constraint (a foreign key may point at a unique index) ════════════════════

CREATE INDEX account_analytics_ws_idx ON public.account_analytics USING btree (workspace_id, metric_date DESC);
CREATE INDEX agent_edit_log_ws_idx ON public.agent_edit_log USING btree (workspace_id, created_at DESC);
CREATE INDEX agent_notes_body_fts_idx ON public.agent_notes USING gin (to_tsvector('english'::regconfig, body));
CREATE INDEX agent_notes_status_idx ON public.agent_notes USING btree (workspace_id, status);
CREATE INDEX agent_notes_ws_fingerprint_idx ON public.agent_notes USING btree (workspace_id, fingerprint);
CREATE INDEX agent_notes_ws_kind_idx ON public.agent_notes USING btree (workspace_id, kind, created_at DESC);
CREATE INDEX agent_usage_run_idx ON public.agent_usage USING btree (run_id) WHERE (run_id IS NOT NULL);
CREATE INDEX agent_usage_ws_created_idx ON public.agent_usage USING btree (workspace_id, created_at DESC);
CREATE INDEX brand_assets_project_idx ON public.brand_assets USING btree (workspace_id, project);
CREATE INDEX brand_assets_ws_idx ON public.brand_assets USING btree (workspace_id);
CREATE INDEX brand_competitors_ws_idx ON public.brand_competitors USING btree (workspace_id);
CREATE INDEX brand_directory_columns_ws_idx ON public.brand_directory_columns USING btree (workspace_id, section_key);
CREATE INDEX brand_directory_rows_ws_idx ON public.brand_directory_rows USING btree (workspace_id, section_key, sort_order);
CREATE INDEX brand_edit_feedback_created_at_idx ON public.brand_edit_feedback USING btree (created_at);
CREATE INDEX brand_edit_feedback_platform_idx ON public.brand_edit_feedback USING btree (platform);
CREATE INDEX brand_edit_feedback_workspace_id_idx ON public.brand_edit_feedback USING btree (workspace_id);
CREATE INDEX brand_edit_feedback_ws_idx ON public.brand_edit_feedback USING btree (workspace_id, created_at DESC);
CREATE INDEX brand_fields_ws_idx ON public.brand_fields USING btree (workspace_id, section_key);
CREATE INDEX brand_memory_active_idx ON public.brand_memory USING btree (workspace_id, status);
CREATE INDEX brand_memory_ws_idx ON public.brand_memory USING btree (workspace_id);
CREATE INDEX brand_msg_templates_ws_idx ON public.brand_message_templates USING btree (workspace_id);
CREATE INDEX brand_products_ws_idx ON public.brand_products USING btree (workspace_id);
CREATE INDEX brand_profile_workspace_id_idx ON public.brand_profile USING btree (workspace_id);
CREATE INDEX brand_sections_ws_idx ON public.brand_sections USING btree (workspace_id);
CREATE INDEX brand_suppliers_ws_idx ON public.brand_suppliers USING btree (workspace_id);
CREATE INDEX ceo_briefs_latest_idx ON public.ceo_briefs USING btree (workspace_id, created_at DESC);
CREATE INDEX competitor_brands_brand_idx ON public.competitor_brands USING btree (workspace_id, lower(brand));
CREATE UNIQUE INDEX competitor_brands_fp_idx ON public.competitor_brands USING btree (workspace_id, fingerprint);
CREATE UNIQUE INDEX competitor_snapshots_once_per_run ON public.competitor_snapshots USING btree (run_id, lower(competitor_name));
CREATE INDEX competitor_snapshots_run_idx ON public.competitor_snapshots USING btree (run_id);
CREATE INDEX competitor_snapshots_series_idx ON public.competitor_snapshots USING btree (workspace_id, lower(competitor_name), captured_at DESC);
CREATE INDEX content_plans_generating_idx ON public.content_plans USING btree (workspace_id, generation_started_at) WHERE (status = 'generating'::text);
CREATE INDEX content_plans_ws_idx ON public.content_plans USING btree (workspace_id);
CREATE INDEX creative_sessions_plan_idea_idx ON public.creative_sessions USING btree (plan_idea_id) WHERE (plan_idea_id IS NOT NULL);
CREATE INDEX creative_sessions_ws_idx ON public.creative_sessions USING btree (workspace_id, created_at DESC);
CREATE UNIQUE INDEX creative_versions_clip_attempt_uidx ON public.creative_versions USING btree (session_id, clip_index, clip_attempt) WHERE (clip_index IS NOT NULL);
CREATE INDEX creative_versions_clip_idx ON public.creative_versions USING btree (session_id, clip_index, clip_attempt DESC) WHERE (clip_index IS NOT NULL);
CREATE INDEX creative_versions_pending_idx ON public.creative_versions USING btree (session_id) WHERE (status = 'pending'::text);
CREATE INDEX creative_versions_session_idx ON public.creative_versions USING btree (session_id, round, created_at);
CREATE INDEX creative_versions_ws_idx ON public.creative_versions USING btree (workspace_id);
CREATE INDEX deal_outcomes_competitor_idx ON public.deal_outcomes USING btree (workspace_id, lower(competitor));
CREATE INDEX deal_outcomes_recent_idx ON public.deal_outcomes USING btree (workspace_id, decided_on DESC NULLS LAST);
CREATE UNIQUE INDEX email_ai_drafts_week_idx ON public.email_ai_drafts USING btree (workspace_id, week_of);
CREATE INDEX email_campaigns_ws_idx ON public.email_campaigns USING btree (workspace_id, created_at DESC);
CREATE UNIQUE INDEX email_contacts_id_ws_idx ON public.email_contacts USING btree (id, workspace_id);
CREATE INDEX email_contacts_subscribed_idx ON public.email_contacts USING btree (workspace_id, subscribed_at DESC) WHERE (subscribed_at IS NOT NULL);
CREATE UNIQUE INDEX email_contacts_unsub_token_idx ON public.email_contacts USING btree (unsubscribe_token);
CREATE INDEX email_contacts_ws_created_idx ON public.email_contacts USING btree (workspace_id, created_at DESC);
CREATE UNIQUE INDEX email_contacts_ws_email_idx ON public.email_contacts USING btree (workspace_id, email);
CREATE INDEX email_events_ws_idx ON public.email_events USING btree (workspace_id, created_at DESC);
CREATE INDEX email_group_exclusions_contact_idx ON public.email_group_exclusions USING btree (contact_id);
CREATE INDEX email_group_members_contact_idx ON public.email_group_members USING btree (contact_id);
CREATE INDEX email_group_members_ws_idx ON public.email_group_members USING btree (workspace_id);
CREATE UNIQUE INDEX email_groups_id_ws_idx ON public.email_groups USING btree (id, workspace_id);
CREATE UNIQUE INDEX email_groups_ws_name_idx ON public.email_groups USING btree (workspace_id, lower(name));
CREATE UNIQUE INDEX email_mailboxes_ws_email_idx ON public.email_mailboxes USING btree (workspace_id, email);
CREATE INDEX email_sends_mailbox_sent_idx ON public.email_sends USING btree (mailbox_id, sent_at DESC);
CREATE INDEX email_sends_mailbox_thread_idx ON public.email_sends USING btree (mailbox_id, thread_id) WHERE (thread_id IS NOT NULL);
CREATE INDEX email_sends_message_id_idx ON public.email_sends USING btree (message_id);
CREATE UNIQUE INDEX email_sends_once_idx ON public.email_sends USING btree (campaign_id, contact_id, step);
CREATE INDEX email_sends_provider_idx ON public.email_sends USING btree (provider_id);
CREATE INDEX email_sends_queue_idx ON public.email_sends USING btree (workspace_id, status, due_at);
CREATE INDEX email_sends_ws_sent_idx ON public.email_sends USING btree (workspace_id, sent_at DESC);
CREATE UNIQUE INDEX email_settings_website_signup_key_idx ON public.email_settings USING btree (website_signup_key) WHERE (website_signup_key IS NOT NULL);
CREATE INDEX generated_posts_creative_session_idx ON public.generated_posts USING btree (creative_session_id) WHERE (creative_session_id IS NOT NULL);
CREATE INDEX generated_posts_due_idx ON public.generated_posts USING btree (scheduled_publish_at) WHERE (publish_status = 'scheduled'::text);
CREATE INDEX generated_posts_plan_idea_idx ON public.generated_posts USING btree (plan_idea_id) WHERE (plan_idea_id IS NOT NULL);
CREATE INDEX generated_posts_platform_idx ON public.generated_posts USING btree (platform);
CREATE INDEX generated_posts_sched_idx ON public.generated_posts USING btree (workspace_id, scheduled_publish_at) WHERE (scheduled_publish_at IS NOT NULL);
CREATE INDEX generated_posts_tags_idx ON public.generated_posts USING gin (tags);
CREATE INDEX generated_posts_ws_idx ON public.generated_posts USING btree (workspace_id);
CREATE INDEX generated_posts_zernio_id_idx ON public.generated_posts USING btree (zernio_post_id) WHERE (zernio_post_id <> ''::text);
CREATE INDEX idea_events_idea_idx ON public.idea_events USING btree (idea_id);
CREATE INDEX idea_events_ws_idx ON public.idea_events USING btree (workspace_id, created_at DESC);
CREATE INDEX idx_instagram_generated_posts_status ON public.instagram_generated_posts USING btree (status, created_at DESC);
CREATE INDEX idx_instagram_schedule_date_status ON public.instagram_schedule USING btree (scheduled_date, status);
CREATE INDEX idx_instagram_schedule_date_status_time ON public.instagram_schedule USING btree (scheduled_date, status, publish_time);
CREATE INDEX instagram_generated_plan_idea_idx ON public.instagram_generated_posts USING btree (plan_idea_id);
CREATE INDEX instagram_generated_posts_creative_session_idx ON public.instagram_generated_posts USING btree (creative_session_id) WHERE (creative_session_id IS NOT NULL);
CREATE INDEX instagram_generated_posts_due_idx ON public.instagram_generated_posts USING btree (scheduled_publish_at) WHERE (publish_status = 'scheduled'::text);
CREATE INDEX instagram_generated_posts_sched_idx ON public.instagram_generated_posts USING btree (workspace_id, scheduled_publish_at) WHERE (scheduled_publish_at IS NOT NULL);
CREATE INDEX instagram_generated_posts_workspace_id_idx ON public.instagram_generated_posts USING btree (workspace_id);
CREATE INDEX instagram_generated_posts_zernio_id_idx ON public.instagram_generated_posts USING btree (zernio_post_id) WHERE (zernio_post_id <> ''::text);
CREATE INDEX instagram_generated_ws_idx ON public.instagram_generated_posts USING btree (workspace_id);
CREATE INDEX instagram_manual_posts_workspace_id_idx ON public.instagram_manual_posts USING btree (workspace_id);
CREATE INDEX instagram_reels_workspace_id_idx ON public.instagram_reels USING btree (workspace_id);
CREATE UNIQUE INDEX instagram_schedule_webapp_id_key ON public.instagram_schedule USING btree (webapp_id) WHERE (webapp_id IS NOT NULL);
CREATE INDEX instagram_schedule_workspace_id_idx ON public.instagram_schedule USING btree (workspace_id);
CREATE UNIQUE INDEX lead_agent_settings_export_key_idx ON public.lead_agent_settings USING btree (export_key);
CREATE UNIQUE INDEX lead_agent_settings_key_idx ON public.lead_agent_settings USING btree (intake_key);
CREATE INDEX lead_cards_ws_idx ON public.lead_cards USING btree (workspace_id);
CREATE INDEX lead_reads_user ON public.lead_reads USING btree (user_id, workspace_id);
CREATE INDEX leads_assigned ON public.leads USING btree (workspace_id, assigned_to);
CREATE INDEX leads_conversation_idx ON public.leads USING btree (workspace_id, conversation_id) WHERE (conversation_id <> ''::text);
CREATE INDEX leads_crm_waiting ON public.leads USING btree (workspace_id) WHERE (crm_status = ANY (ARRAY['queued'::text, 'failed'::text]));
CREATE INDEX leads_pipeline ON public.leads USING btree (workspace_id, stage) WHERE (stage IS NOT NULL);
CREATE INDEX leads_ws_received_idx ON public.leads USING btree (workspace_id, received_at DESC);
CREATE INDEX leads_ws_updated_idx ON public.leads USING btree (workspace_id, updated_at, id);
CREATE INDEX media_library_workspace_id_idx ON public.media_library USING btree (workspace_id);
CREATE INDEX notifications_inbox_idx ON public.notifications USING btree (user_id, read_at, created_at DESC);
CREATE INDEX plan_ideas_copy_mode_idx ON public.plan_ideas USING btree (plan_id, copy_mode);
CREATE INDEX plan_ideas_draft_status_idx ON public.plan_ideas USING btree (draft_status) WHERE (draft_status = 'drafting'::text);
CREATE INDEX plan_ideas_generation_status_idx ON public.plan_ideas USING btree (generation_status);
CREATE INDEX plan_ideas_group_id_idx ON public.plan_ideas USING btree (group_id) WHERE (group_id IS NOT NULL);
CREATE INDEX plan_ideas_media_status_idx ON public.plan_ideas USING btree (plan_id, media_status);
CREATE INDEX plan_ideas_plan_idx ON public.plan_ideas USING btree (plan_id);
CREATE INDEX plan_ideas_ws_idx ON public.plan_ideas USING btree (workspace_id);
CREATE INDEX post_analytics_account_idx ON public.post_analytics USING btree (workspace_id, zernio_account_id) WHERE (zernio_account_id <> ''::text);
CREATE INDEX post_analytics_date_idx ON public.post_analytics USING btree (workspace_id, metric_date DESC);
CREATE UNIQUE INDEX post_analytics_external_key ON public.post_analytics USING btree (workspace_id, platform, platform_post_id, metric_date) WHERE (origin = 'external'::text);
CREATE INDEX post_analytics_origin_idx ON public.post_analytics USING btree (workspace_id, origin);
CREATE INDEX post_analytics_post_idx ON public.post_analytics USING btree (post_id) WHERE (post_id IS NOT NULL);
CREATE INDEX post_analytics_ws_idx ON public.post_analytics USING btree (workspace_id);
CREATE INDEX request_events_idx ON public.request_events USING btree (request_id, created_at);
CREATE INDEX requests_assignee_idx ON public.requests USING btree (assigned_to, status);
CREATE INDEX requests_board_idx ON public.requests USING btree (workspace_id, status, updated_at DESC);
CREATE INDEX requests_creator_idx ON public.requests USING btree (created_by, status);
CREATE INDEX research_agenda_competitor_tier_idx ON public.research_agenda USING btree (workspace_id, tier) WHERE ((kind = 'competitor'::text) AND (status = 'active'::text));
CREATE UNIQUE INDEX research_agenda_competitor_uniq ON public.research_agenda USING btree (workspace_id, lower(subject)) WHERE (kind = 'competitor'::text);
CREATE INDEX research_agenda_ws_idx ON public.research_agenda USING btree (workspace_id, status);
CREATE INDEX research_chats_owner_idx ON public.research_chats USING btree (workspace_id, user_id, updated_at DESC);
CREATE INDEX research_chats_ws_idx ON public.research_chats USING btree (workspace_id, updated_at DESC);
CREATE INDEX research_events_date_idx ON public.research_events USING btree (workspace_id, start_date);
CREATE UNIQUE INDEX research_events_fp_idx ON public.research_events USING btree (workspace_id, fingerprint);
CREATE INDEX research_findings_run_idx ON public.research_findings USING btree (run_id);
CREATE INDEX research_findings_ws_idx ON public.research_findings USING btree (workspace_id, created_at DESC);
CREATE UNIQUE INDEX research_lens_results_run_lens_idx ON public.research_lens_results USING btree (run_id, lens);
CREATE INDEX research_lens_results_ws_idx ON public.research_lens_results USING btree (workspace_id, created_at DESC);
CREATE INDEX research_messages_chat_idx ON public.research_messages USING btree (chat_id, created_at);
CREATE UNIQUE INDEX research_opportunities_fp_idx ON public.research_opportunities USING btree (workspace_id, fingerprint);
CREATE INDEX research_opportunities_open_idx ON public.research_opportunities USING btree (workspace_id, status, deadline);
CREATE INDEX research_opportunities_ws_line_idx ON public.research_opportunities USING btree (workspace_id, line);
CREATE UNIQUE INDEX research_runs_single_flight ON public.research_runs USING btree (workspace_id) WHERE (status = 'running'::text);
CREATE INDEX research_runs_ws_idx ON public.research_runs USING btree (workspace_id, started_at DESC);
CREATE UNIQUE INDEX research_signals_fp_idx ON public.research_signals USING btree (workspace_id, fingerprint);
CREATE INDEX research_signals_seen_idx ON public.research_signals USING btree (workspace_id, last_seen_at DESC);
CREATE INDEX research_signals_ws_line_idx ON public.research_signals USING btree (workspace_id, line);
CREATE INDEX research_source_checks_ws_idx ON public.research_source_checks USING btree (workspace_id, source_id, checked_at DESC);
CREATE INDEX sales_accounts_ws_idx ON public.sales_accounts USING btree (workspace_id, priority, value_sar DESC);
CREATE INDEX social_accounts_login_method_idx ON public.social_accounts USING btree (workspace_id, platform, login_method) WHERE (platform = 'instagram'::text);
CREATE INDEX social_accounts_platform_idx ON public.social_accounts USING btree (workspace_id, platform);
CREATE INDEX social_accounts_profile_idx ON public.social_accounts USING btree (zernio_profile_id) WHERE (zernio_profile_id IS NOT NULL);
CREATE INDEX social_accounts_protected_idx ON public.social_accounts USING btree (workspace_id, platform) WHERE is_protected;
CREATE INDEX social_accounts_ws_idx ON public.social_accounts USING btree (workspace_id);
CREATE INDEX user_access_status_idx ON public.user_access USING btree (status);
CREATE UNIQUE INDEX workspaces_zernio_profile_idx ON public.workspaces USING btree (zernio_profile_id) WHERE (zernio_profile_id IS NOT NULL);

-- ═══ Foreign keys ════════════════════

ALTER TABLE ONLY public.access_invites ADD CONSTRAINT access_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.account_analytics ADD CONSTRAINT account_analytics_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.agent_cap_log ADD CONSTRAINT agent_cap_log_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.agent_cap_log ADD CONSTRAINT agent_cap_log_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.agent_digest ADD CONSTRAINT agent_digest_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.agent_edit_log ADD CONSTRAINT agent_edit_log_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.research_chats(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.agent_edit_log ADD CONSTRAINT agent_edit_log_undoes_fkey FOREIGN KEY (undoes) REFERENCES public.agent_edit_log(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.agent_edit_log ADD CONSTRAINT agent_edit_log_undone_by_fkey FOREIGN KEY (undone_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.agent_edit_log ADD CONSTRAINT agent_edit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.agent_edit_log ADD CONSTRAINT agent_edit_log_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.agent_notes ADD CONSTRAINT agent_notes_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.agent_usage ADD CONSTRAINT agent_usage_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.research_chats(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.agent_usage ADD CONSTRAINT agent_usage_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.research_runs(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.agent_usage ADD CONSTRAINT agent_usage_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.brand_assets ADD CONSTRAINT brand_assets_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.brand_competitors ADD CONSTRAINT brand_competitors_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.brand_directory_columns ADD CONSTRAINT brand_directory_columns_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.brand_directory_rows ADD CONSTRAINT brand_directory_rows_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.brand_edit_feedback ADD CONSTRAINT brand_edit_feedback_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);
ALTER TABLE ONLY public.brand_fields ADD CONSTRAINT brand_fields_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.brand_memory ADD CONSTRAINT brand_memory_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.brand_message_templates ADD CONSTRAINT brand_message_templates_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.brand_products ADD CONSTRAINT brand_products_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.brand_profile ADD CONSTRAINT brand_profile_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);
ALTER TABLE ONLY public.brand_sections ADD CONSTRAINT brand_sections_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.brand_suppliers ADD CONSTRAINT brand_suppliers_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.ceo_briefs ADD CONSTRAINT ceo_briefs_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.ceo_briefs ADD CONSTRAINT ceo_briefs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.competitor_brands ADD CONSTRAINT competitor_brands_competitor_id_fkey FOREIGN KEY (competitor_id) REFERENCES public.research_agenda(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.competitor_brands ADD CONSTRAINT competitor_brands_first_run_id_fkey FOREIGN KEY (first_run_id) REFERENCES public.research_runs(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.competitor_brands ADD CONSTRAINT competitor_brands_last_run_id_fkey FOREIGN KEY (last_run_id) REFERENCES public.research_runs(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.competitor_brands ADD CONSTRAINT competitor_brands_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.competitor_snapshots ADD CONSTRAINT competitor_snapshots_agenda_id_fkey FOREIGN KEY (agenda_id) REFERENCES public.research_agenda(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.competitor_snapshots ADD CONSTRAINT competitor_snapshots_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.research_runs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.competitor_snapshots ADD CONSTRAINT competitor_snapshots_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.content_plans ADD CONSTRAINT content_plans_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.creative_sessions ADD CONSTRAINT creative_sessions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.creative_sessions ADD CONSTRAINT creative_sessions_plan_idea_id_fkey FOREIGN KEY (plan_idea_id) REFERENCES public.plan_ideas(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.creative_sessions ADD CONSTRAINT creative_sessions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.creative_versions ADD CONSTRAINT creative_versions_parent_version_id_fkey FOREIGN KEY (parent_version_id) REFERENCES public.creative_versions(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.creative_versions ADD CONSTRAINT creative_versions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.creative_sessions(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.creative_versions ADD CONSTRAINT creative_versions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.deal_outcomes ADD CONSTRAINT deal_outcomes_competitor_id_fkey FOREIGN KEY (competitor_id) REFERENCES public.research_agenda(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.deal_outcomes ADD CONSTRAINT deal_outcomes_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.deal_outcomes ADD CONSTRAINT deal_outcomes_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.email_ai_drafts ADD CONSTRAINT email_ai_drafts_research_run_id_fkey FOREIGN KEY (research_run_id) REFERENCES public.research_runs(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.email_ai_drafts ADD CONSTRAINT email_ai_drafts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.email_campaigns ADD CONSTRAINT email_campaigns_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.email_campaigns ADD CONSTRAINT email_campaigns_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.email_contacts ADD CONSTRAINT email_contacts_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.email_contacts ADD CONSTRAINT email_contacts_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.research_opportunities(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.email_contacts ADD CONSTRAINT email_contacts_subscribed_campaign_id_fkey FOREIGN KEY (subscribed_campaign_id) REFERENCES public.email_campaigns(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.email_contacts ADD CONSTRAINT email_contacts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.email_events ADD CONSTRAINT email_events_send_id_fkey FOREIGN KEY (send_id) REFERENCES public.email_sends(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.email_events ADD CONSTRAINT email_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.email_group_exclusions ADD CONSTRAINT email_group_exclusions_contact_id_workspace_id_fkey FOREIGN KEY (contact_id, workspace_id) REFERENCES public.email_contacts(id, workspace_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.email_group_exclusions ADD CONSTRAINT email_group_exclusions_group_id_workspace_id_fkey FOREIGN KEY (group_id, workspace_id) REFERENCES public.email_groups(id, workspace_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.email_group_exclusions ADD CONSTRAINT email_group_exclusions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.email_group_members ADD CONSTRAINT email_group_members_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.email_contacts(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.email_group_members ADD CONSTRAINT email_group_members_contact_ws_fk FOREIGN KEY (contact_id, workspace_id) REFERENCES public.email_contacts(id, workspace_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.email_group_members ADD CONSTRAINT email_group_members_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.email_groups(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.email_group_members ADD CONSTRAINT email_group_members_group_ws_fk FOREIGN KEY (group_id, workspace_id) REFERENCES public.email_groups(id, workspace_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.email_group_members ADD CONSTRAINT email_group_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.email_groups ADD CONSTRAINT email_groups_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.email_mailbox_secrets ADD CONSTRAINT email_mailbox_secrets_mailbox_id_fkey FOREIGN KEY (mailbox_id) REFERENCES public.email_mailboxes(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.email_mailbox_secrets ADD CONSTRAINT email_mailbox_secrets_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.email_mailboxes ADD CONSTRAINT email_mailboxes_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.email_mailboxes ADD CONSTRAINT email_mailboxes_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.email_sends ADD CONSTRAINT email_sends_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.email_campaigns(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.email_sends ADD CONSTRAINT email_sends_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.email_contacts(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.email_sends ADD CONSTRAINT email_sends_mailbox_id_fkey FOREIGN KEY (mailbox_id) REFERENCES public.email_mailboxes(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.email_sends ADD CONSTRAINT email_sends_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.email_settings ADD CONSTRAINT email_settings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.generated_posts ADD CONSTRAINT generated_posts_creative_session_id_fkey FOREIGN KEY (creative_session_id) REFERENCES public.creative_sessions(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.generated_posts ADD CONSTRAINT generated_posts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.idea_events ADD CONSTRAINT idea_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.instagram_generated_posts ADD CONSTRAINT instagram_generated_posts_creative_session_id_fkey FOREIGN KEY (creative_session_id) REFERENCES public.creative_sessions(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.instagram_generated_posts ADD CONSTRAINT instagram_generated_posts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);
ALTER TABLE ONLY public.instagram_manual_posts ADD CONSTRAINT instagram_manual_posts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);
ALTER TABLE ONLY public.instagram_reels ADD CONSTRAINT instagram_reels_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);
ALTER TABLE ONLY public.instagram_schedule ADD CONSTRAINT instagram_schedule_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);
ALTER TABLE ONLY public.lead_agent_secrets ADD CONSTRAINT lead_agent_secrets_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.lead_agent_settings ADD CONSTRAINT lead_agent_settings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.lead_cards ADD CONSTRAINT lead_cards_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.lead_cards ADD CONSTRAINT lead_cards_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.lead_cards ADD CONSTRAINT lead_cards_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.lead_crm ADD CONSTRAINT lead_crm_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.lead_mailbox_secrets ADD CONSTRAINT lead_mailbox_secrets_mailbox_id_fkey FOREIGN KEY (mailbox_id) REFERENCES public.lead_mailboxes(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.lead_mailbox_secrets ADD CONSTRAINT lead_mailbox_secrets_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.lead_mailboxes ADD CONSTRAINT lead_mailboxes_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.lead_mailboxes ADD CONSTRAINT lead_mailboxes_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.lead_reads ADD CONSTRAINT lead_reads_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.lead_reads ADD CONSTRAINT lead_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.lead_reads ADD CONSTRAINT lead_reads_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.leads ADD CONSTRAINT leads_added_by_fkey FOREIGN KEY (added_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.leads ADD CONSTRAINT leads_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.leads ADD CONSTRAINT leads_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.leads ADD CONSTRAINT leads_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.leads ADD CONSTRAINT leads_duplicate_of_fkey FOREIGN KEY (duplicate_of) REFERENCES public.leads(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.leads ADD CONSTRAINT leads_project_set_by_fkey FOREIGN KEY (project_set_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.leads ADD CONSTRAINT leads_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.leads ADD CONSTRAINT leads_stage_by_fkey FOREIGN KEY (stage_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.leads ADD CONSTRAINT leads_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.media_library ADD CONSTRAINT media_library_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);
ALTER TABLE ONLY public.notifications ADD CONSTRAINT notifications_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.notifications ADD CONSTRAINT notifications_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.plan_ideas ADD CONSTRAINT plan_ideas_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.content_plans(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.plan_ideas ADD CONSTRAINT plan_ideas_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.post_analytics ADD CONSTRAINT post_analytics_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.request_events ADD CONSTRAINT request_events_actor_fkey FOREIGN KEY (actor) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.request_events ADD CONSTRAINT request_events_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.request_events ADD CONSTRAINT request_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.request_people ADD CONSTRAINT request_people_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.request_people ADD CONSTRAINT request_people_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.requests ADD CONSTRAINT requests_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.requests ADD CONSTRAINT requests_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.research_chats(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.requests ADD CONSTRAINT requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.requests ADD CONSTRAINT requests_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.requests ADD CONSTRAINT requests_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.research_agenda ADD CONSTRAINT research_agenda_last_seen_run_id_fkey FOREIGN KEY (last_seen_run_id) REFERENCES public.research_runs(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.research_agenda ADD CONSTRAINT research_agenda_source_row_id_fkey FOREIGN KEY (source_row_id) REFERENCES public.brand_directory_rows(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.research_agenda ADD CONSTRAINT research_agenda_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.research_chats ADD CONSTRAINT research_chats_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.research_runs(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.research_chats ADD CONSTRAINT research_chats_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.research_chats ADD CONSTRAINT research_chats_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.research_events ADD CONSTRAINT research_events_first_run_id_fkey FOREIGN KEY (first_run_id) REFERENCES public.research_runs(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.research_events ADD CONSTRAINT research_events_last_run_id_fkey FOREIGN KEY (last_run_id) REFERENCES public.research_runs(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.research_events ADD CONSTRAINT research_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.research_findings ADD CONSTRAINT research_findings_agenda_id_fkey FOREIGN KEY (agenda_id) REFERENCES public.research_agenda(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.research_findings ADD CONSTRAINT research_findings_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.research_runs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.research_findings ADD CONSTRAINT research_findings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.research_lens_results ADD CONSTRAINT research_lens_results_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.research_runs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.research_lens_results ADD CONSTRAINT research_lens_results_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.research_messages ADD CONSTRAINT research_messages_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.research_chats(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.research_messages ADD CONSTRAINT research_messages_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.research_opportunities ADD CONSTRAINT research_opportunities_first_run_id_fkey FOREIGN KEY (first_run_id) REFERENCES public.research_runs(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.research_opportunities ADD CONSTRAINT research_opportunities_last_run_id_fkey FOREIGN KEY (last_run_id) REFERENCES public.research_runs(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.research_opportunities ADD CONSTRAINT research_opportunities_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.research_runs ADD CONSTRAINT research_runs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.research_signals ADD CONSTRAINT research_signals_first_run_id_fkey FOREIGN KEY (first_run_id) REFERENCES public.research_runs(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.research_signals ADD CONSTRAINT research_signals_last_run_id_fkey FOREIGN KEY (last_run_id) REFERENCES public.research_runs(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.research_signals ADD CONSTRAINT research_signals_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.research_source_checks ADD CONSTRAINT research_source_checks_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.research_runs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.research_source_checks ADD CONSTRAINT research_source_checks_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.research_agenda(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.research_source_checks ADD CONSTRAINT research_source_checks_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.sales_accounts ADD CONSTRAINT sales_accounts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.sales_icp ADD CONSTRAINT sales_icp_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.sales_icp ADD CONSTRAINT sales_icp_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.sales_seats ADD CONSTRAINT sales_seats_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.sales_seats ADD CONSTRAINT sales_seats_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.social_accounts ADD CONSTRAINT social_accounts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.social_connections ADD CONSTRAINT social_connections_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.subscriptions ADD CONSTRAINT subscriptions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.user_access ADD CONSTRAINT user_access_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.user_access ADD CONSTRAINT user_access_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.workspace_members ADD CONSTRAINT workspace_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.workspace_members ADD CONSTRAINT workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.workspace_webhooks ADD CONSTRAINT workspace_webhooks_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

-- ═══ Views (options such as security_invoker copied from production) ════════════════════

CREATE VIEW public.email_campaign_stats WITH (security_invoker=true) AS
 SELECT campaign_id,
    workspace_id,
    count(*) AS total,
    count(*) FILTER (WHERE (status = 'queued'::text)) AS queued,
    count(*) FILTER (WHERE (sent_at IS NOT NULL)) AS sent,
    count(*) FILTER (WHERE (delivered_at IS NOT NULL)) AS delivered,
    count(*) FILTER (WHERE (opened_at IS NOT NULL)) AS opened,
    count(*) FILTER (WHERE (clicked_at IS NOT NULL)) AS clicked,
    count(*) FILTER (WHERE (bounced_at IS NOT NULL)) AS bounced,
    count(*) FILTER (WHERE (complained_at IS NOT NULL)) AS complained,
    count(*) FILTER (WHERE (status = ANY (ARRAY['failed'::text, 'skipped'::text]))) AS failed,
    count(*) FILTER (WHERE (replied_at IS NOT NULL)) AS replied,
    count(*) FILTER (WHERE (subscribed_at IS NOT NULL)) AS subscribed
   FROM public.email_sends s
  GROUP BY campaign_id, workspace_id;

CREATE VIEW public.scheduled_posts WITH (security_invoker=true) AS
 SELECT 'instagram_generated_posts'::text AS post_table,
    'instagram'::text AS platform,
    p.id,
    p.workspace_id,
    p.caption,
    p.caption_ar,
    p.caption_en,
    p.hashtags,
    p.first_comment,
    NULL::text AS hook,
    NULL::text AS body,
    p.topic,
    p.post_kind,
    p.style,
    p.tone,
    p.aspect_ratio,
    NULL::text AS format,
        CASE
            WHEN (COALESCE(p.video_url, ''::text) <> ''::text) THEN 'video'::text
            ELSE 'image'::text
        END AS media_type,
    NULL::jsonb AS media,
    p.image_url,
    p.image_urls,
    p.image_prompt,
    p.video_url,
    p.cover_image_url,
    p.motion_prompt,
    p.post_strategy,
    NULL::text AS post_type,
    NULL::boolean AS include_image,
    NULL::text AS content_route,
    '{}'::jsonb AS platform_options,
    '{}'::text[] AS tags,
    p.scheduled_date,
    p.publish_time,
    p.status,
    p.source,
    p.plan_id,
    p.plan_idea_id,
    p.campaign_id,
    p.creative_session_id,
    p.creative_version_id,
    p.zernio_post_id,
    p.zernio_account_id,
    p.publish_provider,
    p.publish_status,
    p.published_at,
    p.scheduled_publish_at,
    p.publish_error,
    p.platform_post_url,
    p.created_at,
    p.updated_at
   FROM public.instagram_generated_posts p
UNION ALL
 SELECT 'generated_posts'::text AS post_table,
    p.platform,
    p.id,
    p.workspace_id,
    p.caption,
    p.caption_ar,
    p.caption_en,
    p.hashtags,
    p.first_comment,
    NULL::text AS hook,
    NULL::text AS body,
    p.topic,
    p.post_kind,
    p.style,
    p.tone,
    p.aspect_ratio,
    p.format,
    p.media_type,
    p.media,
    p.image_url,
    p.image_urls,
    p.image_prompt,
    p.video_url,
    p.cover_image_url,
    p.motion_prompt,
    p.post_strategy,
    NULL::text AS post_type,
    NULL::boolean AS include_image,
    NULL::text AS content_route,
    p.platform_options,
    p.tags,
    p.scheduled_date,
    p.publish_time,
    p.status,
    p.source,
    p.plan_id,
    p.plan_idea_id,
    (p.campaign_id)::text AS campaign_id,
    p.creative_session_id,
    p.creative_version_id,
    p.zernio_post_id,
    p.zernio_account_id,
    p.publish_provider,
    p.publish_status,
    p.published_at,
    p.scheduled_publish_at,
    p.publish_error,
    p.platform_post_url,
    p.created_at,
    p.updated_at
   FROM public.generated_posts p;


-- ═══ Triggers (public tables, plus auth.users -> public.handle_new_user) ════════════════════

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
CREATE TRIGGER agent_usage_warn AFTER INSERT ON public.agent_usage FOR EACH ROW EXECUTE FUNCTION public.agent_usage_warn();
CREATE TRIGGER email_group_members_hand_edit AFTER INSERT OR DELETE ON public.email_group_members FOR EACH ROW EXECUTE FUNCTION public.email_group_members_hand_edit();
CREATE TRIGGER generated_posts_lock_sent BEFORE DELETE OR UPDATE ON public.generated_posts FOR EACH ROW EXECUTE FUNCTION public.generated_posts_lock_sent();
CREATE TRIGGER instagram_generated_posts_updated_at BEFORE UPDATE ON public.instagram_generated_posts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER instagram_schedule_updated_at BEFORE UPDATE ON public.instagram_schedule FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER leads_sync_contact AFTER INSERT OR DELETE OR UPDATE OF verdict, human_verdict, email, duplicate_of ON public.leads FOR EACH ROW EXECUTE FUNCTION public.leads_sync_contact();
CREATE TRIGGER request_comment_notify AFTER INSERT ON public.request_events FOR EACH ROW EXECUTE FUNCTION public.request_comment_notify();
CREATE TRIGGER requests_notify_ins AFTER INSERT ON public.requests FOR EACH ROW EXECUTE FUNCTION public.requests_notify();
CREATE TRIGGER requests_notify_upd BEFORE UPDATE ON public.requests FOR EACH ROW EXECUTE FUNCTION public.requests_notify();
CREATE TRIGGER unassign_on_seat_removed AFTER DELETE ON public.sales_seats FOR EACH ROW EXECUTE FUNCTION public.unassign_on_seat_removed();
CREATE TRIGGER workspaces_guard BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.workspaces_guard();
CREATE TRIGGER workspaces_sync_roster AFTER INSERT ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.sync_workspace_roster();

-- ═══ Row level security ════════════════════

ALTER TABLE public.access_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_cap_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_digest ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_edit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_directory_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_directory_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_edit_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ceo_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creative_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creative_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_ai_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_group_exclusions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_mailbox_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_mailboxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idea_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_generated_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_manual_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_reels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_agent_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_agent_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_crm ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_mailbox_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_mailboxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_agenda ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_lens_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_source_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_icp ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_seats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

-- ═══ Policies (public tables and storage.objects) ════════════════════

CREATE POLICY access_invites_admin_read ON public.access_invites AS PERMISSIVE FOR SELECT TO public
  USING (public.is_access_admin());

CREATE POLICY account_analytics_rw ON public.account_analytics AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY agent_cap_log_read ON public.agent_cap_log AS PERMISSIVE FOR SELECT TO authenticated
  USING ((public.is_access_admin() AND public.is_workspace_member(workspace_id)));

CREATE POLICY agent_digest_member ON public.agent_digest AS PERMISSIVE FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.workspace_members m
  WHERE ((m.workspace_id = agent_digest.workspace_id) AND (m.user_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.workspace_members m
  WHERE ((m.workspace_id = agent_digest.workspace_id) AND (m.user_id = auth.uid())))));

CREATE POLICY agent_edit_log_member_read ON public.agent_edit_log AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY agent_notes_member ON public.agent_notes AS PERMISSIVE FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.workspace_members m
  WHERE ((m.workspace_id = agent_notes.workspace_id) AND (m.user_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.workspace_members m
  WHERE ((m.workspace_id = agent_notes.workspace_id) AND (m.user_id = auth.uid())))));

CREATE POLICY agent_usage_read ON public.agent_usage AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY brand_assets_rw ON public.brand_assets AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY brand_competitors_rw ON public.brand_competitors AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY brand_directory_columns_rw ON public.brand_directory_columns AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY brand_directory_rows_rw ON public.brand_directory_rows AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY brand_edit_feedback_anon_legacy_only ON public.brand_edit_feedback AS PERMISSIVE FOR ALL TO anon
  USING ((workspace_id = '00000000-0000-0000-0000-000000000001'::uuid))
  WITH CHECK ((workspace_id = '00000000-0000-0000-0000-000000000001'::uuid));

CREATE POLICY brand_edit_feedback_members_only ON public.brand_edit_feedback AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY brand_edit_feedback_rw ON public.brand_edit_feedback AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY brand_fields_rw ON public.brand_fields AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY brand_memory_rw ON public.brand_memory AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY brand_msg_templates_rw ON public.brand_message_templates AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY brand_products_rw ON public.brand_products AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY brand_profile_members_only ON public.brand_profile AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY brand_sections_rw ON public.brand_sections AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY brand_suppliers_rw ON public.brand_suppliers AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY ceo_briefs_admin_read ON public.ceo_briefs AS PERMISSIVE FOR SELECT TO authenticated
  USING ((public.is_access_admin() AND public.is_workspace_member(workspace_id)));

CREATE POLICY competitor_brands_member ON public.competitor_brands AS PERMISSIVE FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.workspace_members m
  WHERE ((m.workspace_id = competitor_brands.workspace_id) AND (m.user_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.workspace_members m
  WHERE ((m.workspace_id = competitor_brands.workspace_id) AND (m.user_id = auth.uid())))));

CREATE POLICY competitor_snapshots_read ON public.competitor_snapshots AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY content_plans_rw ON public.content_plans AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY creative_sessions_rw ON public.creative_sessions AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY creative_versions_rw ON public.creative_versions AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY deal_outcomes_member ON public.deal_outcomes AS PERMISSIVE FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.workspace_members m
  WHERE ((m.workspace_id = deal_outcomes.workspace_id) AND (m.user_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.workspace_members m
  WHERE ((m.workspace_id = deal_outcomes.workspace_id) AND (m.user_id = auth.uid())))));

CREATE POLICY email_ai_drafts_mark ON public.email_ai_drafts AS PERMISSIVE FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY email_ai_drafts_read ON public.email_ai_drafts AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY email_campaigns_member ON public.email_campaigns AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY email_contacts_member ON public.email_contacts AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY email_events_read ON public.email_events AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY email_group_exclusions_member ON public.email_group_exclusions AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY email_group_members_member ON public.email_group_members AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY email_groups_member ON public.email_groups AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY email_mailboxes_read ON public.email_mailboxes AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY email_sends_read ON public.email_sends AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY email_settings_member ON public.email_settings AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY generated_posts_rw ON public.generated_posts AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY idea_events_insert ON public.idea_events AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY idea_events_read ON public.idea_events AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY instagram_generated_posts_anon_legacy_only ON public.instagram_generated_posts AS PERMISSIVE FOR ALL TO anon
  USING ((workspace_id = '00000000-0000-0000-0000-000000000001'::uuid))
  WITH CHECK ((workspace_id = '00000000-0000-0000-0000-000000000001'::uuid));

CREATE POLICY instagram_generated_posts_members_only ON public.instagram_generated_posts AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY instagram_manual_posts_anon_legacy_only ON public.instagram_manual_posts AS PERMISSIVE FOR ALL TO anon
  USING ((workspace_id = '00000000-0000-0000-0000-000000000001'::uuid))
  WITH CHECK ((workspace_id = '00000000-0000-0000-0000-000000000001'::uuid));

CREATE POLICY instagram_manual_posts_members_only ON public.instagram_manual_posts AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY instagram_reels_anon_legacy_only ON public.instagram_reels AS PERMISSIVE FOR ALL TO anon
  USING ((workspace_id = '00000000-0000-0000-0000-000000000001'::uuid))
  WITH CHECK ((workspace_id = '00000000-0000-0000-0000-000000000001'::uuid));

CREATE POLICY instagram_reels_members_only ON public.instagram_reels AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY instagram_schedule_anon_legacy_only ON public.instagram_schedule AS PERMISSIVE FOR ALL TO anon
  USING ((workspace_id = '00000000-0000-0000-0000-000000000001'::uuid))
  WITH CHECK ((workspace_id = '00000000-0000-0000-0000-000000000001'::uuid));

CREATE POLICY instagram_schedule_members_only ON public.instagram_schedule AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY lead_agent_settings_admin_read ON public.lead_agent_settings AS PERMISSIVE FOR SELECT TO authenticated
  USING ((public.is_access_admin() AND public.is_workspace_member(workspace_id)));

CREATE POLICY lead_cards_admin_read ON public.lead_cards AS PERMISSIVE FOR SELECT TO authenticated
  USING ((public.is_access_admin() AND public.is_workspace_member(workspace_id)));

CREATE POLICY lead_cards_sales_read ON public.lead_cards AS PERMISSIVE FOR SELECT TO authenticated
  USING ((public.is_sales_member(workspace_id) AND (EXISTS ( SELECT 1
   FROM public.leads l
  WHERE (l.id = lead_cards.lead_id)))));

CREATE POLICY lead_mailboxes_admin_read ON public.lead_mailboxes AS PERMISSIVE FOR SELECT TO authenticated
  USING ((public.is_access_admin() AND public.is_workspace_member(workspace_id)));

CREATE POLICY lead_mailboxes_sales_read ON public.lead_mailboxes AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_sales_member(workspace_id));

CREATE POLICY lead_reads_mark ON public.lead_reads AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.leads l
  WHERE ((l.id = lead_reads.lead_id) AND (l.workspace_id = lead_reads.workspace_id))))));

CREATE POLICY lead_reads_own ON public.lead_reads AS PERMISSIVE FOR SELECT TO authenticated
  USING ((user_id = auth.uid()));

CREATE POLICY lead_reads_unmark ON public.lead_reads AS PERMISSIVE FOR DELETE TO authenticated
  USING ((user_id = auth.uid()));

CREATE POLICY leads_admin_read ON public.leads AS PERMISSIVE FOR SELECT TO authenticated
  USING ((public.is_access_admin() AND public.is_workspace_member(workspace_id)));

CREATE POLICY leads_sales_read ON public.leads AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.can_see_lead(workspace_id, assigned_to, source));

CREATE POLICY media_library_members_only ON public.media_library AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY notifications_mark_read ON public.notifications AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

CREATE POLICY notifications_own ON public.notifications AS PERMISSIVE FOR SELECT TO authenticated
  USING ((user_id = auth.uid()));

CREATE POLICY plan_ideas_rw ON public.plan_ideas AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY post_analytics_rw ON public.post_analytics AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY request_events_insert ON public.request_events AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((actor = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.requests r
  WHERE (r.id = request_events.request_id)))));

CREATE POLICY request_events_read ON public.request_events AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.requests r
  WHERE (r.id = request_events.request_id))));

CREATE POLICY request_people_admin ON public.request_people AS PERMISSIVE FOR ALL TO authenticated
  USING ((public.is_access_admin() AND public.is_workspace_member(workspace_id)))
  WITH CHECK ((public.is_access_admin() AND public.is_workspace_member(workspace_id)));

CREATE POLICY request_people_read ON public.request_people AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY requests_insert ON public.requests AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((public.is_workspace_member(workspace_id) AND (created_by = auth.uid())));

CREATE POLICY requests_read ON public.requests AS PERMISSIVE FOR SELECT TO authenticated
  USING ((public.is_workspace_member(workspace_id) AND (public.is_access_admin() OR (created_by = auth.uid()) OR (assigned_to = auth.uid()))));

CREATE POLICY requests_update ON public.requests AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((public.is_workspace_member(workspace_id) AND (public.is_access_admin() OR (created_by = auth.uid()) OR (assigned_to = auth.uid()))))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY research_agenda_rw ON public.research_agenda AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY research_agenda_sales_read ON public.research_agenda AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_sales_member(workspace_id));

CREATE POLICY research_chats_rw ON public.research_chats AS PERMISSIVE FOR ALL TO authenticated
  USING ((public.is_workspace_member(workspace_id) AND public.chat_visible(user_id)))
  WITH CHECK ((public.is_workspace_member(workspace_id) AND public.chat_visible(user_id)));

CREATE POLICY research_events_member ON public.research_events AS PERMISSIVE FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.workspace_members m
  WHERE ((m.workspace_id = research_events.workspace_id) AND (m.user_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.workspace_members m
  WHERE ((m.workspace_id = research_events.workspace_id) AND (m.user_id = auth.uid())))));

CREATE POLICY research_events_sales_read ON public.research_events AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_sales_member(workspace_id));

CREATE POLICY research_findings_read ON public.research_findings AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY research_lens_results_member ON public.research_lens_results AS PERMISSIVE FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.workspace_members m
  WHERE ((m.workspace_id = research_lens_results.workspace_id) AND (m.user_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.workspace_members m
  WHERE ((m.workspace_id = research_lens_results.workspace_id) AND (m.user_id = auth.uid())))));

CREATE POLICY research_lens_results_sales_read ON public.research_lens_results AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_sales_member(workspace_id));

CREATE POLICY research_messages_rw ON public.research_messages AS PERMISSIVE FOR ALL TO authenticated
  USING ((public.is_workspace_member(workspace_id) AND (EXISTS ( SELECT 1
   FROM public.research_chats c
  WHERE (c.id = research_messages.chat_id)))))
  WITH CHECK ((public.is_workspace_member(workspace_id) AND (EXISTS ( SELECT 1
   FROM public.research_chats c
  WHERE (c.id = research_messages.chat_id)))));

CREATE POLICY research_opportunities_member ON public.research_opportunities AS PERMISSIVE FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.workspace_members m
  WHERE ((m.workspace_id = research_opportunities.workspace_id) AND (m.user_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.workspace_members m
  WHERE ((m.workspace_id = research_opportunities.workspace_id) AND (m.user_id = auth.uid())))));

CREATE POLICY research_opportunities_sales_read ON public.research_opportunities AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_sales_member(workspace_id));

CREATE POLICY research_runs_rw ON public.research_runs AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY research_runs_sales_read ON public.research_runs AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_sales_member(workspace_id));

CREATE POLICY research_signals_member ON public.research_signals AS PERMISSIVE FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.workspace_members m
  WHERE ((m.workspace_id = research_signals.workspace_id) AND (m.user_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.workspace_members m
  WHERE ((m.workspace_id = research_signals.workspace_id) AND (m.user_id = auth.uid())))));

CREATE POLICY research_source_checks_member_read ON public.research_source_checks AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY research_source_checks_sales_read ON public.research_source_checks AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_sales_member(workspace_id));

CREATE POLICY sales_accounts_admin ON public.sales_accounts AS PERMISSIVE FOR ALL TO authenticated
  USING ((public.is_access_admin() AND public.is_workspace_member(workspace_id)))
  WITH CHECK ((public.is_access_admin() AND public.is_workspace_member(workspace_id)));

CREATE POLICY sales_icp_admin ON public.sales_icp AS PERMISSIVE FOR ALL TO authenticated
  USING ((public.is_access_admin() AND public.is_workspace_member(workspace_id)))
  WITH CHECK ((public.is_access_admin() AND public.is_workspace_member(workspace_id)));

CREATE POLICY sales_seats_read ON public.sales_seats AS PERMISSIVE FOR SELECT TO authenticated
  USING (((user_id = auth.uid()) OR public.is_access_admin()));

CREATE POLICY social_accounts_rw ON public.social_accounts AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "members manage their connections" ON public.social_connections AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "members read their subscription" ON public.subscriptions AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY user_access_select_self ON public.user_access AS PERMISSIVE FOR SELECT TO public
  USING (((user_id = auth.uid()) OR public.is_access_admin()));

CREATE POLICY "members can read workspace roster" ON public.workspace_members AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY workspace_members_select_access_admin ON public.workspace_members AS PERMISSIVE FOR SELECT TO public
  USING (public.is_access_admin());

CREATE POLICY workspace_webhooks_rw ON public.workspace_webhooks AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "members can read their workspace" ON public.workspaces AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_workspace_member(id));

CREATE POLICY workspaces_delete_member ON public.workspaces AS PERMISSIVE FOR DELETE TO public
  USING (public.is_workspace_member(id));

CREATE POLICY workspaces_insert_approved ON public.workspaces AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (public.has_app_access());

CREATE POLICY workspaces_select_access_admin ON public.workspaces AS PERMISSIVE FOR SELECT TO public
  USING (public.is_access_admin());

CREATE POLICY workspaces_update_member ON public.workspaces AS PERMISSIVE FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM public.workspace_members m
  WHERE ((m.workspace_id = workspaces.id) AND (m.user_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.workspace_members m
  WHERE ((m.workspace_id = workspaces.id) AND (m.user_id = auth.uid())))));

CREATE POLICY "Allow upload from service" ON storage.objects AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((bucket_id = 'instagram-posts'::text));

CREATE POLICY "Allow upload to instagram-reels" ON storage.objects AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((bucket_id = 'instagram-reels'::text));

CREATE POLICY "Allow upsert from service" ON storage.objects AS PERMISSIVE FOR UPDATE TO public
  USING ((bucket_id = 'instagram-posts'::text));

CREATE POLICY "Allow upsert on instagram-reels" ON storage.objects AS PERMISSIVE FOR UPDATE TO public
  USING ((bucket_id = 'instagram-reels'::text));

CREATE POLICY "Public read access" ON storage.objects AS PERMISSIVE FOR SELECT TO public
  USING ((bucket_id = 'instagram-posts'::text));

CREATE POLICY "Public read instagram-reels" ON storage.objects AS PERMISSIVE FOR SELECT TO public
  USING ((bucket_id = 'instagram-reels'::text));

CREATE POLICY "anon can delete schedule images" ON storage.objects AS PERMISSIVE FOR DELETE TO anon
  USING ((bucket_id = 'schedule-uploads'::text));

CREATE POLICY "anon can read linkedin posts" ON storage.objects AS PERMISSIVE FOR SELECT TO anon
  USING ((bucket_id = 'linkedin-posts'::text));

CREATE POLICY "anon can read schedule images" ON storage.objects AS PERMISSIVE FOR SELECT TO anon
  USING ((bucket_id = 'schedule-uploads'::text));

CREATE POLICY "anon can upload linkedin posts" ON storage.objects AS PERMISSIVE FOR INSERT TO anon
  WITH CHECK ((bucket_id = 'linkedin-posts'::text));

CREATE POLICY "anon can upload schedule images" ON storage.objects AS PERMISSIVE FOR INSERT TO anon
  WITH CHECK ((bucket_id = 'schedule-uploads'::text));

CREATE POLICY "brand-assets delete" ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING ((bucket_id = 'brand-assets'::text));

CREATE POLICY "brand-assets insert" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((bucket_id = 'brand-assets'::text));

CREATE POLICY "brand-assets read" ON storage.objects AS PERMISSIVE FOR SELECT TO public
  USING ((bucket_id = 'brand-assets'::text));

CREATE POLICY "brand-assets update" ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((bucket_id = 'brand-assets'::text));

CREATE POLICY "creative-studio delete" ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING ((bucket_id = 'creative-studio'::text));

CREATE POLICY "creative-studio insert" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((bucket_id = 'creative-studio'::text));

CREATE POLICY "creative-studio read" ON storage.objects AS PERMISSIVE FOR SELECT TO public
  USING ((bucket_id = 'creative-studio'::text));

CREATE POLICY "creative-studio update" ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((bucket_id = 'creative-studio'::text));

CREATE POLICY "media-library delete" ON storage.objects AS PERMISSIVE FOR DELETE TO public
  USING ((bucket_id = 'media-library'::text));

CREATE POLICY "media-library insert" ON storage.objects AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((bucket_id = 'media-library'::text));

CREATE POLICY "media-library read" ON storage.objects AS PERMISSIVE FOR SELECT TO public
  USING ((bucket_id = 'media-library'::text));

CREATE POLICY "media-library update" ON storage.objects AS PERMISSIVE FOR UPDATE TO public
  USING ((bucket_id = 'media-library'::text));

CREATE POLICY "schedule-uploads delete" ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING ((bucket_id = 'schedule-uploads'::text));

CREATE POLICY "schedule-uploads insert" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((bucket_id = 'schedule-uploads'::text));

CREATE POLICY "schedule-uploads read" ON storage.objects AS PERMISSIVE FOR SELECT TO public
  USING ((bucket_id = 'schedule-uploads'::text));

CREATE POLICY "schedule-uploads update" ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((bucket_id = 'schedule-uploads'::text));


-- ═══ Grants on tables and views (exactly production's ACLs) ════════════════════

REVOKE ALL ON TABLE public.access_invites FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.access_invites TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.access_invites TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.access_invites TO service_role;
REVOKE ALL ON TABLE public.account_analytics FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.account_analytics TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.account_analytics TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.account_analytics TO service_role;
REVOKE ALL ON TABLE public.agent_cap_log FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.agent_cap_log TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.agent_cap_log TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.agent_cap_log TO service_role;
REVOKE ALL ON TABLE public.agent_digest FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.agent_digest TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.agent_digest TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.agent_digest TO service_role;
REVOKE ALL ON TABLE public.agent_edit_log FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.agent_edit_log TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.agent_edit_log TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.agent_edit_log TO service_role;
REVOKE ALL ON TABLE public.agent_notes FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.agent_notes TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.agent_notes TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.agent_notes TO service_role;
REVOKE ALL ON TABLE public.agent_usage FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.agent_usage TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.agent_usage TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.agent_usage TO service_role;
REVOKE ALL ON TABLE public.app_config FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.app_config TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.app_config TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.app_config TO service_role;
REVOKE ALL ON TABLE public.brand_assets FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_assets TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_assets TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_assets TO service_role;
REVOKE ALL ON TABLE public.brand_competitors FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_competitors TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_competitors TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_competitors TO service_role;
REVOKE ALL ON TABLE public.brand_directory_columns FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_directory_columns TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_directory_columns TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_directory_columns TO service_role;
REVOKE ALL ON TABLE public.brand_directory_rows FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_directory_rows TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_directory_rows TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_directory_rows TO service_role;
REVOKE ALL ON TABLE public.brand_edit_feedback FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_edit_feedback TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_edit_feedback TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_edit_feedback TO service_role;
REVOKE ALL ON TABLE public.brand_fields FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_fields TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_fields TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_fields TO service_role;
REVOKE ALL ON TABLE public.brand_memory FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_memory TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_memory TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_memory TO service_role;
REVOKE ALL ON TABLE public.brand_message_templates FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_message_templates TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_message_templates TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_message_templates TO service_role;
REVOKE ALL ON TABLE public.brand_products FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_products TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_products TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_products TO service_role;
REVOKE ALL ON TABLE public.brand_profile FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_profile TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_profile TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_profile TO service_role;
REVOKE ALL ON TABLE public.brand_sections FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_sections TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_sections TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_sections TO service_role;
REVOKE ALL ON TABLE public.brand_suppliers FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_suppliers TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_suppliers TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.brand_suppliers TO service_role;
REVOKE ALL ON TABLE public.ceo_briefs FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ceo_briefs TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ceo_briefs TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ceo_briefs TO service_role;
REVOKE ALL ON TABLE public.competitor_brands FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.competitor_brands TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.competitor_brands TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.competitor_brands TO service_role;
REVOKE ALL ON TABLE public.competitor_snapshots FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.competitor_snapshots TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.competitor_snapshots TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.competitor_snapshots TO service_role;
REVOKE ALL ON TABLE public.content_plans FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.content_plans TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.content_plans TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.content_plans TO service_role;
REVOKE ALL ON TABLE public.creative_sessions FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.creative_sessions TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.creative_sessions TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.creative_sessions TO service_role;
REVOKE ALL ON TABLE public.creative_versions FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.creative_versions TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.creative_versions TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.creative_versions TO service_role;
REVOKE ALL ON TABLE public.deal_outcomes FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.deal_outcomes TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.deal_outcomes TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.deal_outcomes TO service_role;
REVOKE ALL ON TABLE public.email_ai_drafts FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_ai_drafts TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_ai_drafts TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_ai_drafts TO service_role;
REVOKE ALL ON TABLE public.email_campaign_stats FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_campaign_stats TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_campaign_stats TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_campaign_stats TO service_role;
REVOKE ALL ON TABLE public.email_campaigns FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_campaigns TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_campaigns TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_campaigns TO service_role;
REVOKE ALL ON TABLE public.email_contacts FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_contacts TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_contacts TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_contacts TO service_role;
REVOKE ALL ON TABLE public.email_events FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_events TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_events TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_events TO service_role;
REVOKE ALL ON TABLE public.email_group_exclusions FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_group_exclusions TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_group_exclusions TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_group_exclusions TO service_role;
REVOKE ALL ON TABLE public.email_group_members FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_group_members TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_group_members TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_group_members TO service_role;
REVOKE ALL ON TABLE public.email_groups FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_groups TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_groups TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_groups TO service_role;
REVOKE ALL ON TABLE public.email_mailbox_secrets FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_mailbox_secrets TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_mailbox_secrets TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_mailbox_secrets TO service_role;
REVOKE ALL ON TABLE public.email_mailboxes FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_mailboxes TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_mailboxes TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_mailboxes TO service_role;
REVOKE ALL ON TABLE public.email_sends FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_sends TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_sends TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_sends TO service_role;
REVOKE ALL ON TABLE public.email_settings FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_settings TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_settings TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_settings TO service_role;
REVOKE ALL ON TABLE public.generated_posts FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.generated_posts TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.generated_posts TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.generated_posts TO service_role;
REVOKE ALL ON TABLE public.idea_events FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.idea_events TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.idea_events TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.idea_events TO service_role;
REVOKE ALL ON TABLE public.instagram_generated_posts FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.instagram_generated_posts TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.instagram_generated_posts TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.instagram_generated_posts TO service_role;
REVOKE ALL ON TABLE public.instagram_manual_posts FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.instagram_manual_posts TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.instagram_manual_posts TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.instagram_manual_posts TO service_role;
REVOKE ALL ON TABLE public.instagram_reels FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.instagram_reels TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.instagram_reels TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.instagram_reels TO service_role;
REVOKE ALL ON TABLE public.instagram_schedule FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.instagram_schedule TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.instagram_schedule TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.instagram_schedule TO service_role;
REVOKE ALL ON TABLE public.lead_agent_secrets FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lead_agent_secrets TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lead_agent_secrets TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lead_agent_secrets TO service_role;
REVOKE ALL ON TABLE public.lead_agent_settings FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lead_agent_settings TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lead_agent_settings TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lead_agent_settings TO service_role;
REVOKE ALL ON TABLE public.lead_cards FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lead_cards TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lead_cards TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lead_cards TO service_role;
REVOKE ALL ON TABLE public.lead_crm FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lead_crm TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lead_crm TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lead_crm TO service_role;
REVOKE ALL ON TABLE public.lead_domains FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lead_domains TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lead_domains TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lead_domains TO service_role;
REVOKE ALL ON TABLE public.lead_mailbox_secrets FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lead_mailbox_secrets TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lead_mailbox_secrets TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lead_mailbox_secrets TO service_role;
REVOKE ALL ON TABLE public.lead_mailboxes FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lead_mailboxes TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lead_mailboxes TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lead_mailboxes TO service_role;
REVOKE ALL ON TABLE public.lead_reads FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lead_reads TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lead_reads TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lead_reads TO service_role;
REVOKE ALL ON TABLE public.leads FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.leads TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.leads TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.leads TO service_role;
REVOKE ALL ON TABLE public.media_library FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.media_library TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.media_library TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.media_library TO service_role;
REVOKE ALL ON TABLE public.notifications FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.notifications TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.notifications TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.notifications TO service_role;
REVOKE ALL ON TABLE public.plan_ideas FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.plan_ideas TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.plan_ideas TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.plan_ideas TO service_role;
REVOKE ALL ON TABLE public.post_analytics FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.post_analytics TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.post_analytics TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.post_analytics TO service_role;
REVOKE ALL ON TABLE public.request_events FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.request_events TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.request_events TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.request_events TO service_role;
REVOKE ALL ON TABLE public.request_people FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.request_people TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.request_people TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.request_people TO service_role;
REVOKE ALL ON TABLE public.requests FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.requests TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.requests TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.requests TO service_role;
REVOKE ALL ON TABLE public.research_agenda FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.research_agenda TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.research_agenda TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.research_agenda TO service_role;
REVOKE ALL ON TABLE public.research_chats FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.research_chats TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.research_chats TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.research_chats TO service_role;
REVOKE ALL ON TABLE public.research_events FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.research_events TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.research_events TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.research_events TO service_role;
REVOKE ALL ON TABLE public.research_findings FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.research_findings TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.research_findings TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.research_findings TO service_role;
REVOKE ALL ON TABLE public.research_lens_results FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.research_lens_results TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.research_lens_results TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.research_lens_results TO service_role;
REVOKE ALL ON TABLE public.research_messages FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.research_messages TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.research_messages TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.research_messages TO service_role;
REVOKE ALL ON TABLE public.research_opportunities FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.research_opportunities TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.research_opportunities TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.research_opportunities TO service_role;
REVOKE ALL ON TABLE public.research_runs FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.research_runs TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.research_runs TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.research_runs TO service_role;
REVOKE ALL ON TABLE public.research_signals FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.research_signals TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.research_signals TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.research_signals TO service_role;
REVOKE ALL ON TABLE public.research_source_checks FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.research_source_checks TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.research_source_checks TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.research_source_checks TO service_role;
REVOKE ALL ON TABLE public.sales_accounts FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_accounts TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_accounts TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_accounts TO service_role;
REVOKE ALL ON TABLE public.sales_icp FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_icp TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_icp TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_icp TO service_role;
REVOKE ALL ON TABLE public.sales_seats FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_seats TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_seats TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_seats TO service_role;
REVOKE ALL ON TABLE public.scheduled_posts FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.scheduled_posts TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.scheduled_posts TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.scheduled_posts TO service_role;
REVOKE ALL ON TABLE public.social_accounts FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.social_accounts TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.social_accounts TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.social_accounts TO service_role;
REVOKE ALL ON TABLE public.social_connections FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.social_connections TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.social_connections TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.social_connections TO service_role;
REVOKE ALL ON TABLE public.subscriptions FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.subscriptions TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.subscriptions TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.subscriptions TO service_role;
REVOKE ALL ON TABLE public.user_access FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.user_access TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.user_access TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.user_access TO service_role;
REVOKE ALL ON TABLE public.workspace_members FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.workspace_members TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.workspace_members TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.workspace_members TO service_role;
REVOKE ALL ON TABLE public.workspace_webhooks FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.workspace_webhooks TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.workspace_webhooks TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.workspace_webhooks TO service_role;
REVOKE ALL ON TABLE public.workspaces FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.workspaces TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.workspaces TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.workspaces TO service_role;

-- ═══ Grants on functions (exactly production's ACLs) ════════════════════

REVOKE ALL ON FUNCTION public.agent_usage_warn() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agent_usage_warn() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_usage_warn() TO anon;
GRANT EXECUTE ON FUNCTION public.agent_usage_warn() TO authenticated;
GRANT EXECUTE ON FUNCTION public.agent_usage_warn() TO service_role;
REVOKE ALL ON FUNCTION public.approve_access(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_access(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.can_approve_leads(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_approve_leads(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_approve_leads(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.can_see_lead(uuid,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_see_lead(uuid,uuid,text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_see_lead(uuid,uuid,text) TO anon;
GRANT EXECUTE ON FUNCTION public.can_see_lead(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_see_lead(uuid,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.cancel_invite(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_invite(text) TO service_role;
REVOKE ALL ON FUNCTION public.chat_visible(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_visible(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_visible(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.chat_visible(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_visible(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.create_company(text,uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_company(text,uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_company(text,uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.email_group_members_hand_edit() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.email_group_members_hand_edit() TO service_role;
REVOKE ALL ON FUNCTION public.generated_post_is_locked(public.generated_posts) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generated_post_is_locked(public.generated_posts) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.generated_post_is_locked(public.generated_posts) TO anon;
GRANT EXECUTE ON FUNCTION public.generated_post_is_locked(public.generated_posts) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generated_post_is_locked(public.generated_posts) TO service_role;
REVOKE ALL ON FUNCTION public.generated_posts_lock_sent() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generated_posts_lock_sent() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.generated_posts_lock_sent() TO anon;
GRANT EXECUTE ON FUNCTION public.generated_posts_lock_sent() TO authenticated;
GRANT EXECUTE ON FUNCTION public.generated_posts_lock_sent() TO service_role;
REVOKE ALL ON FUNCTION public.grant_access_to_user(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.grant_access_to_user(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
REVOKE ALL ON FUNCTION public.has_app_access() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_app_access() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_app_access() TO anon;
GRANT EXECUTE ON FUNCTION public.has_app_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_app_access() TO service_role;
REVOKE ALL ON FUNCTION public.invite_access(text,uuid[],text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invite_access(text,uuid[],text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_access(text,uuid[],text) TO service_role;
REVOKE ALL ON FUNCTION public.is_access_admin() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_access_admin() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_access_admin() TO anon;
GRANT EXECUTE ON FUNCTION public.is_access_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_access_admin() TO service_role;
REVOKE ALL ON FUNCTION public.is_sales_access() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_sales_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_sales_access() TO service_role;
REVOKE ALL ON FUNCTION public.is_sales_member(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_sales_member(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_sales_member(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_sales_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_sales_member(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.is_workspace_member(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.lead_files_expired(integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lead_files_expired(integer) TO service_role;
REVOKE ALL ON FUNCTION public.lead_read_before(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lead_read_before(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.lead_read_before(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.lead_read_before(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lead_read_before(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.leads_sync_contact() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.leads_sync_contact() TO service_role;
REVOKE ALL ON FUNCTION public.my_sales_companies() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_sales_companies() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_sales_companies() TO service_role;
REVOKE ALL ON FUNCTION public.place_user_companies(uuid,uuid[],boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.place_user_companies(uuid,uuid[],boolean) TO service_role;
REVOKE ALL ON FUNCTION public.request_comment_notify() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_comment_notify() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_comment_notify() TO anon;
GRANT EXECUTE ON FUNCTION public.request_comment_notify() TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_comment_notify() TO service_role;
REVOKE ALL ON FUNCTION public.requests_notify() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.requests_notify() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.requests_notify() TO anon;
GRANT EXECUTE ON FUNCTION public.requests_notify() TO authenticated;
GRANT EXECUTE ON FUNCTION public.requests_notify() TO service_role;
REVOKE ALL ON FUNCTION public.revoke_access(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_access(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.sales_team(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sales_team(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sales_team(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.set_agent_cap(uuid,numeric) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_agent_cap(uuid,numeric) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_agent_cap(uuid,numeric) TO anon;
GRANT EXECUTE ON FUNCTION public.set_agent_cap(uuid,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_agent_cap(uuid,numeric) TO service_role;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO anon;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO service_role;
REVOKE ALL ON FUNCTION public.set_user_role(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_user_role(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_role(uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.set_user_workspaces(uuid,uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_user_workspaces(uuid,uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_workspaces(uuid,uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.sync_lead_contact(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_lead_contact(uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.sync_lead_contact_run(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_lead_contact_run(uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.sync_lead_contacts_all(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_lead_contacts_all(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.sync_workspace_roster() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_workspace_roster() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_workspace_roster() TO service_role;
REVOKE ALL ON FUNCTION public.taggable_people(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.taggable_people(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.taggable_people(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.taggable_people(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.taggable_people(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.unassign_on_seat_removed() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unassign_on_seat_removed() TO service_role;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO anon;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO service_role;
REVOKE ALL ON FUNCTION public.workspace_people(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_people(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.workspace_people(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.workspace_people(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_people(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.workspaces_guard() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspaces_guard() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.workspaces_guard() TO anon;
GRANT EXECUTE ON FUNCTION public.workspaces_guard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.workspaces_guard() TO service_role;

-- ═══ Storage buckets (settings only, no files) ════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('brand-assets', 'brand-assets', true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('creative-studio', 'creative-studio', true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('instagram-posts', 'instagram-posts', true, 10485760, '{image/webp,image/jpeg,image/png}'::text[]) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('instagram-reels', 'instagram-reels', true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('lead-files', 'lead-files', false, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('linkedin-posts', 'linkedin-posts', true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('media-library', 'media-library', true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('schedule-uploads', 'schedule-uploads', true, NULL, NULL) ON CONFLICT (id) DO NOTHING;

RESET check_function_bodies;
