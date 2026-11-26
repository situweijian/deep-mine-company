import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: ['.trycloudflare.com', '.loca.lt', '.lhr.life'],
  },
  preview: {
    host: '0.0.0.0',
    port: 4174,
    allowedHosts: ['.trycloudflare.com', '.loca.lt', '.lhr.life'],
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
