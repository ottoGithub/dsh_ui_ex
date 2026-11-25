/**
 * Feature: open a folder from the Windows Explorer context menu.
 *
 * Two Host jobs:
 *
 * 1. Serve the per-user hand-off queue the Explorer launcher fills, so the
 *    browser half can turn one queued folder into an open Workspace.
 * 2. Register the Explorer menu without a manual step: when no verb exists yet
 *    and the user was never asked, run the bundled machine-scope installer once
 *    behind a single UAC prompt.
 *
 * The launcher the installer compiles (`dsh-open.exe`) only writes into
 * `%LOCALAPPDATA%\DeepSeekHarness\dsh-open` and starts the app; it never calls
 * this suite. Keep that directory stable across releases.
 *
 * @module ui-ex/host/features/open-in-dsh
 */
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

export const id = 'open-in-dsh'

/** Switches and options a profile patch may override. */
export const defaults = {
  enabled: true,
  /** Offer the one-time machine-scope menu registration when it is missing. */
  autoInstall: true,
  /** A queued hand-off older than this is dropped instead of opening a folder. */
  queueTtlHours: 24,
  /** Delay before a possible UAC prompt, so the window settles first. */
  autoInstallDelayMs: 4000,
}

/** At most this many queued files are inspected per call. */
const SCAN_LIMIT = 32

/** Explorer verbs from either scope; any one of them means the menu exists. */
const MENU_KEYS = [
  'HKCU\\Software\\Classes\\Directory\\shell\\DeepSeekHarness',
  'HKLM\\Software\\Classes\\Directory\\shell\\DeepSeekHarness',
]

/**
 * The per-user application data directory.
 * @returns absolute path of the local application data directory.
 */
function localAppData() {
  return process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
}

/**
 * The queue directory the Windows launcher writes into.
 * @returns absolute path of the per-user queue directory.
 */
export function queueDirectory() {
  return join(localAppData(), 'DeepSeekHarness', 'dsh-open')
}

/**
 * The record that an automatic installation was already offered, so a user who
 * declined the prompt is never asked again.
 * @returns absolute path of the marker file.
 */
function autoInstallMarker() {
  return join(localAppData(), 'DeepSeekHarness', 'shell-integration', 'auto-install.json')
}

/**
 * Take the oldest queued request, deleting it in the same step so one hand-off
 * opens at most one Workspace.
 * @param directory - queue directory to drain.
 * @param maxAgeMs - requests older than this are discarded.
 * @returns the requested folder, or undefined when the queue holds nothing usable.
 */
function takeRequest(directory, maxAgeMs) {
  let names
  try {
    names = readdirSync(directory).filter(entry => entry.endsWith('.json')).sort()
  } catch {
    return undefined
  }
  for (const name of names.slice(0, SCAN_LIMIT)) {
    const file = join(directory, name)
    try {
      if (Date.now() - statSync(file).mtimeMs > maxAgeMs) {
        rmSync(file, { force: true })
        continue
      }
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      rmSync(file, { force: true })
      if (typeof parsed?.path === 'string' && parsed.path.length > 0) return parsed.path
    } catch {
      try {
        rmSync(file, { force: true })
      } catch {
        // A file that cannot be removed is retried on the next poll.
      }
    }
  }
  return undefined
}

/**
 * Quote one value for a PowerShell single-quoted literal.
 * @param value - raw text.
 * @returns the literal, single quotes doubled.
 */
function powerShellLiteral(value) {
  return `'${String(value).replace(/'/gu, "''")}'`
}

/**
 * Whether one registry key exists.
 * @param key - full key path such as HKCU\Software\Classes\....
 * @returns true when `reg query` reports the key.
 */
function registryKeyExists(key) {
  return new Promise((resolve) => {
    execFile('reg.exe', ['query', key], { windowsHide: true }, (error) => {
      resolve(error === null)
    })
  })
}

/**
 * Whether any Explorer verb from install.ps1 is already registered.
 * @returns true when the context menu is installed for this user or machine.
 */
