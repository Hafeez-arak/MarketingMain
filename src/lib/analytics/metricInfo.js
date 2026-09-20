// ─── What every number on the Analytics page actually means ────────────────
//
// ── WHY THIS FILE EXISTS ──
//
// The Analytics page shows two strips of numbers, and until this file existed
// nothing on the page said they were measuring different things. They are:
//
//   PLATFORM strip — the platform's OWN account/page figures. Instagram's
//     account insights cover every surface (feed, reels, stories, explore and
//     the profile itself), and its "reach" is UNIQUE accounts over the whole
//     window: one person who saw four posts counts once. LinkedIn's page
//     statistics cover every post on the page, including ones published
//     straight to LinkedIn, plus follower gains and page views that exist
//     nowhere else.
//
//   POST strip — the same window, but per-post numbers ADDED UP. One person
//     who saw four posts is counted four times, because each post measured
//     them separately and nothing can de-duplicate across posts after the
//     fact.
//
// That is the whole explanation for the screenshot that started this: an
// account with 10 accounts reached and 44 views, sitting above a "total reach"
// of 16. 10 is ten distinct people; 16 is the eight posts' reach added
// together; 44 is every view of every surface. None of them contradicts the
// others, and all three are right.
//
// ── WHERE EXPLAINING STOPPED BEING ENOUGH ──
//
// Two of those numbers have since been removed rather than described, and the
// distinction is worth keeping straight when adding to this file.
//
// The summed "total reach" tile is gone: a reader will always take a figure
// called reach for the real one, and no tooltip outruns that. So is the second
// engagement rate — LinkedIn's page figure and our post figure used to sit one
// strip apart, and labelling them apart made the pair legible without making
// it usable. A page now carries exactly one rate, the platform's own wherever
// the platform publishes one (see lib/analytics/engagementSource.js).
//
// The rule this file runs on: explain a number that is genuinely useful and
// merely surprising; delete one whose only effect is to be misread. An ⓘ is
// not a licence to leave a misleading tile on the page.
//
// ── HOW TO USE IT ──
//
// Keys are namespaced by SCOPE, not just by metric, because `reach` means two
// different things depending on which strip it is in and a single `reach`
// entry would have to lie about one of them:
//
//   ig.*   Instagram account insights      (platform strip)
//   li.*   LinkedIn page statistics        (platform strip)
//   post.* per-post numbers, added up      (post strip)
//   calc.* things this app works out itself from the charts below
//
// `metricInfo(key)` is the only reader. It returns null for an unknown key so
// a missing entry renders no info dot rather than throwing on a page whose job
// is to be reassuring.

/**
 * @typedef  {object} MetricInfo
 * @property {string}  what   One sentence: what the number counts.
 * @property {string} [note]  A second sentence, for the ones that surprise
 *                            people — double counting, platform quirks, lag.
 */

