import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['photoflow-icon.svg', 'photoflow-192.png', 'photoflow-512.png'],
      manifest: {
        name: 'PhotoFlow — مساعد المصور',
        short_name: 'PhotoFlow',
        description: 'نظّم عملاءك وحجوزاتك ومشاريع التصوير من مكان واحد.',
        lang: 'ar',
        dir: 'rtl',
        display: 'standalone',
        orientation: 'portrait-primary',
        theme_color: '#3b2419',
        background_color: '#f8f3ed',
        icons: [
          { src: '/photoflow-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
          { src: '/photoflow-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/photoflow-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: '/index.html'
      }
    })
  ],
  server: { host: '0.0.0.0' }
});