async function menuInstalled() {
  for (const key of MENU_KEYS) {
    if (await registryKeyExists(key)) return true
  }
  return false
}

/**
 * The running application executable, when the Host knows it.
 * @returns the DeepSeek Harness executable path, or undefined when unknown.
 */
function detectedAppPath() {
  const executable = process.execPath
  if (typeof executable !== 'string' || executable.length === 0) return undefined
  return basename(executable).toLowerCase() === 'deepseek harness.exe' ? executable : undefined
}

/**
 * Run the bundled installer at machine scope behind one UAC prompt and wait for
 * it to finish.
 * @param script - absolute path of the bundled install.ps1.
 * @returns the installer exit code; 1223 means the prompt was cancelled.
 */
function runElevatedInstaller(script) {
  const argumentsList = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Scope', 'Machine']
  const appPath = detectedAppPath()
  if (appPath !== undefined) argumentsList.push('-AppPath', appPath)
  const command = [
    "$ErrorActionPreference = 'Stop'",
    'try {',
    `  $installer = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe') -ArgumentList @(${argumentsList.map(powerShellLiteral).join(', ')}) -Verb RunAs -Wait -PassThru`,
    '  exit $installer.ExitCode',
    '} catch { exit 1223 }',
  ].join('\n')
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      windowsHide: true,
      stdio: 'ignore',
    })
    child.on('error', () => resolve(-1))
    child.on('exit', code => resolve(code ?? -1))
  })
}

/**
 * Write the one-time installation record.
 * @param state - what happened: requested, installed, cancelled, or failed.
 * @param code - installer exit code, when there is one.
 */
function recordAutoInstall(state, code) {
  const marker = autoInstallMarker()
  try {
    mkdirSync(dirname(marker), { recursive: true })
    writeFileSync(marker, JSON.stringify({ state, code, time: new Date().toISOString() }, undefined, 2), 'utf8')
  } catch {
    // A marker that cannot be written only means the prompt may appear again.
  }
}

/**
 * Register the Explorer menu once, when it is missing and the user was never
 * asked before. The prompt itself is the only interaction.
 * @param script - absolute path of the bundled install.ps1.
 */
async function ensureMenuInstalled(script) {
  if (process.platform !== 'win32') return
  if (!existsSync(script)) return
  if (existsSync(autoInstallMarker())) return
  if (await menuInstalled()) return
  recordAutoInstall('requested')
  const code = await runElevatedInstaller(script)
  recordAutoInstall(code === 0 ? 'installed' : code === 1223 ? 'cancelled' : 'failed', code)
  if (code !== 0 && code !== 1223) console.warn(`ui-ex/open-in-dsh: the Explorer installer exited with ${String(code)}`)
}

/**
 * Activate the feature.
 * @param ctx - Host context.
 * @param api - suite runtime api for this feature.
 * @returns the feature's RPC ops.
 */
export function setup(ctx, api) {
  const queue = queueDirectory()
  const maxAgeMs = Math.max(1, Number(api.options.queueTtlHours) || 24) * 60 * 60 * 1000
  try {
    mkdirSync(queue, { recursive: true })
  } catch {
    // The launcher recreates it too; an absent directory reads as an empty queue.
  }

  const installer = join(api.packageRoot, 'assets', 'open-in-dsh', 'windows', 'install.ps1')
  if (api.options.autoInstall !== false) {
    const delay = Math.max(0, Number(api.options.autoInstallDelayMs) || 4000)
    ctx.effect(() => {
      let stopped = false
      const timer = setTimeout(() => {
        if (stopped) return
        ensureMenuInstalled(installer).catch((error) => {
          api.warn(`the Explorer menu could not be installed: ${error instanceof Error ? error.message : String(error)}`)
        })
      }, delay)
      return () => {
        stopped = true
        clearTimeout(timer)
      }
    }, 'ui-ex/open-in-dsh: register the Explorer menu once')
  }

  return {
    rpc: {
      next: () => ({ path: takeRequest(queue, maxAgeMs) ?? null }),
    },
  }
}
