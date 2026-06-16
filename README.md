# Campai — Marketing Platform

## Setup

```bash
npm install
npm run dev
```

Open **http://localhost:5173**

## What works

All state is managed in-memory with React Context + useReducer. Every action persists within the session.

| Route | Feature |
|-------|---------|
| `/` | Dashboard — live counts, recent posts, campaign list, quick actions |
| `/campaigns` | Create, filter, delete campaigns |
| `/campaigns/new` | Full campaign form — name, goal, platforms, dates, status |
| `/schedule` | View all posts in a filterable table |
| `/email` | Email flows with step builder (add/remove email/delay/condition steps) |
| `/email/new` | Create new email flow with trigger + steps |
| `/analytics` | Real counts from actual data, platform breakdown, connect prompt |
| `/media` | Upload real files (drag & drop or browse), grid/list view, delete |
| `/social` | Overview of all platforms with connect/disconnect toggle |
| `/social/:platform` | Per-platform post list with stats |
| `/social/:platform/new` | Full post composer — copy, hashtags, media upload, campaign attach, schedule |
| `/approvals` | Approve / reject queue — fed by post creation |
| `/settings` | Workspace name, notifications |
| `/integrations` | Connect social accounts + third-party API keys |
| `/team` | Invite members with name, email, role |

## Data flow

1. Create a campaign → visible on Dashboard + Campaigns
2. Go to Social → connect an account → create a post → it appears in Schedule + Approvals
3. Approve post in Approvals → notification fires
4. Upload files in Media → stored in session
5. All counts on Dashboard update in real time

## Next: connect Supabase

Replace the in-memory store in `src/store/appStore.jsx` with Supabase calls.
See `src/lib/utils.js` for shared constants and helpers.
