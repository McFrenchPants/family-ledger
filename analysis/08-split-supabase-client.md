# Analysis: Split the Supabase client out of the main bundle

## What problem this was supposed to solve

The backlog entry claims the app ships one 498.81 kB JS chunk (139.29 kB
gzip) and that `PROJECT_REQUIREMENTS.md` §17 obligates fixing this before
more feature code piles on top.

## What the investigation found

- The citation is wrong: `PROJECT_REQUIREMENTS.md` §17 is **Accessibility**,
  not performance. The actual relevant section is `ARCHITECTURE.md` §27
  ("Performance Expectations"), which says to optimize for simple queries,
  correct authorization, clear code, and fast mobile interactions — and
  explicitly warns against adding complexity "without an observed need."
  There is no stated bundle-size budget anywhere in either spec doc.
- Route-level code-splitting — the fix implied by the backlog title —
  would not meaningfully shrink the critical first-load path. Nearly every
  route requires `@supabase/supabase-js` (session/auth state included, so
  even the sign-in page needs it), and `supabase-js` is the large majority
  of the 139 kB gzip figure. Splitting by page mostly just moves bytes
  around; the browser still fetches almost the same payload before the
  first authenticated screen can render.
- The one real lever — a `manualChunks` vendor split so React/react-router/
  supabase-js live in a separately-cached chunk from app code — would help
  repeat visits after a deploy (smaller re-download on update) but not the
  cold-start number the backlog entry is actually worried about, and it's a
  smaller win than the entry implies.
- There is no user-reported slowness or measured real-world problem driving
  this. It was raised proactively at Phase 0 T4 based on the bundle-size
  delta alone, not an observed pain point.

## Is it worth doing now

No. Confirmed with the user directly (2026-09-05 session): this is low
value relative to the app being built — a household-scale, low-traffic
ledger where `ARCHITECTURE.md` §27 explicitly favors simplicity and warns
against optimizing without an observed need. The specific fix the backlog
title proposes (route splitting) wouldn't deliver the benefit it implies,
and the version that would help (vendor chunk caching) is a marginal,
speculative win with no measured problem behind it.

## Disposition

Deferred, not deleted. Revisit only if a real signal shows up later: actual
user-reported slow loads, a measured Lighthouse/PWA-audit regression, or the
bundle growing substantially larger as more phases land. Absent that, this
stays out of the active backlog.