/** @type {Record<string, MetricInfo>} */
const INFO = {
  // ── Instagram account insights ──────────────────────────────────────────
  'ig.reach': {
    what: 'How many separate Instagram accounts saw anything of yours in this window — posts, reels, stories, or your profile.',
    note: 'Each person counts once however much of yours they saw, so this is smaller than the posts’ reach added together.',
  },
  'ig.views': {
    what: 'Every time a piece of your content was on someone’s screen, across feed, reels, stories, explore and your profile.',
    note: 'One person can create many views. This counts appearances, not people.',
  },
  'ig.accounts_engaged': {
    what: 'How many separate accounts did something to your content — liked, commented, saved, shared or replied.',
    note: 'Also counted once per person, however many times they engaged.',
  },
  'ig.total_interactions': {
    what: 'Every like, comment, save and share your content received in this window, added together.',
  },
  'ig.profile_links_taps': {
    what: 'Taps on the website link in your Instagram bio.',
    note: 'The bio link only — not links inside captions or stories.',
  },
  'ig.reach_follow_type': {
    what: 'The same reach as above, split by whether the person already followed you when they saw it.',
    note: 'Reach is the only thing Instagram will split this way — there is no follower/non-follower breakdown of likes, comments or engagement to be had. The two sides can add up to slightly less than total reach, because a person Instagram could not classify lands in neither.',
  },

  // ── LinkedIn page statistics ────────────────────────────────────────────
  'li.impressions': {
    what: 'Every time one of your page’s posts appeared on someone’s screen.',
    note: 'LinkedIn counts impressions rather than views on ordinary posts, which is why there is no Views figure here.',
  },
  'li.unique_impressions': {
    what: 'How many separate LinkedIn members saw at least one of your page’s posts.',
    note: 'Each member counts once, so this is always lower than impressions.',
  },
  'li.clicks': {
    what: 'Clicks on your posts — links, images, videos, and the page name itself.',
  },
  'li.engagement_rate': {
    what: 'LinkedIn’s own engagement figure for the whole page: everyone who reacted, commented, shared, clicked or followed, against everyone who saw it.',
    note: 'This is LinkedIn’s number by LinkedIn’s formula, so it matches what you see on LinkedIn itself. It counts clicks and follows as engagement, which Instagram’s does not.',
  },
  'li.followers_gained': {
    what: 'Followers your page gained in this window, organic and paid together.',
    note: 'Gains only — people who unfollowed are not subtracted here.',
  },
  'li.page_views_total': {
    what: 'Visits to your company page itself, across all of its tabs.',
    note: 'The page, not the posts. Someone can see a dozen of your posts in their feed without ever visiting.',
  },
  'li.likes': { what: 'Reactions on your page’s posts — likes, celebrates, supports and the rest, added together.' },
  'li.comments': { what: 'Comments left on your page’s posts.' },
  'li.shares': { what: 'Times someone reposted one of your page’s posts to their own feed.' },

  // ── Per-post numbers, added up ──────────────────────────────────────────
  'post.engagement_rate': {
    what: 'Interactions ÷ reach across the posts in this window: likes, comments, shares and saves against the people who saw them.',
    note: 'Instagram publishes no engagement rate of its own, so this one is worked out here from each post’s numbers.',
  },
  // Still defined although the KPI tile that used it is gone: the platform
  // breakdown table's Reach column is the same summed figure and needs the
  // same warning. Deleting the entry would silently strip that column's ⓘ.
  'post.reach': {
    what: 'Each post’s reach, added together.',
    note: 'Someone who saw four of your posts counts four times here — once per post — so this runs ahead of the accounts reached above.',
  },
  'post.followers': {
    what: 'How many people follow this account right now.',
    note: 'Counted once a day, so a newly connected account shows a dash until its first overnight snapshot.',
  },
  'post.count': {
    what: 'Posts published in this window, including any made straight on the platform.',
  },
  'post.best': {
    what: 'The post with the highest engagement rate in this window.',
  },
  'post.views': {
    what: 'Each post’s views added together — the times a post was watched or seen.',
    note: 'Posts only. Stories and profile visits are not in here, which is why it is lower than the account views above.',
  },
  'post.impressions': {
    what: 'Each post’s impressions, added together.',
    note: 'Instagram stopped reporting impressions and counts views instead, so this stays at zero for Instagram accounts.',
  },
  'post.likes': { what: 'Likes and reactions across the posts in this window.' },
  'post.comments': { what: 'Comments across the posts in this window.' },
  'post.shares': { what: 'Times your posts were shared or reposted.' },
  'post.saves': { what: 'Times someone saved one of your posts to look at later.' },
  'post.clicks': {
    what: 'Clicks on your posts.',
    note: 'LinkedIn reports this per post; Instagram does not, so the column is hidden for Instagram accounts.',
  },

  // ── One post, in the Top performing posts table ─────────────────────────
  // Separate from `post.*` for the same reason `ig.*` is separate from it:
  // those say "added together", which is true of a strip summing the window
  // and false of a table row showing a single post. One shared entry would
  // have to be wrong in one of the two places it appears.
  'row.reach': {
    what: 'How many separate people saw this one post.',
  },
  'row.views': {
    what: 'How many times this post was watched or seen.',
    note: 'One person can view a post more than once, so this runs ahead of reach.',
  },
  'row.impressions': {
    what: 'How many times this post appeared on someone’s screen.',
  },
  'row.likes': { what: 'Likes and reactions on this post.' },
  'row.comments': { what: 'Comments on this post.' },
  'row.clicks': { what: 'Clicks on this post — its links, media, and your page name.' },
  'row.engagement_rate': {
    what: 'This post’s interactions ÷ its reach: everyone who liked, commented, shared or saved it, against everyone who saw it.',
    note: 'Per post, so a post shown to very few people can score high on a handful of likes.',
  },

  // ── The dashboard's cross-platform tiles ────────────────────────────────
  // Every connected account's figures added together. De-duplicated WITHIN a
  // platform (each platform counts its own people once) but not ACROSS them,
  // because nothing can tell that a LinkedIn member and an Instagram account
  // are the same human being.
  'home.followers': {
    what: 'Followers across every connected account, added together.',
    note: 'Someone who follows you on two platforms counts twice — no platform can see the other’s audience.',
  },
  'home.reach': {
    what: 'People reached across every connected account, from each platform’s own account-wide figure.',
    note: 'Each platform counts its own people once. Someone following you on two platforms still counts twice here.',
  },
  'home.post_views': {
    what: 'Views of your posts, added up across the platforms that count views.',
    note: 'LinkedIn takes no view count on an ordinary post, so a LinkedIn-only selection shows a dash rather than a zero.',
  },
  'home.account_views': {
    what: 'Visits to your profiles and pages themselves — Instagram’s account-wide views and LinkedIn’s page views.',
    note: 'Never added to post views: Instagram already counts a post view inside its account figure, so adding them would count it twice.',
  },
  'home.engagement_rate': {
    what: 'Interactions ÷ reach across every connected account’s posts in this window.',
    note: 'Worked out here. A platform’s own engagement figure uses its own formula and will read differently.',
  },
  'home.posts': {
    what: 'Posts published across every connected account in this window.',
  },

  // ── Worked out here from the charts ─────────────────────────────────────
  'calc.best_time': {
    what: 'When your posts have historically earned the most engagement, by day and hour.',
    note: 'Built from your whole posting history, not just this window, so it needs a few weeks of posts before it says much.',
  },
  'calc.follower_history': {
    what: 'Your follower count as it was recorded each day.',
    note: 'One snapshot a day, so today’s post cannot show up here until tomorrow.',
  },
  'calc.frequency': {
    what: 'Your average engagement rate at each posting cadence — what happened in weeks you posted twice versus five times.',
    note: 'It describes what already happened. A pattern to check, not a target to hit.',
  },
  'calc.decay': {
    what: 'How quickly a post collects its engagement: the share of its final total it had reached by each point after publishing.',
    note: 'Useful for knowing how long to wait before judging a new post.',
  },
  'calc.posts_over_time': {
    what: 'How many posts went out each week in this window.',
  },
  'calc.platform_breakdown': {
    what: 'Each platform’s posts and their numbers added up, side by side.',
    note: 'Every column here is a per-post total, so reach double-counts anyone who saw more than one post.',
  },

  // ── The website: Google Search Console ──────────────────────────────────
  // `site.*` because these are the property's numbers, the way `ig.*` are the
  // account's. They measure what happens in Google's results — not on the
  // website itself, which is what `web.*` below is for.
  'site.impressions': {
    what: 'Every time a page of yours appeared in Google’s web results for somebody’s search.',
    note: 'Appearing is not being seen: a result at position 24 is on page three, and it still counts here.',
  },
  'site.clicks': {
    what: 'Times somebody chose your result and came to the site.',
    note: 'Google’s count of the click, not your site’s count of the visit. It will never match a sessions figure exactly.',
  },
  'site.ctr': {
    what: 'The share of your appearances that turned into a click.',
    note: 'It falls when you start ranking for more searches, which is a good thing happening — more appearances at low positions dilute the rate before they earn clicks.',
  },
  'site.position': {
    what: 'Where you ranked on average, weighted by how often each result appeared.',
    note: 'One number for a site that ranks 2nd for its own name and 24th for what it sells describes neither. The band chart below splits it.',
  },
  'site.non_brand': {
    what: 'Impressions from people who did not type your company’s name.',
    note: 'The demand you earned rather than the demand you already had. On a small site, brand searches flatter every other number on this page.',
  },
  'site.surfaces': {
    what: 'The same site measured separately on each of Google’s surfaces — web, images, video, news and Discover.',
    note: 'Image impressions are real visibility but they are not web rankings, so they are never folded into the totals above.',
  },
  'site.coverage': {
    what: 'How much of your visibility the query table below can actually account for.',
    note: 'Google withholds queries too few people searched, to protect the searcher. Those impressions count in the totals but belong to no query it will name.',
  },
  'site.bands': {
    what: 'Your impressions split by where they ranked, rather than averaged into one number.',
    note: 'Positions 11 and beyond are page two or worse. A title rewrite can win a click back on page one; past that, nobody is seeing the result to click it.',
  },
  'site.sitemap': {
    what: 'The sitemap Google holds for this property, and when it last came back to read it.',
    note: 'Measured from the last download, not the last submission: submitting is something you did once, downloading is Google choosing to return.',
  },

  // ── The website: GA4 ────────────────────────────────────────────────────
  // `web.*` — what happens AFTER the click, which Search Console cannot see.
  'web.sessions': {
    what: 'Visits to the site, as counted by the GA4 tag on the page.',
    note: 'Never equal to Search Console clicks: ad blockers, refused consent, bots and people leaving before the tag fires all sit in the gap.',
  },
  'web.users': {
    what: 'How many separate people visited, however many times each came back.',
  },
  'web.new_users': {
    what: 'Visitors GA4 had not seen before in this window.',
  },
  'web.page_views': {
    what: 'Pages opened, added up across every visit.',
  },
  'web.engagement_rate': {
    what: 'The share of visits that lasted over ten seconds, saw more than one page, or triggered a key event.',
    note: 'GA4’s replacement for the old bounce rate, pointed the useful way round: higher is better.',
  },
  'web.bounce_rate': {
    what: 'The share of visits that did none of those things — GA4’s bounce rate is simply the engagement rate subtracted from 100.',
  },
  'web.avg_session': {
    what: 'How long an average visit lasted.',
  },
  'web.channels': {
    what: 'Where visits came from, grouped the way GA4 groups them — organic search, direct, referral, social, paid and the rest.',
  },
  'web.key_events': {
    what: 'Actions you marked as mattering in GA4 — a form sent, a number called, a catalogue downloaded.',
    note: 'A property with none configured reports none. That is a setup step nobody has taken, not a month with no results.',
  },
}

/**
 * The explanation for one metric, or null when there isn't one.
 *
 * Null rather than a thrown error or a placeholder string: an info dot with
 * nothing to say should not render at all, and a page whose job is to be
 * reassuring is the wrong place to surface a developer's typo to the user.
 *
 * @param {string} key A namespaced key from INFO, e.g. `post.reach`.
 * @returns {MetricInfo|null}
 */
export function metricInfo(key) {
  return INFO[key] || null
}

/** Every key this dictionary defines. Used by the test that keeps call sites honest. */
export const METRIC_INFO_KEYS = Object.keys(INFO)
