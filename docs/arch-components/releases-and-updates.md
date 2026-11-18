# Releases and updates

_Last updated: 2026-11-18_

[Back to Manor architecture](../ARCHITECTURE.md)

Manor ships as a signed app archive on GitHub Releases, and the installed app updates itself from a signed feed. The following diagram shows both halves.

![Releases and updates: scripts/release.sh refuses a dirty tree or an existing tag, runs build-app.sh to build, bundle, write Info.plist, and sign with the Manor Signing certificate, signs the archive with the Ed25519 key in ~/.config/manor, and publishes the app zip and manor-update.json to GitHub; the installed app checks the latest or staging feed at launch, hourly, and when it becomes active after an idle hour, verifies the Ed25519 signature, bundle identifier, build, and signing certificate, offers an update that waits for unsaved work, and swaps the bundle with a helper script and relaunches; a mismatch is dropped quietly until the next check.](../diagrams/svg/release-pipeline.svg)

<details><summary>Diagram key</summary>

![Diagram key of the nine node roles: people and surfaces, the Manor Mac app, local storage and sync, Supabase and durable data, agents and AI models, external providers, background and async work, checks and gates, and neutral or closed.](../diagrams/svg/_key.svg)

</details>
<p></p>

## Building

`macos/scripts/build-app.sh [production|staging] [--debug] [--open]` builds `Manor.app` or `Manor Staging.app` in `macos/build/`:

1. Reads `macos/config/<mode>.env` (`SUPABASE_URL` and the publishable `SUPABASE_KEY`), which git ignores.
2. Runs `swift build` for the `Manor` product and assembles the bundle with the icon, fonts, math fonts, sounds, and the compiled asset catalog that carries the plum accent.
3. Writes `Info.plist` with the name, bundle identifier, URL scheme, version (`macos/VERSION`), build number (the commit count, or `MANOR_BUILD_NUMBER`), minimum macOS 15, usage descriptions for the microphone and screen capture, the Supabase settings, the update feed, and the update public key from `macos/config/update-public-key.txt`.
4. Signs with the hardened runtime and `Resources/Manor.entitlements` using the **Manor Signing** certificate (`MANOR_SIGN_IDENTITY` overrides it), falling back to ad hoc signing with a warning when the certificate is missing, then verifies the signature and registers the bundle with Launch Services.

Manor Signing is a self-signed code-signing certificate in the release Mac's keychain. A stable identity keeps file permissions, Keychain items, and the updater's same-signer check working across builds. It isn't a Developer ID, and builds aren't notarized, so a first install needs Gatekeeper approval.

## Publishing

`macos/scripts/release.sh production <version> [notes.md]` publishes a production release; `release.sh staging [notes.md]` replaces the assets of the rolling `staging` prerelease. `release-and-install.sh <version> [notes.md]` checks the prerequisites first (the certificate, the update key, a signed-in GitHub CLI, and the production build settings, which it writes from the project's publishable key when missing), runs the production release, and installs the new build in Applications, moving the previous copy to the Trash. A version already recorded in `VERSION` is tagged at the current commit.

- It refuses a working tree with uncommitted changes, because the published build would match no commit, and refuses a production tag that already exists, because a published version is never replaced.
- For production it writes the version to `macos/VERSION`, commits it, builds, tags `v<version>`, pushes, and creates the release marked latest.
- It zips the app with `ditto`, signs the archive with `scripts/sign-update.swift` using the Ed25519 private key at `~/.config/manor/update_ed25519.key`, and writes `manor-update.json`: `{"version", "build", "archive", "signature"}`.

`scripts/make-update-key.swift` creates the key pair once; the private key never enters the repository, and the public key goes in `config/update-public-key.txt`.

## Updating

`Updater` runs only in a bundled app with a feed and a public key. Production reads `releases/latest/download/manor-update.json`; staging reads the `staging` prerelease's copy.

1. **Check** at launch, every hour, and when Manor becomes active after more than an hour since the last check. A build number no greater than the running one is ignored.
2. **Verify** the downloaded archive's Ed25519 signature against the public key in `Info.plist`, then unpack it and require the same bundle identifier, the release's build number, and a code signature that satisfies the running app's designated requirement, which means the same certificate.
3. **Offer** an **Update ready** row in the sidebar. A failed background check stays quiet; the next one retries.
4. **Install** when you choose restart: every sign-out guard runs first, so unsynced Notes, code drafts, or uploads postpone it with a message. Alfred's Prep-mode quit rule is lifted for the install. A helper script waits for Manor to exit, swaps the bundle in place with a rollback if the copy fails, and reopens it.

A person installs a first copy by unzipping the archive into Applications; the app updates itself from then on.
