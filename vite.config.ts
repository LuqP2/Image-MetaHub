import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: true, // Expose server to the network
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  }
})
