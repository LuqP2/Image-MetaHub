import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync } from 'fs'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-changelog',
      closeBundle() {
        // Copy CHANGELOG.md to dist folder after build
        try {
          copyFileSync(
            resolve(__dirname, 'CHANGELOG.md'),
            resolve(__dirname, 'dist/CHANGELOG.md')
          )
          console.log('✅ CHANGELOG.md copied to dist/')
        } catch (error) {
          console.warn('⚠️ Failed to copy CHANGELOG.md:', error)
        }
      }
    }
  ],
  base: './',
  server: {
    host: true, // Expose server to the network
  },
  css: {
    postcss: './postcss.config.cjs'
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  }
})
