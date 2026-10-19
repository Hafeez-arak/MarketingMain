-- Local only. 20261025_ceo_control.sql inserts a company_targets row for
-- production's Arak company, whose id is the well-known
-- 00000000-0000-0000-0000-000000000001 (the same id the tests use). The local
-- database starts with no companies, so that insert fails its foreign key.
-- Create a placeholder company with that id first. It holds no production
-- data: the id and the name are both already in the repo's source.
insert into public.workspaces (id, name, slug)
values ('00000000-0000-0000-0000-000000000001', 'Arak', 'arak')
on conflict (id) do nothing;
