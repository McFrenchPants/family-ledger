/// <reference lib="webworker" />
// Placeholder service worker for S4.1 (Vite PWA tooling wiring).
// S4.3 owns the real caching/push-notification strategy and will
// overwrite/extend this file.

import { precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope;

self.skipWaiting();

precacheAndRoute(self.__WB_MANIFEST);
