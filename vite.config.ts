import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync } from 'fs'
import { resolve } from 'path'

// Ensure the license secret is baked into the renderer bundle.
// If only IMH_LICENSE_SECRET is set, we mirror it to VITE_IMH_LICENSE_SECRET here.
const licenseSecret =
  process.env.VITE_IMH_LICENSE_SECRET ||
  process.env.IMH_LICENSE_SECRET ||
  'CHANGE-ME-BEFORE-RELEASE'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-assets',
      closeBundle() {
        // Copy CHANGELOG.md and logo to dist folder after build
        try {
          copyFileSync(
            resolve(__dirname, 'CHANGELOG.md'),
            resolve(__dirname, 'dist/CHANGELOG.md')
          )
          console.log('✅ CHANGELOG.md copied to dist/')
          
          copyFileSync(
            resolve(__dirname, 'public/logo1.png'),
            resolve(__dirname, 'dist/logo1.png')
          )
          console.log('✅ logo1.png copied to dist/')
        } catch (error) {
          console.warn('⚠️ Failed to copy assets:', error)
        }
      }
    }
  ],
  base: './',
  define: {
    'import.meta.env.VITE_IMH_LICENSE_SECRET': JSON.stringify(licenseSecret),
  },
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
