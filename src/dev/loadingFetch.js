// ─── Dev-only: freeze or break the network for the loading harness ─────────
// Imported FIRST by loadingHarness.jsx: supabase-js captures window.fetch
// when its client is created, so the replacement must already be in place.
//
//   ?mode=hang   every data request waits forever: what a page shows while
//                it loads (it must be skeletons, never a 0 or an empty claim)
//   ?mode=fail   every data request fails: the loader must give way to an
//                error or empty state, never spin forever
//
// Vite's own module requests (/src, /node_modules, /@…) still load.

const mode = new URLSearchParams(window.location.search).get('mode') || 'hang'
const realFetch = window.fetch.bind(window)
const own = url => /^\/(src|node_modules|@)/.test(url) || url.startsWith(window.location.origin + '/src') || url.startsWith(window.location.origin + '/@') || url.startsWith(window.location.origin + '/node_modules')

window.__loadingRequests = []
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input?.url || String(input)
  if (own(url)) return realFetch(input, init)
  window.__loadingRequests.push(url.replace(/\?.*$/, ''))
  if (mode === 'fail') return Promise.reject(new TypeError('Failed to fetch (loading harness)'))
  return new Promise(() => {})
}
