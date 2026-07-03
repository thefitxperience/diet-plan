import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './auth/AuthProvider'
import { I18nProvider } from './lib/i18n'
import './app.css'

// HashRouter: GitHub Pages has no server-side routing; hash URLs survive
// refresh/deep-link without the 404 fallback hack.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <I18nProvider>
      <AuthProvider>
        <HashRouter>
          <App />
        </HashRouter>
      </AuthProvider>
    </I18nProvider>
  </React.StrictMode>
)
