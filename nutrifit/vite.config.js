import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves the app from /<repo-name>/ — override with VITE_BASE
// (set VITE_BASE=/ for custom domains or local preview at root).
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: process.env.VITE_BASE || (mode === 'production' ? '/nutrifit/' : '/'),
  build: {
    chunkSizeWarningLimit: 1500,
  },
}))
