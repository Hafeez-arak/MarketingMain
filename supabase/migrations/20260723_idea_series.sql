-- Marks an idea as part of a deliberate recurring series (e.g. "Tip Tuesday")
-- so cross-month anti-repetition can tell "intentional repeat format, keep
-- going" apart from "already covered this angle, don't repeat it".
alter table public.plan_ideas add column if not exists series text;
