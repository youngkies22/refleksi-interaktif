import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Alias yang sama persis dengan tsconfig — inilah yang membuat Vue dan
      // server benar-benar membaca satu file kontrak yang sama, bukan salinan.
      '@bersama': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  server: {
    // Saat `npm run dev` di luar Docker, teruskan API & socket ke server backend.
    proxy: {
      '/api': 'http://localhost:8080',
      '/socket.io': { target: 'http://localhost:8080', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
