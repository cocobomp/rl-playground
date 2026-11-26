/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// base: './' → chemins relatifs : le même build fonctionne sur Cloudflare Pages,
// GitHub Pages (sous-dossier /rl-playground/) ou dans une iframe.
export default defineConfig({
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  test: { include: ['tests/**/*.test.ts'] },
});
