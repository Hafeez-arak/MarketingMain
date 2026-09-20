import { useState } from 'react'
import ReactDOM from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../store/auth'
import { AppContext } from '../store/app'
import { Analytics } from '../pages/analytics/index'
import fixture from './websiteFixture.json'
import '../index.css'

// ─── Dev-only harness for the Analytics PAGE, not one of its tabs ──────────
//
// The Website tab has its own harness (/dev-website.html) that renders it
// against a recorded payload. This one exists for the ten lines that harness
// cannot reach: the channel picker.
//
// ── WHY THOSE TEN LINES NEEDED LOOKING AT ──
//
// "Website" is in the same dropdown as Instagram and LinkedIn but it is not a
// connected account, and the page's structure assumed for its whole life that
// every entry in that picker was one. Three things had to change together, and
// each of them is wrong in a way no unit test would catch:
//
//   · the picker had to move ABOVE the "no connected accounts" branch, or with
//     nothing connected the only way to reach the Website tab would be hidden
//     inside the empty state telling you to connect something;
//   · the default had to stay a social platform wherever there is one, so
//     opening /analytics lands where it always has;
//   · the Zernio refresh and the connected-accounts list had to disappear on
//     the Website tab, because Zernio has never heard of the website.
//
// Served by Vite at /dev-analytics-page.html. Vite only builds index.html, so
// this never reaches a production bundle.

const ACCOUNTS = [
  {
    platform: 'instagram', zernio_account_id: 'ig-1', username: 'araklighting',
    display_name: 'ARAK Lighting', is_active: true, account_type: null, followers_count: 412,
  },
  {
    platform: 'linkedin', zernio_account_id: 'li-1', username: 'arak-lighting',
    display_name: 'ARAK Lighting', is_active: true, account_type: 'organization', followers_count: 4800,
  },
]

const SCENARIOS = [
  { key: 'both', label: 'Instagram + LinkedIn + Website', accounts: ACCOUNTS },
  { key: 'one', label: 'Instagram only + Website', accounts: [ACCOUNTS[0]] },
  // The case the picker had to be moved for: with nothing connected, the
  // Website tab is the only thing on this page with anything to say.
  { key: 'none', label: 'Nothing connected + Website', accounts: [] },
]

// Answers the two calls this page makes and nothing else. Anything unmatched
// gets an empty 200 rather than a network error, so a stray request cannot
// look like a broken page.
function installFetch(accounts) {
  window.fetch = async (url, init) => {
    const href = String(url)
    const json = body => new Response(JSON.stringify(body), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
    if (href.includes('/api/agent/website')) return json(fixture)
    if (href.includes('/social_accounts')) return json(accounts)
    if (href.includes('/api/zernio/')) {
      const action = href.split('/api/zernio/')[1]?.split('?')[0]
      if (action === 'accounts') return json({ accounts })
      return json({ ok: true, accounts, synced: [] })
    }
    void init
    return json({})
  }
}

export function AnalyticsPageHarness() {
  const [scenario, setScenario] = useState('both')
  const chosen = SCENARIOS.find(s => s.key === scenario)
  installFetch(chosen.accounts)

  const auth = {
    // A distinct workspace id per scenario: the accounts store caches per
    // workspace and answers from memory first, so a shared id would serve the
    // previous scenario's list into the next one.
    activeWorkspaceId: `00000000-0000-0000-0000-00000000000${SCENARIOS.indexOf(chosen) + 1}`,
    accessToken: 'harness-token',
    user: { id: 'dev', email: 'dev@example.com' },
    session: { access_token: 'harness-token' },
    workspaces: [],
    loading: false,
  }

  return (
    <AuthContext.Provider value={auth}>
      <AppContext.Provider value={{ state: { webhooks: {} }, dispatch: () => {} }}>
        <MemoryRouter>
          <div className="min-h-screen bg-surface-muted">
            <div className="border-b border-border bg-white px-6 py-2.5 flex items-center gap-3 flex-wrap">
              <span className="eyebrow">Analytics page harness</span>
              {SCENARIOS.map(s => (
                <button key={s.key} onClick={() => setScenario(s.key)}
                  className={`text-xs px-2.5 py-1.5 border transition-colors
                    ${scenario === s.key ? 'border-stone-400 bg-surface-subtle text-text font-semibold' : 'border-border text-text-tertiary hover:text-text'}`}>
                  {s.label}
                </button>
              ))}
            </div>
            <div className="p-6">
              {/* Keyed on the scenario so every hook remounts and refetches. */}
              <Analytics key={scenario} />
            </div>
          </div>
        </MemoryRouter>
      </AppContext.Provider>
    </AuthContext.Provider>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<AnalyticsPageHarness />)
