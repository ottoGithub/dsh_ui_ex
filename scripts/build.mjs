#!/usr/bin/env node
/**
 * Assemble the two generated artifacts.
 *
 * 1. `packages/dsh-ui-ex/client.js` — the browser half. A DSH client plugin is
 *    one script: `window.__ModuleLoader__.load` runs a factory, and that factory
 *    cannot import sibling files at runtime. The build therefore concatenates
 *    `src/client/shared/*.js` then `src/client/features/*.js` inside the wrapper
 *    from `src/client/entry.js`. No bundler, no dependencies.
 * 2. `packages/dsh-ui-ex/src/host/features.generated.js` — the Host feature
 *    table. Node resolves relative imports at load time, but it cannot list a
 *    directory, so this file imports every `src/host/features/*.js` module and
 *    exports them in file-name order.
 *
 * Adding a feature is therefore: write one Host module, write one Client module,
 * run this script. Nothing else registers anything.
 *
 * Usage: node scripts/build.mjs [--check]
 * `--check` writes nothing and exits 1 when an artifact is stale.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = join(repoRoot, 'packages', 'dsh-ui-ex')
const clientRoot = join(packageRoot, 'src', 'client')
const hostFeatureDir = join(packageRoot, 'src', 'host', 'features')

const CLIENT_OUTPUT = join(packageRoot, 'client.js')
const HOST_TABLE_OUTPUT = join(packageRoot, 'src', 'host', 'features.generated.js')

const SHARED_MARKER = '    /* __UI_EX_SHARED__ */'
const FEATURES_MARKER = '    /* __UI_EX_FEATURES__ */'

/**
 * List the `.js` files of one directory, sorted by name.
 * @param directory - absolute path.
 * @returns file names.
 */
async function listModules(directory) {
  return (await readdir(directory, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
    .map(entry => entry.name)
    .sort()
}

/**
 * Read every module of one directory with its source, sorted by name.
 * @param directory - absolute path.
 * @returns `{ name, source }` entries.
 */
async function readModules(directory) {
  const modules = []
  for (const name of await listModules(directory)) {
    modules.push({ name, source: await readFile(join(directory, name), 'utf8') })
  }
  return modules
}

/**
 * Wrap one module body with a source banner so generated code stays readable.
 * @param label - source path shown in the banner.
 * @param source - file contents.
 * @returns the block to splice into an artifact.
 */
function block(label, source) {
  return `    // ---- ${label} ----\n${source.replace(/\r\n/gu, '\n').trimEnd()}\n`
}

/**
 * Compose the browser artifact.
 * @returns the complete `client.js` contents.
 */
async function composeClient() {
  const template = await readFile(join(clientRoot, 'entry.js'), 'utf8')
  if (!template.includes(SHARED_MARKER) || !template.includes(FEATURES_MARKER)) {
    throw new Error('src/client/entry.js lost one of its build markers')
  }
  const shared = await readModules(join(clientRoot, 'shared'))
  const features = await readModules(join(clientRoot, 'features'))
  if (shared.length === 0) throw new Error('no client shared modules found')
  if (features.length === 0) throw new Error('no client feature modules found')
  const header = [
    '/**',
    ' * GENERATED FILE — do not edit.',
    ' *',
    ' * Assembled by `node scripts/build.mjs` from `packages/dsh-ui-ex/src/client/`.',
    ' * Edit the sources there and rebuild; `node scripts/check.mjs` fails on a stale artifact.',
    ' */',
    '',
  ].join('\n')
  return header + template
    .replace(SHARED_MARKER, shared.map(module => block(`src/client/shared/${module.name}`, module.source)).join('\n').trimEnd())
    .replace(FEATURES_MARKER, features.map(module => block(`src/client/features/${module.name}`, module.source)).join('\n').trimEnd())
}

/**
 * Compose the Host feature table.
 * @returns the complete `features.generated.js` contents.
 */
async function composeHostTable() {
  const names = await listModules(hostFeatureDir)
  if (names.length === 0) throw new Error('no host feature modules found')
  const imports = names
    .map((name, index) => `import * as feature${index} from './features/${name}'`)
    .join('\n')
  const entries = names.map((name, index) => `  feature${index}, // ${name}`).join('\n')
  return [
    '/**',
    ' * GENERATED FILE — do not edit.',
    ' *',
    " * Assembled by `node scripts/build.mjs` from `src/host/features/*.js`.",
    ' */',
    '',
    imports,
    '',
    '/** Every Host feature module, in file-name order. */',
    'export const FEATURES = [',
    entries,
    ']',
    '',
  ].join('\n')
}

/**
 * Read a file, treating a missing file as empty content.
 * @param path - absolute path.
 * @returns file contents.
 */
async function readOrEmpty(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

const checkOnly = process.argv.includes('--check')
const artifacts = [
  { path: CLIENT_OUTPUT, content: await composeClient() },
  { path: HOST_TABLE_OUTPUT, content: await composeHostTable() },
]

let stale = 0
for (const artifact of artifacts) {
  const previous = await readOrEmpty(artifact.path)
  const label = relative(repoRoot, artifact.path)
  if (previous === artifact.content) {
    if (!checkOnly) console.log(`up to date  ${label}`)
    continue
  }
  if (checkOnly) {
    console.error(`stale       ${label}`)
    stale += 1
    continue
  }
  await writeFile(artifact.path, artifact.content, 'utf8')
  console.log(`wrote       ${label} (${artifact.content.length} bytes)`)
}

if (checkOnly) {
  if (stale > 0) {
    console.error('run "node scripts/build.mjs" to regenerate')
    process.exit(1)
  }
  console.log('both artifacts are up to date')
}
