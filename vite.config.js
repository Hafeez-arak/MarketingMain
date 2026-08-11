import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ─── Dev-only: save an exported blob to disk ───────────────────────────────
// POST a binary body to /__dev/save?name=foo.png and it lands in
// <tmpdir>/arak-dev-exports/foo.png.
//
// This exists so the editor's real output can be inspected and fed to the
// video compose step without signing in: the studio itself is behind auth, and
// the dev harness (/dev-editor.html) has no access token, so it cannot upload
// to Supabase the way the real app does. Writing to a temp dir keeps the
// service-role key out of the browser entirely, which uploading directly would
// not.
//
// `apply: 'serve'` means this never exists in a production build.
function devExportSink() {
  const dir = path.join(os.tmpdir(), 'arak-dev-exports')
  return {
    name: 'arak-dev-export-sink',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/save', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end('POST only') }
        const raw = new URL(req.url, 'http://localhost').searchParams.get('name') || 'export.bin'
        // Filenames come from a browser we do not fully control, and this
        // writes to disk — anything that isn't a plain name is rejected rather
        // than sanitised, so no request can climb out of the directory.
        if (!/^[A-Za-z0-9._-]+$/.test(raw)) { res.statusCode = 400; return res.end('bad name') }
        fs.mkdirSync(dir, { recursive: true })
        const chunks = []
        req.on('data', c => chunks.push(c))
        req.on('end', () => {
          const file = path.join(dir, raw)
          fs.writeFileSync(file, Buffer.concat(chunks))
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, path: file, bytes: fs.statSync(file).size }))
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), devExportSink()],
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
  },
})
