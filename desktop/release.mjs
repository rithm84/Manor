#!/usr/bin/env node
/**
 * Builds a signed Manor bundle and publishes it as the update feed.
 *
 * Usage: `node release.mjs --env production|staging [--allow-dirty]`.
 *
 * A release is one signed `.app.tar.gz`, its minisign signature, and the
 * `latest.json` that points the updater at both. Production publishes a new
 * tag per version and marks it latest, so the feed URL that ends in
 * `releases/latest/download/latest.json` follows it. Staging replaces the
 * assets of the single rolling `staging` prerelease. The archive is also what a
 * person downloads to install Manor by hand.
 *
 * The signing key never enters this process: `TAURI_SIGNING_PRIVATE_KEY` takes
 * either a key or a path to one, so this script passes the path and the Tauri
 * command line interface reads the key itself. Only the password is read here,
 * from the repository root `.env.local`.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const DESKTOP_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const REPOSITORY_ROOT = join(DESKTOP_DIRECTORY, '..')
const BUNDLE_DIRECTORY = join(DESKTOP_DIRECTORY, 'target', 'release', 'bundle', 'macos')
const REPOSITORY = 'rithm84/Manor'
const SIGNING_KEY_PATH = join(homedir(), '.tauri', 'manor.key')
const PASSWORD_VARIABLE = 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD'
const ENVIRONMENT_FILE = join(REPOSITORY_ROOT, '.env.local')

/** The one platform Manor ships, as the updater names it. */
const UPDATER_PLATFORM = 'darwin-aarch64'

/** What each environment builds, what it publishes, and where its feed lives. */
const ENVIRONMENTS = {
  production: {
    productName: 'Manor',
    configuration: null,
    prerelease: false,
    tagFor: (version) => `v${version}`,
    titleFor: (version) => `Manor ${version}`,
    notesFor: (version) => `Manor ${version} for macOS.`
  },
  staging: {
    productName: 'Manor Staging',
    configuration: 'tauri.staging.conf.json',
    prerelease: true,
    tagFor: () => 'staging',
    titleFor: () => 'Manor Staging',
    notesFor: () => 'Rolling staging build'
  }
}

/**
 * Reads the command line into the two choices this script offers.
 *
 * @param {string[]} argv Arguments after the script path.
 * @returns {{ environment: 'production' | 'staging', allowDirty: boolean }}
 */
function parseCommandLine(argv) {
  let values
  try {
    ;({ values } = parseArgs({
      args: argv,
      strict: true,
      options: { env: { type: 'string' }, 'allow-dirty': { type: 'boolean' } }
    }))
  } catch (cause) {
    throw new Error(`${cause.message}. Usage: node release.mjs --env production|staging [--allow-dirty].`)
  }
  if (values.env === undefined) {
    throw new Error('Name the environment: node release.mjs --env production, or --env staging.')
  }
  if (values.env !== 'production' && values.env !== 'staging') {
    throw new Error(`Unknown environment "${values.env}". Use --env production or --env staging.`)
  }
  return { environment: values.env, allowDirty: values['allow-dirty'] === true }
}

/**
 * Stops a release that would not match any commit.
 *
 * @param {boolean} allowDirty Whether the caller accepted an uncommitted tree.
 * @returns {void}
 */
function assertReleasableTree(allowDirty) {
  const changes = run('git', ['status', '--porcelain'], REPOSITORY_ROOT).trim()
  if (changes === '' || allowDirty) return
  const summary = changes.split('\n').slice(0, 10).join('\n')
  throw new Error(
    `The working tree has uncommitted changes, so the release would not match any commit. Commit them, or pass --allow-dirty to release anyway.\n${summary}`
  )
}

/**
 * Reads the version the whole product shares.
 *
 * @returns {string} The `version` field of `app/package.json`.
 */
