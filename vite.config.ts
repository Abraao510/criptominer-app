import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const upstream = process.env.API_URL ?? 'https://acceptable-tenderness-production-f1b33822.up.railway.app'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api': {
        target: upstream,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
