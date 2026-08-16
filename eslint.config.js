import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
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
