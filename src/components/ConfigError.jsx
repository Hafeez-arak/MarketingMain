// ─── Configuration error screen ────────────────────────────────────────────
// Shown in place of the app when the build has no Supabase credentials (see
// CONFIG_ERROR in lib/supabaseClient.js).
//
// Deliberately plain inline styles rather than the design system: this screen
// exists precisely for builds that are too misconfigured to be trusted to
// mount anything, so it depends on nothing but React. Before it existed the
// symptom was a blank white page whose only clue was a console error.
export function ConfigError({ message }) {
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
          Configuration
        </p>
        <h1 style={{ margin: '10px 0 14px', fontSize: 20, fontWeight: 700, color: '#1C2321' }}>
          This deployment isn’t configured yet.
        </h1>
        <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.6, color: '#5E6572' }}>
          {message}
        </p>
        <p style={{ margin: '0 0 10px', fontSize: 14, lineHeight: 1.6, color: '#5E6572' }}>
          Add these to the hosting provider’s environment variables, then
          <strong> redeploy</strong> — they are inlined when the app is built, so an
          existing deployment will not pick them up on its own.
        </p>
        <pre style={{
          margin: 0, padding: '12px 14px', borderRadius: 10, background: '#EEF1EF',
          fontSize: 12.5, lineHeight: 1.7, color: '#1C2321', overflowX: 'auto',
        }}>
{`VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_N8N_BASE_URL=https://<host>   # host only, no /webhook suffix`}
        </pre>
      </div>
    </div>
  )
}
