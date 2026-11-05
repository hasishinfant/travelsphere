import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'production' ? '/tbo/' : '/', // Use /tbo/ for production, / for dev
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    // Forward API calls to the Express backend (server/) during development
    proxy: {
      '/api': { target: 'http://127.0.0.1:4000', changeOrigin: false },
    },
    open: true,
    // Enable HTTP/2 for better performance
    https: false,
    // Improve HMR performance
    hmr: {
      overlay: true,
    },
    // Faster file watching
    watch: {
      usePolling: false,
    },
  },
  build: {
    // Performance optimizations
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('three')) {
              return 'three';
            }
            if (id.includes('@supabase')) {
              return 'supabase';
            }
          }
        },
      },
    },
    // Source maps are generated locally for debugging but never published:
    // GitHub Pages would otherwise serve the full original source.
    sourcemap: mode === 'production' ? false : true,
    // Optimize chunk size
    chunkSizeWarningLimit: 1000,
    // Enable minification
    minify: 'terser',
    terserOptions: {
      compress: {
        // Strip noisy logging but keep console.error / console.warn so crashes stay diagnosable
        pure_funcs: ['console.log', 'console.info', 'console.debug', 'console.trace'],
        drop_debugger: true,
      },
    },
    // Enable CSS code splitting
    cssCodeSplit: true,
  },
  // Optimize dependencies
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      '@tanstack/react-query',
      'axios',
    ],
    // Exclude heavy dependencies from pre-bundling
    exclude: ['web-vitals'],
  },
  // Enable experimental features for better performance
  esbuild: {
    // Remove unused imports
    treeShaking: true,
    // Drop debugger statements in production (console.* is handled by terser above)
    drop: mode === 'production' ? ['debugger'] : [],
  },
  // Performance hints
  preview: {
    port: 4173,
    open: true,
  },
}))