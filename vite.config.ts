import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// @ts-expect-error - Plugin personalizado sin tipos
import injectEnvPlugin from './vite-plugin-inject-env.js'

export default defineConfig({
  plugins: [react(), injectEnvPlugin()],
  server: { port: 5176 },
})
