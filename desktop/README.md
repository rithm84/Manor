# Manor desktop shell

_Last updated: 2026-09-13_

This package is the Tauri 2 shell that makes Manor a macOS app. The Rust
crate owns only the native shell: window creation, deep-link receipt,
single-instance forwarding, external links, window-state persistence, file
logging, and the signed update that replaces the app in place. The React
frontend in [`app/`](../app/README.md) is compiled into the bundle, so the app
starts from local files and needs the network only for its Supabase backend and
the update feed.

## Prerequisites

- A stable Rust toolchain, 1.77.2 or newer, from `brew install rust` or
  [rustup](https://rustup.rs).
- The Xcode command line tools, which supply the linker and the macOS SDK.
- Node.js, plus the frontend dependencies from `npm --prefix app ci`.
- The GitHub command line interface, `gh`, signed in to an account that can
  publish releases on `rithm84/Manor`. Only the release scripts need it.
- The signing key at `~/.tauri/manor.key`, which every bundle needs. See the
  [Updates](#updates) section.

Install this package's own dependency, the Tauri command line interface, with
`npm --prefix desktop install`.

## Environment files and modes

The desktop build reuses the frontend's environment files, which stay out of
version control. Each one holds `VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_MANOR_WEB_ORIGIN`.

| Script | Vite mode | Environment file |
| --- | --- | --- |
| `build` | production, the default | `app/.env.production` |
| `build:staging` | `staging` | `app/.env.staging` |
| `dev` | development | `app/.env.local` |

Each Supabase environment pairs with exactly one desktop identity, so a staging
build never signs in against production data.

## Commands

Run these from the repository root:

```sh
npm --prefix desktop install
npm --prefix desktop run dev
npm --prefix desktop run build
npm --prefix desktop run build:staging
npm --prefix desktop run check
npm --prefix desktop run fmt
npm --prefix desktop run lint
npm --prefix desktop run test
npm --prefix desktop run icon
npm --prefix desktop run release
npm --prefix desktop run release:staging
```

`dev` starts the Vite development server and opens a window against it, which
suits unauthenticated interface work with hot reloading. Sign in needs a bundled
app, so test that against a staging bundle instead. Append `-- --debug` to either
build script to keep debug symbols and skip the release optimizer. `check` runs
`cargo check`, `fmt` checks formatting, `lint` runs `cargo clippy` with warnings
promoted to errors, and `test` checks that each configuration file exposes the
URL scheme the frontend asks the shell for. `release` and `release:staging`
build a signed bundle and publish it as the update feed, which the
[Updates](#updates) section describes.

The Tauri command line interface reads `tauri.conf.json` from the current
directory, so every script runs from `desktop/` and this project has no
`src-tauri` directory. The same directory is the working directory for
`beforeBuildCommand` and `beforeDevCommand`, which is why both reach the
frontend as `npm --prefix ../app`.

## What a build produces

A release build writes `target/release/bundle/macos/Manor.app`, the update
archive `Manor.app.tar.gz` beside it, and the archive's signature
`Manor.app.tar.gz.sig`. Adding `-- --debug` writes the same three files under
`target/debug/bundle/macos/`, and the staging script names them after
`Manor Staging.app`. Every bundle needs the signing key in its environment,
which the [Updates](#updates) section covers.

No bundle carries an Apple developer signature or notarization. A bundle built
on this machine opens normally, and so does one the updater installs, because
the updater extracts the archive itself. A copy that a browser downloaded
carries the quarantine flag, and macOS reports an unsigned quarantined app as
damaged rather than offering to open it; the [Installing by hand](#installing-by-hand)
section shows the install that avoids the flag. The signature next to the
archive is a different thing: the updater checks it, and Gatekeeper never sees
it.

To install a build, drag the bundle to `/Applications`. Keep the copy you use
outside `target/`, which the next build replaces, and which Launch Services
treats as a moving target when it resolves URL schemes.

## Staging and production identities

| | Production | Staging |
| --- | --- | --- |
| Name | `Manor` | `Manor Staging` |
| Identifier | `app.manor.desktop` | `app.manor.desktop.staging` |
| URL scheme | `manor://` | `manor-staging://` |
| Configuration | `tauri.conf.json` | plus `tauri.staging.conf.json` |

`tauri.staging.conf.json` is a merge patch over `tauri.conf.json`. Arrays in a
merge patch replace rather than combine, so the overlay restates each array it
changes: it carries the product name, the identifier, the frontend build
command, the scheme, and the staging update feed, and it leaves the window
definition and the updater public key alone, which it inherits. The shell sets
the window title from the package name at startup, which keeps the two
identities apart in the window menu.

Separate identifiers give the two apps separate WebKit data stores and separate
log directories, so you can install both at once. Separate schemes stop Launch
Services from handing a production sign-in to the staging app.

## Deep links

A URL of the form `<scheme>://<host><path>` arrives in the frontend as the app
route `/<host><path>`, which is how sign-in returns from the system browser and
how a connection callback reaches Settings. macOS routes a custom scheme only to
a bundled, registered application, so deep links do not work under `dev`. Test
them against a staging bundle that Launch Services knows about.

The shell never logs a deep link's query or fragment, because they carry the
authorization code and the session tokens.

## Logging

The shell appends to `~/Library/Logs/<identifier>/manor.log`, rotating at 2 MiB
and keeping one file. Debug builds write the same lines to standard output. A
line that carries structured fields ends with them as `key=value` pairs, with a
value quoted when it holds a space, a quote, or an equals sign.

## Content security policy

`app.security.csp` in `tauri.conf.json` starts from `default-src 'self'` and
widens only where the app needs it. Tauri adds the hash of the theme script in
`app/index.html` and a nonce for styles when it builds, so `script-src` stays at
`'self'`. Each remaining directive earns its place:

- `style-src 'self' 'unsafe-inline'`: the note editor, the charts, and the theme
  layer set inline styles and inject stylesheets while the app runs. Tauri also
  appends a nonce for the styles it injects, so the header the webview sees is
  `'self' 'unsafe-inline' 'nonce-…'`; the strict reading of CSP level 3 lets a
  nonce cancel `'unsafe-inline'`, and the app relies on WebKit keeping both.
- `img-src 'self' https: data: blob:`: note images and profile pictures load
  from Supabase storage and from Google over HTTPS, and local previews are
  `blob:` or `data:` URLs.
- `media-src 'self' https: data: blob:`: audio and video attachments load the same
  way, and the checkbox tap recording is small enough that Vite inlines it as a
  `data:` URL.
- `font-src 'self' data:`: the bundled font files, plus the math fonts that
  arrive as data URLs.
- `connect-src 'self' ipc: http://ipc.localhost https://*.supabase.co
  wss://*.supabase.co`: `ipc:` and `http://ipc.localhost` are the channels the
  webview uses to call the shell, and the rest covers Supabase REST, storage,
  Edge Functions, and realtime traffic.
- `frame-src https:`: the note editor embeds web pages in an iframe.
- `worker-src 'self' blob:`: the file checksum worker runs from the bundle, and
  a bundler may hand it to the page as a `blob:` URL.
- `object-src 'none'`, `base-uri 'self'`, and `form-action 'self'` close off
  plugins, base-tag rewriting, and form posts, none of which the app uses.

If a build blocks something the app legitimately needs, widen that one directive
and record the reason in this list.

## Icons

`icons/manor-icon-1024.png` is the source tile: the Manor mark in white, 674 px
wide and centered on an opaque `#805096` square. `npm --prefix desktop run icon`
regenerates
`icons/icon.icns` from it. The repository keeps only those two files, because
`tauri icon` also writes Windows, Linux, iOS, and Android artifacts that this
project does not ship. The tile stays in `bundle.icon` next to the `.icns`
because Tauri's code generation needs a PNG for the default window icon on
macOS, even though the bundle ships only the `.icns`. macOS applies its own
rounded mask, so the tile is full bleed.

## Updates

Manor updates itself. `tauri-plugin-updater` reads a release feed and installs a
signed archive, and `tauri-plugin-process` restarts the app afterwards, because
macOS runs a replaced bundle only on the next launch. The frontend checks when
it starts, every hour after that, whenever the window regains focus following an
idle hour, and when the machine comes back online. A waiting release becomes a
notice that names the version and offers to restart, and the restart waits while
a dialog is open or a note edit is still being saved. The shell makes the check
and the download from Rust rather than from the webview, so the content security
policy needs no entry for GitHub.

Each identity reads its own feed from the public `rithm84/Manor` repository:

| | Production | Staging |
| --- | --- | --- |
| Feed | `releases/latest/download/latest.json` | `releases/download/staging/latest.json` |
| Release | `v<version>`, marked as the latest release | `staging`, one rolling prerelease |

Production reads whichever release carries the latest marker, so publishing a
new version takes the feed over. Staging keeps one prerelease named `staging`
and replaces its assets on every run. A `dev` window uses `tauri.conf.json`, so
it watches the production feed and offers an update only when the published
version is higher than the one in `app/package.json`.

### Signing

An installed app accepts an update only when the archive carries a signature
from the Manor signing key. The private key lives outside the repository at
`~/.tauri/manor.key`, and its password is `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
in the repository root `.env.local`. The matching public key is
`plugins.updater.pubkey` in both configuration files. An installed app trusts
only the key it shipped with, so back up the key and its password: replacing
either one means everyone reinstalls by hand.

Because the archive is part of every bundle, a build without the key writes the
app and then stops with `A public key has been found, but no private key`.
Export the key path and the password to build a bundle yourself:

```sh
export TAURI_SIGNING_PRIVATE_KEY=~/.tauri/manor.key
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<the password from .env.local>
npm --prefix desktop run build:staging -- --debug
```

`TAURI_SIGNING_PRIVATE_KEY` takes either a key or a path to one, and the release
scripts pass the path. On a machine without the key, leave the archive out of
that build instead:

```sh
npm --prefix desktop run build:staging -- --debug --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

### Publishing a release

```sh
npm --prefix desktop run release
npm --prefix desktop run release:staging
```

Each script builds the bundle with the signing key in its environment, takes the
version from `app/package.json`, writes `latest.json` beside the archive, and
publishes the archive, the signature, and the feed with `gh`. Production creates
the tag `v<version>`, titles the release `Manor <version>`, and marks it the
latest release. It refuses to run when that tag already exists, because a
published version is never replaced, so raise the version in `app/package.json`
first. Staging creates the `staging` prerelease the first time and replaces its
assets after that.

Both scripts refuse to run against a tree with uncommitted changes, since the
published build would match no commit. Add `--allow-dirty` to release from one
anyway, which suits trying the flow rather than shipping:

```sh
npm --prefix desktop run release:staging -- --allow-dirty
```

GitHub rewrites a space in an asset name as a dot, so the staging archive is
served as `Manor.Staging.app.tar.gz`. The script writes that name into
`latest.json`, then reads the published release back and stops if an asset the
feed points at is missing.

### Installing by hand

The archive the updater downloads is also the download for a new machine. A
browser download carries the quarantine flag, which macOS turns into a
"damaged" dialog for an unsigned app, so fetch and expand the archive from a
terminal instead, which sets no flag:

```sh
curl -sSL -o /tmp/Manor.app.tar.gz https://github.com/rithm84/Manor/releases/latest/download/Manor.app.tar.gz
tar -xzf /tmp/Manor.app.tar.gz -C /Applications
```

If you already expanded a browser download, clear the flag with
`xattr -dr com.apple.quarantine /Applications/Manor.app`. From then on the app
updates itself.
