import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { sourceVersion } from './scripts/source-version';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';

// Independent static build; the existing Sites build continues to use vite.config.ts.
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(sourceVersion()) },
  root: fileURLToPath(new URL('./static-app', import.meta.url)),
  base: process.env.PAGES_BASE_PATH || '/duet-windows/',
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('./dist-pages', import.meta.url)),
    emptyOutDir: true,
  },
});
