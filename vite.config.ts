import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { resolve } from 'path'

// onnxruntime-web resolves these at runtime and would otherwise fetch them from
// a CDN on the first inference, which the local-first guarantee does not allow.
// Staging them in public/ makes them available at /ort/ in dev and dist/ort/ in
// a packaged build, which is what the embedding worker points wasmPaths at.
const ORT_RUNTIME_FILES = [
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
]

const stageOnnxRuntime = () => {
  const source = resolve(__dirname, 'node_modules/onnxruntime-web/dist')
  const target = resolve(__dirname, 'public/ort')
  if (!existsSync(source)) {
    console.warn('⚠️ onnxruntime-web not installed; visual search will not run')
    return
  }
  mkdirSync(target, { recursive: true })
  for (const file of ORT_RUNTIME_FILES) {
    const from = resolve(source, file)
    if (!existsSync(from)) continue
    copyFileSync(from, resolve(target, file))
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-assets',
      buildStart() {
        stageOnnxRuntime()
      },
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
  // Workers must be ES modules: onnxruntime-web (pulled in by the embedding
  // worker) resolves its WASM backend through a dynamic import(), which the
  // default iife worker format cannot express. Without this the packaged build
  // fails while `npm run dev` keeps working.
  worker: {
    format: 'es',
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
