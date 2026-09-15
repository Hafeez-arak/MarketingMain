import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `.claude/worktrees/` holds full checkouts of other branches, and eslint
  // walks into them by default — so `npx eslint .` here reported errors from
  // four branches at once, in files that do not appear in `git status` and
  // whose paths read like ordinary source paths. Same reason vite.config.js
  // excludes them from the test run.
  globalIgnores(['dist', '.claude/**']),
  // Build config runs in Node, not the browser, so it gets Node's globals —
  // `process.env` in vite.config.js is correct there and was only an error
  // because every file was being linted as browser code.
  {
    files: ['vite.config.js', 'postcss.config.js', 'tailwind.config.js', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
  // Vercel serverless functions are Node too — they read process.env for the
  // secrets that must never be bundled into the client.
  {
    files: ['api/**/*.js'],
    languageOptions: { globals: globals.node },
  },
  // The n8n harness and its tests run in Node under vitest, and they handle
  // real binary payloads: an image or clip is a Buffer on its way to Supabase
  // Storage, and the tests assert on those bytes because a JSON-serialised
  // Buffer is the one corruption that stores a file nothing can open. Buffer
  // is correct there and was only an error because everything not named above
  // is linted as browser code.
  {
    files: ['n8n/**/*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
])
