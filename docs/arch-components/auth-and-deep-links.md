# Auth and deep links

_Last updated: 2026-11-17_

[Back to Manor architecture](../ARCHITECTURE.md)

People and agents authenticate differently and end at the same row-level policies and operation catalog. Both flows leave the app and come back through a link on the build's URL scheme, as the following diagram shows.

![Sign-in and agent consent: Manor opens a PKCE Google sign-in in an authentication session that returns manor://auth/callback with a code, which the app exchanges for a session saved on disk; an agent's OAuth request lands on the consent bridge page in the agent's own window, which opens manor://oauth/consent; you allow access in Manor, which approves the request and saves the return address with manor_oauth_handoff_save; the bridge page takes it with manor_oauth_handoff_take and continues the agent to its callback with the code.](../diagrams/svg/auth-deep-links.svg)

<details><summary>Diagram key</summary>

![Diagram key of the nine node roles: people and surfaces, the Manor Mac app, local storage and sync, Supabase and durable data, agents and AI models, external providers, background and async work, checks and gates, and neutral or closed.](../diagrams/svg/_key.svg)

</details>
<p></p>

## Sign-in

Supabase Auth uses Google as the only provider. Email and password, magic link, phone, and anonymous sign-in are off, and Manor sends no email of its own. `ManorSession.signInWithGoogle` runs the PKCE flow through `ASWebAuthenticationSession` with `<scheme>://auth/callback` as the return URL; `completeSignIn(from:)` exchanges the code, or adopts tokens from a fragment, which is how a verify link from `scripts/staging-session.sh` signs a staging build in. A refused sign-in shows its reason on the sign-in panel.

`FileAuthStorage` keeps the session in `Application Support/<bundle id>/Session/`, in files readable only by you with complete file protection. It doesn't use the Keychain, because the Keychain asks for permission again after every update of an app signed with a self-signed certificate.

On sign-in the session builds a `Gateway` for the account, opens the local mirror, and shows the cached account from `UserDefaults` at once if this Mac has opened it before, then loads the profile. A first sign-in saves the profile with the system time zone.

## Signup gate

A new account must pass the shared signup gate before Google creates it. `requestSignup` sends the email and gate password to the `signup-gate` Edge Function, which checks the password against a stored hash with rate limits and records a short-lived, single-use grant bound to that email; then Google sign-in starts with that email as the login hint. Supabase's before-user-created hook rejects any account creation without a valid grant, including direct Auth API and OAuth requests, and consumes the grant server-side. The password never appears in metadata, URLs, or logs.

## Agent consent

An agent's authorization must finish in the browser window that started it, because the agent keeps its OAuth state there. The OAuth server's site URL is therefore a static consent bridge page in `site/`, deployed to GitHub Pages by the `Consent bridge` workflow, with a production page and one under `/staging`.

1. The agent host starts OAuth 2.1 with Supabase Auth, and Auth sends its window to the bridge page.
2. The bridge opens `<scheme>://oauth/consent?authorization_id=…` and waits.
3. Manor shows `AgentConsentView` as a centered dialog over any page. It reads the request with the Supabase OAuth server API, and **Allow access** approves it while **Cancel** denies it.
4. Manor stores the returned redirect with `manor_oauth_handoff_save`, which accepts only a signed-in session and only an address on the client's registered redirect URI.
5. The bridge page takes it once with `manor_oauth_handoff_take` and continues the agent's window to it. The code in that address is useless without the agent's PKCE verifier, so the page needs only the publishable key.

Settings lists connected agent clients (`manor_list_mcp_clients`) and revokes them (`manor_revoke_mcp_client`); revocation takes effect immediately.

## Row-level security

- Account identity comes from verified authentication, never from a supplied owner ID. Exposed tables have explicit grants and owner-scoped policies written as `user_id = (select auth.uid())`, with an index on every policy column.
- `job_listings` and the problem catalog are shared: every signed-in account reads them, because the before-user-created hook makes every authenticated user an approved account, and only service-role functions and operator tooling write them. Catalog problems are the `leetcode_problems` rows whose `user_id` is null, so one policy serves the catalog and an account's custom problems.
- Direct table writes can't bypass command validation, revisions, deduplication, or history. Privileged functions have narrow grants, fixed search paths, explicit ownership checks, and a least-privilege owner.
- Integration credentials, queue controls, signup grants, and infrastructure records aren't client-readable.
- Agent tokens are scoped to read or read and write, revocable, and never carry a service-role credential. Caller-supplied provenance is context, not proof of identity.

## Origins and return links

The native app sends no `Origin` header, so Edge Functions treat such a request as the desktop app and compare against the literal `tauri://localhost` that stored connection rows and the `MANOR_ORIGIN` setting already carry (`supabase/functions/_shared/origins.ts`). Integration callbacks return to `<scheme>://settings` using the environment's `MANOR_DESKTOP_SCHEME`, never an address the caller chooses.

## Sign-out and expiry

Explicit sign-out first runs every registered guard; any guard that reports unsynced Notes drafts, unsynced code drafts, or files still uploading cancels it with that message. After a sign-out completes, the session stops the mirror and runs cleanups that delete the account's mirror file, synced drafts, and pending upload journals, and forgets the cached account. Session expiry is different: local drafts stay, authenticated operations stop, and the same account has to sign in again before they replay. Another account never inherits them.
