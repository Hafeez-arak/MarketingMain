-- Keep reference directories out of the prompts that draw pictures.
--
-- brand_sections.tasks has been honoured by the prompt builder since the task
-- tagging landed, but nothing in the interface could set it, so every
-- directory a person created stayed on the default — an empty array, meaning
-- "send to every kind of generation". The visible result was Competitor Watch
-- sitting inside an image prompt in Creative Studio: a table of rival
-- positioning statements handed to a model whose only job is to decide what a
-- picture looks like.
--
-- Which slice each one belongs to:
--   Competitor Watch  — market observation. It informs what to post about and
--                       what to research, never how a frame is lit.
--   Suppliers         — sourcing facts. Same reasoning.
--   Message Templates — reusable copy, so captions and ideation chat only.
--
-- Arak's Products directory is deliberately left on every task: what a fixture
-- physically looks like is exactly what an image prompt should know.
--
-- Guarded on cardinality = 0 so it only fills in sections nobody has scoped by
-- hand, and re-running it cannot overwrite a later decision.

update brand_sections set tasks = '{plan,research,chat}'
 where key in ('competitors', 'suppliers') and cardinality(tasks) = 0;

update brand_sections set tasks = '{caption,chat}'
 where key = 'message_templates' and cardinality(tasks) = 0;