function readVersion() {
  const manifestPath = join(REPOSITORY_ROOT, 'app', 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (typeof manifest.version !== 'string' || manifest.version === '') {
    throw new Error(`${manifestPath} has no "version", which is the version every desktop build carries.`)
  }
  return manifest.version
}

/**
 * Reads the signing key password from the repository root `.env.local`.
 *
 * Only that one line is parsed, and the value is never printed or logged.
 *
 * @returns {string} The password that unlocks `~/.tauri/manor.key`.
 */
function readSigningPassword() {
  let contents
  try {
    contents = readFileSync(ENVIRONMENT_FILE, 'utf8')
  } catch (cause) {
    throw new Error(`Could not read ${ENVIRONMENT_FILE}, which holds ${PASSWORD_VARIABLE}: ${cause.message}`)
  }
  const line = contents.split('\n').find((candidate) => candidate.trimStart().startsWith(`${PASSWORD_VARIABLE}=`))
  if (line === undefined) {
    throw new Error(`${ENVIRONMENT_FILE} has no ${PASSWORD_VARIABLE} line, so the signing key cannot be unlocked.`)
  }
  const password = line.slice(line.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2')
  if (password === '') {
    throw new Error(`${PASSWORD_VARIABLE} in ${ENVIRONMENT_FILE} is empty, and the signing key is password protected.`)
  }
  return password
}

/**
 * Builds the signed bundle for one environment.
 *
 * @param {typeof ENVIRONMENTS.production} target The environment definition.
 * @param {string} password The signing key password.
 * @returns {void}
 */
function buildBundle(target, password) {
  try {
    statSync(SIGNING_KEY_PATH)
  } catch (cause) {
    throw new Error(`No signing key at ${SIGNING_KEY_PATH}, so the update could not be signed: ${cause.message}`)
  }
  const args = ['tauri', 'build']
  if (target.configuration !== null) args.push('--config', target.configuration)
  execFileSync('npx', args, {
    cwd: DESKTOP_DIRECTORY,
    stdio: 'inherit',
    env: {
      ...process.env,
      TAURI_SIGNING_PRIVATE_KEY: SIGNING_KEY_PATH,
      [PASSWORD_VARIABLE]: password
    }
  })
}

/**
 * Finds the archive and signature the build just wrote.
 *
 * A file older than the build means this build produced no updater artifact,
 * usually because `bundle.createUpdaterArtifacts` was turned off, and
 * publishing the leftover would ship a signature for the wrong version.
 *
 * @param {string} productName Bundle name, such as `Manor Staging`.
 * @param {number} builtAfter Epoch milliseconds the build started at.
 * @returns {{ archive: string, signature: string }} Absolute paths.
 */
function locateArtifacts(productName, builtAfter) {
  const archive = join(BUNDLE_DIRECTORY, `${productName}.app.tar.gz`)
  const signature = `${archive}.sig`
  for (const path of [archive, signature]) {
    let stats
    try {
      stats = statSync(path)
    } catch (cause) {
      throw new Error(
        `The build wrote no ${path}. Check that bundle.createUpdaterArtifacts is true in the configuration it used: ${cause.message}`
      )
    }
    if (stats.mtimeMs < builtAfter) {
      throw new Error(`${path} is left over from an earlier build, so it does not match this version. Delete it and release again.`)
    }
  }
  return { archive, signature }
}

/**
 * Returns the name GitHub gives an uploaded asset.
 *
 * GitHub rewrites every character outside letters, digits, dots, hyphens, and
 * underscores as a dot, so `Manor Staging.app.tar.gz` is served as
 * `Manor.Staging.app.tar.gz` and the feed has to name it that way.
 *
 * @param {string} path Absolute path of the file being uploaded.
 * @returns {string} The asset name on the release.
 */
function assetName(path) {
  return basename(path).replace(/[^A-Za-z0-9.\-_]/g, '.')
}

/**
 * Writes the `latest.json` the updater reads.
 *
 * @param {{ version: string, notes: string, tag: string, archive: string, signature: string }} release Release details.
 * @returns {string} Path of the written feed file.
 */
function writeFeed(release) {
  const url = `https://github.com/${REPOSITORY}/releases/download/${release.tag}/${assetName(release.archive)}`
  const feed = {
    version: release.version,
    notes: release.notes,
    pub_date: new Date().toISOString(),
    platforms: {
      [UPDATER_PLATFORM]: { signature: readFileSync(release.signature, 'utf8').trim(), url }
    }
  }
  const path = join(BUNDLE_DIRECTORY, 'latest.json')
  writeFileSync(path, `${JSON.stringify(feed, null, 2)}\n`)
  return path
}

/**
 * Reports whether the repository already has a release on this tag.
 *
 * @param {string} tag The release tag.
 * @returns {boolean} True when GitHub already serves that release.
 */
function releaseExists(tag) {
  try {
    run('gh', ['release', 'view', tag, '--repo', REPOSITORY, '--json', 'tagName'], DESKTOP_DIRECTORY)
    return true
  } catch (cause) {
    if (cause.message.includes('release not found')) return false
    throw cause
  }
}

/**
 * Publishes the assets, creating the release when the environment needs one.
 *
 * @param {typeof ENVIRONMENTS.production} target The environment definition.
 * @param {{ version: string, tag: string, assets: string[] }} release Release details.
 * @returns {void}
 */
function publish(target, release) {
  const exists = releaseExists(release.tag)
  if (target.prerelease) {
    if (!exists) {
      run('gh', [
        'release', 'create', release.tag,
        '--repo', REPOSITORY,
        '--prerelease',
        '--title', target.titleFor(release.version),
        '--notes', target.notesFor(release.version)
      ], DESKTOP_DIRECTORY)
    }
    run('gh', ['release', 'upload', release.tag, '--repo', REPOSITORY, '--clobber', ...release.assets], DESKTOP_DIRECTORY)
    return
  }
  if (exists) {
    throw new Error(
      `The ${release.tag} release already exists, and a published version is never replaced. Raise "version" in app/package.json and release again.`
    )
  }
  run('gh', [
    'release', 'create', release.tag,
    '--repo', REPOSITORY,
    '--title', target.titleFor(release.version),
    '--notes', target.notesFor(release.version),
    '--latest',
    ...release.assets
  ], DESKTOP_DIRECTORY)
}

/**
 * Checks that GitHub named each asset the way the feed expects.
 *
 * @param {string} tag The release tag.
 * @param {string[]} expected Asset names the feed and the updater depend on.
 * @returns {void}
 */
function assertAssetNames(tag, expected) {
  const published = JSON.parse(
    run('gh', ['release', 'view', tag, '--repo', REPOSITORY, '--json', 'assets'], DESKTOP_DIRECTORY)
  ).assets.map((asset) => asset.name)
  const missing = expected.filter((name) => !published.includes(name))
  if (missing.length > 0) {
    throw new Error(
      `The ${tag} release serves ${published.join(', ')}, but the feed points at ${missing.join(', ')}. Rename the assets or fix latest.json before anyone updates.`
    )
  }
}

/**
 * Runs a command and returns its standard output.
 *
 * A failure becomes an error carrying the command line and whatever the command
 * wrote to standard error, so the caller reports what actually went wrong.
 *
 * @param {string} command Executable name.
 * @param {string[]} args Arguments.
 * @param {string} cwd Working directory.
 * @returns {string} What the command wrote to standard output.
 */
function run(command, args, cwd) {
  try {
    return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (cause) {
    const details = typeof cause.stderr === 'string' && cause.stderr.trim() !== '' ? cause.stderr.trim() : cause.message
    throw new Error(`${command} ${args.join(' ')} failed: ${details}`)
  }
}

/**
 * Builds, signs, and publishes one release.
 *
 * @returns {void}
 */
function main() {
  const { environment, allowDirty } = parseCommandLine(process.argv.slice(2))
  const target = ENVIRONMENTS[environment]
  assertReleasableTree(allowDirty)
  const version = readVersion()
  const tag = target.tagFor(version)
  const notes = target.notesFor(version)
  const startedAt = Date.now()
  buildBundle(target, readSigningPassword())
  const { archive, signature } = locateArtifacts(target.productName, startedAt)
  const feed = writeFeed({ version, notes, tag, archive, signature })
  const assets = [archive, signature, feed]
  publish(target, { version, tag, assets })
  assertAssetNames(tag, assets.map(assetName))
  console.log(`Published ${target.productName} ${version} to the ${tag} release of ${REPOSITORY}.`)
  console.log(`Assets: ${assets.map(assetName).join(', ')}`)
  console.log(`Release: https://github.com/${REPOSITORY}/releases/tag/${tag}`)
}

try {
  main()
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
