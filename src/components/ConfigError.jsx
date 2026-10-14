// ─── Configuration error screen ────────────────────────────────────────────
// Shown in place of the app when the build has no Supabase credentials (see
// CONFIG_ERROR in lib/supabaseClient.js).
//
// Deliberately plain inline styles rather than the design system: this screen
// exists precisely for builds that are too misconfigured to be trusted to
// mount anything, so it depends on nothing but React. Before it existed the
// symptom was a blank white page whose only clue was a console error.
export function ConfigError({ message }) {
  if (message) console.error(`[config] ${message}`)
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px', background: '#EEF1EF', fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div style={{
        maxWidth: 560, background: '#fff', borderRadius: 16, padding: '32px 36px',
        boxShadow: '0 1px 3px rgba(28,35,33,0.12), 0 8px 24px rgba(28,35,33,0.08)',
      }}>
        <p style={{
          margin: 0, fontSize: 12, fontWeight: 600, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: '#7D98A1',
        }}>
          Setup
        </p>
        <h1 style={{ margin: '10px 0 14px', fontSize: 20, fontWeight: 700, color: '#1C2321' }}>
          This app isn’t set up yet.
        </h1>
        {/* What to set, and where, is in docs/DEPLOY-SETUP.md; `message` names
            what is missing, for whoever reads the console. */}
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: '#5E6572' }}>
          Contact your admin.
        </p>
      </div>
    </div>
  )
}
