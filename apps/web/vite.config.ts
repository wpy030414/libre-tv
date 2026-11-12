import { defineConfig } from 'vite-plus'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import dotenv from 'dotenv'

// 从 repo 根读 .env（向上两级）
dotenv.config({ path: path.resolve(import.meta.dirname, '../../.env') })
const apiPort = process.env.PORT || '11408'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../server/dist/client',
    emptyOutDir: true,
  },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true },
    },
  },
})
