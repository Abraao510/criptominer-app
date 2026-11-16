import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const upstream = process.env.API_URL ?? 'http://178.95.25.53:3000'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    hmr: false,
    proxy: {
      '/api': {
        target: upstream,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
