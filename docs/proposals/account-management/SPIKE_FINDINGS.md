# AM1 spike findings: one-time set-password link, ban/unban, email change

Run on 2026-10-01 against the LOCAL Supabase stack only (Auth server as shipped
with the CLI in this repo, `@supabase/supabase-js` and `@supabase/auth-js`
2.115.0). Hosted project untouched. Throwaway users `spike-*@example.test` were
created and all deleted afterwards (admin `listUsers` confirms zero remain;
`auth.one_time_tokens` is empty). Scratch scripts were outside the repo.

## Summary (plain English)

**Does the design work as specified? Yes, with three small changes.**

A Parent's server function can create a one-time "set your password" link for
any existing or brand-new household member without any email service. The link
works, can only be used once, and the person ends up able to sign in with the
password they chose and not the old one. Pausing (ban) and resuming an account,
and changing someone's email address, also work as hoped.

The three changes:

1. **Never give people the `action_link` that Supabase returns.** A plain web
   request to it (which is what a chat app's link preview does) uses up the
   one-time token. Instead build our own link to our own set-password page
   containing the `hashed_token`, and have that page exchange it with
   `verifyOtp` only when the person presses a button / the page loads in a real
   browser. A preview bot that fetches our page does not run JavaScript, so
   the token survives. (Verified: the action_link was consumed by a bare GET;
   the hashed_token route is not touched by GETs because it is just our page.)
2. **Generating a new link kills every earlier link for that person**, so the
   UI should say "this replaces the previous link".
3. **Pausing an account does not cut off an already-open session immediately**:
   a paused person's current access token keeps working against the database
   for up to 1 hour (the token lifetime). They cannot sign in again or refresh.
   If "instant" matters, the database rules need their own "is active" check.

Also: changing an email to one already in use returns a vague server error
(HTTP 500 "Error updating user"), not a clear "email exists" message, so check
for duplicates first. Link lifetime is controlled by the "OTP expiry" setting
(see (a)); raise it to 86400 for a 24-hour link.

## (a) generateLink + verifyOtp + updateUser

**generateLink works without sending email.** `auth.admin.generateLink({type:'recovery', email})`
with the service-role key, for an existing confirmed user. Took ~100 ms. Result:

```
data = { properties: {...}, user: {...} }
properties keys: action_link, email_otp, hashed_token, redirect_to, verification_type
action_link       = http://127.0.0.1:54321/auth/v1/verify?token=<redacted>&type=recovery&redirect_to=http://127.0.0.1:3000
email_otp         = "403526"          (6 digits)
hashed_token      = 56 hex chars
verification_type = "recovery"
redirect_to       = http://127.0.0.1:3000   (the config site_url; see note)
```

Note: `options.redirectTo` that is not on the allow-list silently falls back to
`site_url`. Irrelevant if we only use `hashed_token`.

**Anon client, no session:** `verifyOtp({ token_hash: hashed_token, type: 'recovery' })`
succeeded and returned a full session (expires_in 3600). JWT claims:
`role=authenticated`, `aal=aal1`, `amr=[{method:"otp"}]`. No restriction on
what the session can do.

**`auth.updateUser({ password })` with that session** worked. Afterwards:
`signInWithPassword` with the old password fails
(`400 invalid_credentials "Invalid login credentials"`), with the new password
succeeds. The recovery session itself stays valid after the password change
(its refresh token still refreshed).

**Single use.** Second `verifyOtp` with the same hash:
`AuthApiError status=403 code=otp_expired msg="Email link is invalid or has expired"`.

**Does a GET to action_link consume the token? YES.**
GET `action_link` with `redirect: 'manual'` returned `303` to
`http://127.0.0.1:3000#access_token=...&refresh_token=...&type=recovery` (i.e.
the server verified it and minted a session for whoever fetched it). A
`verifyOtp` with that link's `hashed_token` afterwards failed with
`403 otp_expired`. A second GET on a fresh link also returned
`#error=access_denied&error_code=otp_expired`. So a chat link-preview bot would
burn the link: **do not hand out `action_link`.** The `hashed_token` itself
(only `verifyOtp` consumes it) is safe as long as the URL we hand out points at
our own page and nothing server-side exchanges it on GET.

**Alternative that also works:** `verifyOtp({ email, token: email_otp, type: 'recovery' })`
succeeded too (6-digit code, needs the email). Not needed; hash route is better.

**Expiry knob.** Backdated the token in the database (spike user only):

| token age | result |
|---|---|
| 50 min | verifyOtp succeeded |
| 70 min | `403 otp_expired` |
| 25 h | `403 otp_expired` |

The running auth container has `GOTRUE_MAILER_OTP_EXP=3600`, which is
`[auth.email] otp_expiry = 3600` in `supabase/config.toml` (line ~233). So yes,
that is the right knob; set it to `86400` for a 24 h link (not edited here).
It also governs email OTP/magic link/recovery emails generally, which this app
does not otherwise use. **Hosted equivalent:** Dashboard > Authentication >
Providers (Sign In / Providers) > Email > "Email OTP Expiration" (seconds).
Supabase docs state values above 86400 (one day) are disallowed, so 86400 is
the maximum. (The hosted setting must be changed by the owner in the dashboard;
config.toml only governs local.)

## (b) Ban / unban

| step | result |
|---|---|
| `updateUserById(id,{ban_duration:'876000h'})` | ok, `banned_until` = ~100 years out |
| `signInWithPassword` while banned | `400 code=user_banned "User is banned"` |
| `refreshSession` with refresh token issued before ban | `400 user_banned "Invalid Refresh Token: User Banned"` |
| old access token against PostgREST while banned | **HTTP 200** (JWT is stateless; works until expiry, up to 1 h) |
| `auth.getUser(old access token)` while banned | `403 user_banned` (so server code that calls `getUser` is cut off, RLS-only paths are not) |
| `generateLink` for banned user | succeeds (no error) |
| `verifyOtp` of that link while banned | `403 user_banned`, and the token is NOT consumed (same hash worked after unban) |
| `ban_duration:'none'` | ok, `banned_until` gone; `signInWithPassword` succeeds again |
| a session that was never refreshed while banned, after unban | refresh works |

Design implication: ban stops new sign-ins and refreshes immediately, but an
open access token keeps PostgREST/RLS access up to `jwt_expiry` (3600 s). If
that residual hour is unacceptable, add an `is_active` check in RLS/membership
and/or reduce `jwt_expiry`. Also, to force other sessions off, changing the
password does it (see (e)).

## (c) Email change by admin

`updateUserById(id, { email: new, email_confirm: true })`:
- Applies immediately; no confirmation email, `new_email` stays empty, user stays confirmed.
- Old email sign-in: `400 invalid_credentials`. New email sign-in: works.
- An already-open session survives and its next refreshed JWT carries the new email.
- Omitting `email_confirm:true` also changed it immediately in this config
  (`double_confirm_changes = true` did not trigger anything for admin updates),
  but still pass `email_confirm:true` so hosted behaviour with confirmations on
  cannot leave the user unconfirmed.
- **Duplicate email:** `AuthRetryableFetchError status=500 code=undefined msg="Error updating user"`
  (same for a different-case duplicate, so emails are compared case-insensitively).
  This is not a friendly error; `createUser` with a duplicate gives the clear
  `422 email_exists`. Pre-check for duplicates (e.g. an RPC against `auth.users`
  via a security-definer function, or list users) and map the 500 to "that email
  is already in use".
- Invalid format: `400 validation_failed "Unable to validate email address: invalid format"`.
- `getUserById(id)` returns `user.email` (current), `user.new_email` (undefined),
  `email_confirmed_at`, `banned_until`, `last_sign_in_at`, `user_metadata` -
  fine for a server function to show the current email and paused state.

## (d) New-member invite path

`createUser({ email, password: <32 random bytes base64url>, email_confirm:true })`
followed by `generateLink({type:'recovery', email})`: works identically to an
existing user. Same properties returned; `verifyOtp` -> session; `updateUser({password})`
-> user signs in with chosen password; the random password is rejected
(`invalid_credentials`). `createUser` with no password at all also works, and
its recovery link works the same. The user gets an `email` identity,
`app_metadata.provider = "email"`. No difference found.

Side finding: `generateLink({type:'invite', email})` for an unknown email
creates the user unconfirmed and its hashed_token works with
`verifyOtp({type:'invite'})` too. We do not need it; `createUser` + `recovery`
keeps one code path for new and existing members.
`generateLink({type:'recovery'})` for an unknown email: `404 user_not_found`.

## (e) Other findings

- **New link invalidates older ones.** Generated link 4 then link 5: link 4 gave
  `403 otp_expired`, link 5 worked. Only the newest recovery link per user is valid.
- **No rate limit hit on admin `generateLink`:** 30 back-to-back calls, 0 failures
  (~1.8 s total). Local `GOTRUE_RATE_LIMIT_EMAIL_SENT` is very high and the
  limit is about sent emails, which we never send. Hosted limits not tested.
- **Same password rejected:** `updateUser({password: <current>})` ->
  `422 same_password "New password should be different from the old password."`
  (applies when current password equals new one; surface this message.)
- **Minimum length:** `minimum_password_length = 6` (container
  `GOTRUE_PASSWORD_MIN_LENGTH=6`, no required characters). `updateUser({password:'abc'})`
  -> `AuthWeakPasswordError 422 weak_password "Password should be at least 6 characters."`
  Enforce any stricter rule (e.g. 8+) in the UI and, if wanted, raise the
  setting (`config.toml` locally; Dashboard > Authentication > Sign In / Providers
  > Email "Minimum password length" hosted).
- **AAL/AMR:** recovery session is `aal1`, `amr=otp`; `updateUser` has no extra
  restrictions (the user has no MFA enrolled, so aal2 was not exercised).
- **`secure_password_change`:** local value is `false`
  (`GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION=false`); not changed
  (config.toml is off limits). When true, `updateUser({password})` can demand a
  reauthentication nonce unless the session is very recent; a session just
  minted by `verifyOtp` is as recent as possible, so it should still work, but
  that was NOT tested. Keep the hosted setting off unless re-tested.
- **Password change revokes other sessions.** After an admin
  `updateUserById({password})` and after a user `updateUser({password})`, refresh
  tokens of the user's OTHER sessions failed with `refresh_token_not_found`
  (control without a password change: refresh succeeded). The session that
  made the change stays valid. This is a good way to boot a lost device.
  `auth.admin.signOut(<user's access token>, 'global')` also revokes all
  refresh tokens, but needs the user's JWT so is not useful for a Parent acting
  on someone else; use a password reset (or ban) instead.
- Verifying a link for a banned user fails without consuming the token.
- Local config note: `additional_redirect_urls = ["https://127.0.0.1:3000"]`;
  irrelevant to the hashed_token route.

## Recommended exact call sequence

All "admin" calls run in a Supabase Edge Function using the service-role key
(never in the browser), after the function has checked in SQL/with the caller's
JWT that the caller is a Parent of the same household as the target.

### 1. Create the link (Parent action)

```ts
// admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession:false, autoRefreshToken:false } })

// New member only (skip for existing member):
const { data: created, error: cErr } = await admin.auth.admin.createUser({
  email, password: randomBase64Url(32), email_confirm: true,
});
// duplicate -> cErr.code === 'email_exists' (422)

// Both new and existing:
const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email });
if (error) /* 404 user_not_found if email unknown */;
const { hashed_token } = data.properties;           // ignore action_link and email_otp
const url = `${APP_ORIGIN}/set-password#token_hash=${hashed_token}`;  // OUR page
// Write an audit row. Return `url` to the Parent once; do not store the token.
// UI note: generating again invalidates the previous link. Expiry = otp_expiry
// (set to 86400 locally and in the hosted dashboard).
```

Use a URL fragment (`#...`) rather than a query so the token is not sent to
Cloudflare logs. The SPA page must NOT call `verifyOtp` on load by a server
render and must not be fetched-and-consumed by anything but a real browser; a
"Set my password" button that calls `verifyOtp` on click is the safest against
scanners that run JavaScript.

### 2. Consume the link (set-password page, anon client, no session)

```ts
const { data, error } = await supabase.auth.verifyOtp({ token_hash, type: 'recovery' });
// error.code: 'otp_expired' (used/expired/replaced) -> "ask your parent for a new link";
//             'user_banned' -> "account paused" (token not consumed)
// Ask the user for the new password (client-side min length), then:
const { error: uErr } = await supabase.auth.updateUser({ password });
// uErr.code: 'same_password', 'weak_password' (422) -> show message and let them retry;
// the session from verifyOtp is still valid so retrying updateUser works.
// Success: user is signed in with the new password; other sessions are revoked.
// Clear the fragment from the URL (history.replaceState) before/after verify.
```

### 3. Ban / unban (Parent action)

```ts
await admin.auth.admin.updateUserById(id, { ban_duration: '876000h' }); // pause
await admin.auth.admin.updateUserById(id, { ban_duration: 'none' });    // resume
// Show state from (await admin.auth.admin.getUserById(id)).data.user.banned_until
// Remember: open access token keeps working for up to jwt_expiry (1 h) against
// PostgREST. Write an audit row. To also kick other sessions, reset password.
```

### 4. Change email (Parent action)

```ts
// pre-check duplicate (case-insensitive) -> friendly error; the API's own
// duplicate error is a bare 500 "Error updating user".
const { error } = await admin.auth.admin.updateUserById(id, { email: newEmail, email_confirm: true });
// 400 validation_failed = bad format
// Current email for display: (await admin.auth.admin.getUserById(id)).data.user.email
// Applies at once, no confirmation, existing sessions continue and get the new
// email on next refresh. Write an audit row (old and new email).
```

## Fallback (not needed)

If the hashed_token route were ever unusable, the fallback would be:
show the 6-digit `email_otp` to the Parent and have the person type their email
plus that code on the set-password page (`verifyOtp({email, token, type:'recovery'})`),
which is also immune to link scanners. It was verified to work.
