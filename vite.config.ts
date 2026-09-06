import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import mkcert from "vite-plugin-mkcert";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    mkcert(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectRegister: "auto",
      // Without this, `vite-plugin-pwa` only serves the manifest/service
      // worker in a production build (`npm run build`) -- `npm run dev`
      // silently skips both, so a phone testing against the dev server sees
      // no PWA behavior at all (generic icon, no beforeinstallprompt) with
      // no error to explain why. `type: "module"` matches this project's
      // `injectManifest` service worker, which is itself an ES module.
      devOptions: {
        enabled: true,
        type: "module",
      },
      manifest: {
        name: "Family Ledger",
        short_name: "Family Ledger",
        id: "/",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#2f5d8a",
        background_color: "#ffffff",
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/icons/icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  server: {
    host: true,
  },
});
