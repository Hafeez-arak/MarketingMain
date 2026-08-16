import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ConfigError } from './components/ConfigError'
import { CONFIG_ERROR } from './lib/supabaseClient'
import './index.css'

// A build with no Supabase credentials cannot do anything useful, but it can
// at least explain itself rather than rendering a blank page.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {CONFIG_ERROR ? (
      <ConfigError message={CONFIG_ERROR} />
    ) : (
      <BrowserRouter>
        <App />
      </BrowserRouter>
    )}
  </React.StrictMode>
)
