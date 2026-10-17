import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
const desktopExe = resolve(process.env.DSH_DESKTOP_EXE ?? join(localAppData, 'Programs', 'DeepSeek Harness', 'DeepSeek Harness.exe'))
const smokeScript = fileURLToPath(new URL('./smoke-lib.mjs', import.meta.url))
if (!existsSync(desktopExe)) throw new Error(`Desktop executable not found: ${desktopExe}`)

const result = spawnSync(desktopExe, [smokeScript], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
  timeout: 120000,
  windowsHide: true
})
if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)
if (result.error) throw result.error
process.exitCode = result.status ?? 1
