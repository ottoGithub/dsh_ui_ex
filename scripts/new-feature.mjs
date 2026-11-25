#!/usr/bin/env node
/**
 * Scaffold one feature.
 *
 * Usage: node scripts/new-feature.mjs <id> "<中文标题>" "<English title>"
 *   node scripts/new-feature.mjs sidebar-clock "侧栏时钟" "Sidebar clock"
 *
 * Writes `src/host/features/<id>.js` and `src/client/features/<id>.js` from the
 * templates below, adds the feature's switch to `cordis.patch.yml`, and rebuilds
 * the two generated artifacts. Existing files are never overwritten.
 */
import { execFile } from 'node:child_process'
import { access, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = join(repoRoot, 'packages', 'dsh-ui-ex')
const patchFile = join(packageRoot, 'cordis.patch.yml')

const [, , rawId, zhTitle = '新功能', enTitle = 'New feature'] = process.argv

/**
 * Normalize the requested id into a feature key.
 * @param value - raw command-line id.
 * @returns kebab-case id.
 */
function normalizeId(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
}

const id = normalizeId(rawId)
if (id === '') {
  console.error('usage: node scripts/new-feature.mjs <id> "<中文标题>" "<English title>"')
  process.exit(2)
}

const hostFile = join(packageRoot, 'src', 'host', 'features', `${id}.js`)
const clientFile = join(packageRoot, 'src', 'client', 'features', `${id}.js`)

/**
 * Fail with a clear message when a path already exists.
 * @param path - absolute file path.
 */
async function assertAbsent(path) {
  try {
    await access(path)
  } catch {
    return
  }
  console.error(`refusing to overwrite ${path}`)
  process.exit(1)
}

await assertAbsent(hostFile)
await assertAbsent(clientFile)

const hostSource = `/**
 * Feature: ${enTitle} (Host half).
 *
 * Host halves own what the browser cannot do: files, processes, durable state,
 * and the Session or Workspace registries. Every op in the returned \`rpc\`
 * object is reachable from the browser half as \`api.rpc('<op>', payload)\`.
 *
 * @module ui-ex/host/features/${id}
 */

export const id = '${id}'

/** Switches and options a profile patch may override. */
export const defaults = {
  enabled: true,
}

/**
 * Activate the feature.
 * @param ctx - Host context.
 * @param api - suite api: \`options\`, \`state.read()\`, \`state.write(value)\`,
 *   \`packageRoot\`, \`warn\`.
 * @returns \`{ rpc?, dispose? }\`.
 */
export function setup(ctx, api) {
  api.warn('${id} is a scaffold and does nothing yet')
  return {
    rpc: {
      ping: () => ({ ok: true, id: '${id}' }),
    },
  }
}
`

const clientSource = `/**
 * Feature: ${enTitle} (browser half).
 *
 * Keep the browser half to slots, context menus, and rendering; ask the Host for
 * everything else through \`api.rpc\`. Register resources with \`ctx.effect\` or
 * \`api.onDispose\` so unloading the suite removes them.
 *
 * @module ui-ex/client/features/${id}
 */
uiEx.define({
  id: '${id}',
  // Dictionaries land under the \`ui-ex.${id}\` namespace; \`api.t('key')\` reads them.
  locales: {
    en: {
      title: ${JSON.stringify(enTitle)},
    },
    zh: {
      title: ${JSON.stringify(zhTitle)},
    },
  },
  setup(ctx, api) {
    // Prove the Host half answers, then replace this with the real UI.
    void api.rpc('ping').then(
      value => console.log('ui-ex: ${id} host says', value),
      error => api.warn(error instanceof Error ? error.message : String(error)),
    )
    return {}
  },
})
`

await writeFile(hostFile, hostSource, 'utf8')
await writeFile(clientFile, clientSource, 'utf8')

const patch = await readFile(patchFile, 'utf8')
if (!patch.includes(`${id}:`)) {
  const updated = patch.replace(
    /^(\s*)open-in-dsh: true$/mu,
    match => `${match}\n${match.match(/^\s*/u)[0]}${id}: true`,
  )
  if (updated === patch) {
    console.warn(`could not find the features block in ${patchFile}; add "${id}: true" by hand`)
  } else {
    await writeFile(patchFile, updated, 'utf8')
  }
}

console.log(`created src/host/features/${id}.js`)
console.log(`created src/client/features/${id}.js`)

const build = await new Promise(resolve => {
  execFile(process.execPath, [join(repoRoot, 'scripts', 'build.mjs')], { cwd: repoRoot }, (error, stdout, stderr) => {
    resolve({ error, stdout, stderr })
  })
})
process.stdout.write(build.stdout ?? '')
process.stderr.write(build.stderr ?? '')
if (build.error !== null) process.exit(1)
console.log('next: node scripts/check.mjs, then re-enable the "ui-ex" plugin row and refresh the page')
