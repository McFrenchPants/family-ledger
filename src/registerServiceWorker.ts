// Client-side service worker registration (S4.3).
//
// vite-plugin-pwa is configured with strategies: "injectManifest" and
// registerType: "autoUpdate" (see vite.config.ts). Importing the
// `virtual:pwa-register` virtual module -- rather than leaving
// `injectRegister` to auto-inject a <script> into index.html -- is what
// this version of vite-plugin-pwa treats as "register from source": the
// plugin detects the import and skips injecting its own registration
// script (see the `useImportRegister` flag it flips when this virtual
// module is loaded).
//
// `registerType: "autoUpdate"` means the generated `registerSW` here
// already reloads the page once a new service worker takes control -- no
// custom "new version available" prompt UI is needed for this task.
//
// In dev (no `devOptions.enabled` in vite.config.ts) this virtual module
// resolves to a no-op stub, so calling it unconditionally on every load is
// safe and does nothing outside of a production build.
import { registerSW } from "virtual:pwa-register";

export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  registerSW({ immediate: true });
}
