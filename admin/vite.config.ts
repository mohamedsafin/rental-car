import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Lets us import '@/services/api' instead of '../../../services/api'.
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5174,
    strictPort: true,
    /*
     * Listen on EVERY address, so "localhost" always works.
     *
     * Vite's default is the hostname "localhost", which Node 17+ on Windows
     * resolves to the IPv6 loopback [::1] and binds there ONLY. A browser that
     * resolves "localhost" to the IPv4 127.0.0.1 - which Chrome and Edge often
     * do - then gets connection refused against a server running perfectly
     * well, one address over. The page never loads and nothing says why.
     *
     * Pinning it to 127.0.0.1 fixed that and broke the mirror image: anything
     * reaching for [::1] then failed. Binding to all addresses is what makes
     * BOTH spellings work, which is the only outcome a person typing
     * "localhost" into a browser should have to think about.
     *
     * It also makes the dev server reachable from other devices on the same
     * network - useful for checking the counter screens on a phone, and worth
     * knowing about on an untrusted wifi.
     */
    host: true,
  },
});
