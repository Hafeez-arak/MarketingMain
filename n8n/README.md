# n8n workflow generator

`gen_workflows.py` programmatically builds the n8n JSON for ARAK's 4 "v2" content-generation workflows (Instagram, LinkedIn, Caption Studio, Elongate Idea). It replaces an earlier script of the same name that lived in a throwaway scratchpad directory and was permanently lost — only its JSON output survived, which is what this script was reverse-built from. Keeping the generator in the repo means this can't happen again.

To regenerate the JSON after editing this script, run:

```
python3 gen_workflows.py
```

This writes the 4 files into `workflows/`. After any change to the Python source, re-run the script and re-import the changed workflow JSON file(s) into n8n — never hand-edit the generated JSON directly, since it will just be overwritten (and drift from the source of truth) the next time someone runs the generator.

All workflows are zero-secret: credentials (`ANTHROPIC_API_KEY`, `REPLICATE_API_TOKEN`, `SUPABASE_URL`, `SUPABASE_KEY`, optional `IMAGE_PROVIDER`/`FAL_KEY`) are read from n8n environment variables at runtime, never hardcoded here.

Instagram publishing and analytics run on Meta's official Graph API and need `META_IG_TOKEN` + `META_IG_USER_ID` (see `docker/.env.example`, which spells out the token-expiry trap). The three `Zernio *` workflows still generate and deploy but nothing in the app calls them — they are a fallback kept until the Meta path has proven itself in production.

The workflow Code nodes are covered by `metaWorkflows.test.js`, which runs the **generated JSON** — not a copy of the source — through `workflowHarness.js` with Instagram and Supabase stubbed. If you change a Code node, regenerate first (`python3 gen_workflows.py`) or the tests will still be checking the old one.
