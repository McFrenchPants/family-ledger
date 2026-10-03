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
        // Light page background (--bg in src/styles/tokens.css), so the
        // installed app's status bar and splash blend into the app shell.
        // The manifest has no dark variant; index.html's theme-color metas
        // switch it to the dark --bg where the browser supports that.
        theme_color: "#f5f6f8",
        background_color: "#f5f6f8",
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
    // Lets a phone on the LAN (or `npm run dev` on localhost) reach the local
    // Supabase stack through the same HTTPS origin it already loaded the app
    // from -- avoids a phone browser blocking a direct http://127.0.0.1:54321
    // API call as mixed content when the page itself is https://<lan-ip>:5173.
    proxy: {
      "/supabase-api": {
        target: "http://127.0.0.1:54321",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/supabase-api/, ""),
      },
    },
  },
});
