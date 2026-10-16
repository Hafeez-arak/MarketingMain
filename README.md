# Campai — Marketing Platform

The marketing app for ARAK Lighting and its sister brands: Brand Brain,
research, content planning, Creative Studio, publishing, analytics, email and
leads. What each page does is in [docs/team-guide](docs/team-guide/00-start-here.md).

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
npm test         # vitest
npm run lint
```

The browser needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env`
(see [docs/DEPLOY-SETUP.md](docs/DEPLOY-SETUP.md)).

## Where things live

| Path | What it is |
|------|------------|
| `src/` | The React app (Vite) |
| `api/` | Vercel functions: agent, email, leads, Zernio, the n8n proxy |
| `server/` | The `agent` container that runs research beside n8n |
| `n8n/` | Workflow generator (`gen_workflows.py`), its tests, and the box's Docker setup |
| `supabase/migrations/` | Database history — applied by hand, never deleted |
| `dev/` | Offline preview pages (`/dev/loading.html` etc.) that mount real pages on fake data, no sign-in; `npm run dev` only, never built |
| `docs/` | Setup guides (`*-SETUP.md`), plans, and the team guide |
