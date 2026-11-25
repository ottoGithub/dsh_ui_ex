#!/usr/bin/env node
/**
 * Validate the repository before installing or committing.
 *
 * Checks, in order:
 * 1. the browser artifact is up to date with `src/client/**`,
 * 2. every JSON file parses,
 * 3. the generated `client.js` parses as JavaScript,
 * 4. every Host feature module imports cleanly and declares an `id`,
 * 5. Host and Client feature ids match one-to-one,
 * 6. the RPC route literal is identical in both halves,
 * 7. the patch inserts exactly the documented row and names an existing package.
 *
 * Usage: node scripts/check.mjs
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = join(repoRoot, 'packages', 'dsh-ui-ex')

let failures = 0

/**
 * Record one check outcome.
 * @param ok - whether the check passed.
 * @param label - what was checked.
 * @param detail - failure detail.
 */
function check(ok, label, detail = '') {
  if (ok) {
    console.log(`ok   ${label}`)
    return
  }
  failures += 1
  console.log(`FAIL ${label}${detail === '' ? '' : `: ${detail}`}`)
}

/**
 * Read and parse one JSON file.
 * @param path - absolute path.
 * @returns the parsed value.
 */
async function readJson(path) {
  return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''))
}

/**
 * List the `.js` files of one directory, sorted.
 * @param directory - absolute path.
 * @returns file names.
 */
async function listModules(directory) {
  return (await readdir(directory, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
    .map(entry => entry.name)
    .sort()
}

// 1. artifact freshness — ask the build script's own `--check` mode
{
  const { execFile } = await import('node:child_process')
  const buildScript = join(repoRoot, 'scripts', 'build.mjs')
  const result = await new Promise(resolve => {
    execFile(process.execPath, [buildScript, '--check'], { cwd: repoRoot }, (error, stdout, stderr) => {
      resolve({ error, stdout, stderr })
    })
  })
  check(
    result.error === null,
    'client.js is rebuilt from src/client/**',
    `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  )
}

// 2. JSON files
const jsonFiles = [
  join(repoRoot, 'package.json'),
  join(packageRoot, 'package.json'),
  join(packageRoot, 'locale', 'en.json'),
  join(packageRoot, 'locale', 'zh.json'),
]
for (const file of jsonFiles) {
  try {
    await readJson(file)
    check(true, `${relative(repoRoot, file)} parses`)
  } catch (error) {
    check(false, `${relative(repoRoot, file)} parses`, error instanceof Error ? error.message : String(error))
  }
}

// 3. artifact syntax
const artifactPath = join(packageRoot, 'client.js')
const artifact = await readFile(artifactPath, 'utf8')
try {
  new Function(artifact)
  check(true, 'client.js parses as JavaScript')
} catch (error) {
  check(false, 'client.js parses as JavaScript', error instanceof Error ? error.message : String(error))
}

// 4. Host feature modules import and declare ids
const hostFeatureDir = join(packageRoot, 'src', 'host', 'features')
const hostFeatureIds = new Set()
for (const name of await listModules(hostFeatureDir)) {
  try {
    const module = await import(pathToFileURL(join(hostFeatureDir, name)).href)
    if (typeof module.id !== 'string' || module.id === '') throw new Error('missing id export')
    if (typeof module.setup !== 'function') throw new Error('missing setup export')
    hostFeatureIds.add(module.id)
    check(true, `host feature ${name} (id: ${module.id})`)
  } catch (error) {
    check(false, `host feature ${name}`, error instanceof Error ? error.message : String(error))
  }
}

// 5. Client feature ids match the Host ids
const clientFeatureDir = join(packageRoot, 'src', 'client', 'features')
const clientFeatureIds = new Set()
for (const name of await listModules(clientFeatureDir)) {
  const source = await readFile(join(clientFeatureDir, name), 'utf8')
  const match = /uiEx\.define\(\{[\s\S]*?\bid:\s*'([^']+)'/u.exec(source)
  if (match === null) {
    check(false, `client feature ${name} declares an id`)
    continue
  }
  clientFeatureIds.add(match[1])
}
const missingClient = [...hostFeatureIds].filter(id => !clientFeatureIds.has(id))
const missingHost = [...clientFeatureIds].filter(id => !hostFeatureIds.has(id))
check(
  missingClient.length === 0 && missingHost.length === 0,
  `feature ids line up (host ${hostFeatureIds.size}, client ${clientFeatureIds.size})`,
  `host-only: [${missingClient.join(', ')}] client-only: [${missingHost.join(', ')}]`,
)

// 6. route literal parity
{
  const hostRuntime = await readFile(join(packageRoot, 'src', 'host', 'runtime.js'), 'utf8')
  const entry = await readFile(join(packageRoot, 'src', 'client', 'entry.js'), 'utf8')
  const hostRoute = /export const ROUTE = '([^']+)'/u.exec(hostRuntime)?.[1]
  const clientRoute = /const ROUTE = '([^']+)'/u.exec(entry)?.[1]
  check(hostRoute !== undefined && hostRoute === clientRoute, `route parity (${hostRoute ?? 'missing'})`, `client: ${clientRoute ?? 'missing'}`)
}

// 7. patch and icon
{
  const patch = await readFile(join(packageRoot, 'cordis.patch.yml'), 'utf8')
  const manifest = await readJson(join(packageRoot, 'package.json'))
  check(patch.includes(`name: '${manifest.name}'`), 'patch inserts the package name')
  for (const featureId of hostFeatureIds) {
    check(patch.includes(`${featureId}:`), `patch switches feature ${featureId}`)
  }
  const iconPath = join(packageRoot, manifest.exports['./icon'])
  try {
    const icon = await readFile(iconPath, 'utf8')
    check(icon.trimStart().startsWith('<svg') && icon.trimEnd().endsWith('</svg>'), 'icon.svg is a single svg root')
    const size = (await stat(iconPath)).size
    check(size <= 256 * 1024, 'icon.svg within the 256 KiB limit', `${size} bytes`)
  } catch (error) {
    check(false, 'icon.svg exists', error instanceof Error ? error.message : String(error))
  }
  check(typeof manifest.dsh?.bundle?.patch === 'string', 'manifest declares dsh.bundle.patch')
  check(manifest.dsh?.client?.platform === 'web', 'manifest declares dsh.client.platform')
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
