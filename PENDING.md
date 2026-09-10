# Pending — parked decisions

Things named as problems but deliberately not scheduled yet. Parked, not
dropped: each one is here so it stays visible while the agent and the
four-platform publishing work go first.

## Simplification pass (raised 2026-09-09, deferred)

- **Campaign Planner** (`src/pages/campaigns/CampaignPlanner.jsx`, 2,313 lines).
  Called out directly as not good. Three routes serve one job — `/campaigns`,
  `/campaigns/plans`, `/campaigns/plan` — plus a fourth for the post editor.
- **Insights + Analytics merge.** Two screens already report performance and
  the research agent is about to be a third. Insights' two run buttons are
  slated to collapse into one link at the agent's page regardless.
- **Email flows** (`src/pages/email/index.jsx`, 80 lines). A route with nothing
  behind it. Delete, or build — currently neither.
- **Studio and Brand Brain** (2,279 and 1,789 lines). The other two giants.
  Not known to be broken; listed for size, not for fault.

## Carried over from earlier work

- **Meta token expires 2026-10-18.** Even with Zernio publishing all four
  platforms, the research agent reads competitors through Meta's
  `business_discovery`, so the token stays load-bearing. Needs a Business
  Manager System User token, and the real Arak account connected in place of
  the test account `@lightingaaa`.
- **Two unmerged branches**, one commit each: `access-invites`,
  `webhook-guard-response-docs`.
