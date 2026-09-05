/// <reference lib="webworker" />
// Service worker (S4.3): app-shell precaching only.
//
// precacheAndRoute(self.__WB_MANIFEST) below is the ENTIRE caching surface
// of this service worker. It registers routes only for the static assets
// that Vite/vite-plugin-pwa built and listed in the injected manifest (JS,
// CSS, HTML, icons, etc.) -- it does not intercept arbitrary fetches.
//
// There is deliberately no runtime-caching route, no fetch listener, and no
// offline fallback for anything else -- most importantly, nothing for this
// app's Supabase-backed REST/RPC calls. Requests to Supabase (a different
// origin from this app) simply fall through to the network exactly as they
// would with no service worker installed at all. This is not an oversight:
// per this project's standing rules (ADR-007, "no offline write queue"),
// ledger data is never offline-authoritative. A Child must never see a
// stale cached balance, and a failed financial write must surface as a
// normal retry/error state, never a silently queued or cached response. Do
// not add a registerRoute/NetworkFirst/StaleWhileRevalidate strategy or any
// fetch handler for Supabase paths here -- that would reintroduce exactly
// the behavior this task is required to avoid.
import { precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope;

self.skipWaiting();

precacheAndRoute(self.__WB_MANIFEST);
