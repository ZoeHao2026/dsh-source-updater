/**
 * Smoke-check the two runtime halves of this bundle without mounting a session.
 *
 * `plan-entry` registers a tool through `ctx.tools`, and `render-capabilities`
 * registers a tool plus advertises an enforced output schema. Both fail at
 * activation — not at import — when their schema or shape is wrong, so this
 * script imports them, captures the registration on a fake context, validates
 * the schema against the real `@deepseek-ai/dsh-tools` subset, and executes the
 * probe once to prove it returns the declared shape.
 *
 * Usage:
 *   ELECTRON_RUN_AS_NODE=1 DeepSeek\ Harness.exe scripts/smoke-lib.mjs
 * Electron's Node runtime understands the installed app.asar filesystem.
 */
import { pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = resolve(HERE, '..')

/**
 * Locate `@deepseek-ai/dsh-tools` inside an installed DSH package.
 * @returns the importable entry URL.
 */
function resolveToolsModule() {
  if (process.env.DSH_TOOLS_DIR) {
    return pathToFileURL(join(process.env.DSH_TOOLS_DIR, 'lib', 'index.js')).href
  }
  const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
  const asarPath = resolve(process.env.DSH_APP_ASAR ?? join(localAppData, 'Programs', 'DeepSeek Harness', 'resources', 'app.asar'))
  const candidate = join(asarPath, 'dsh', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js')
  return existsSync(candidate) ? pathToFileURL(candidate).href : null
}

const toolsUrl = resolveToolsModule()
if (!toolsUrl) {
  console.error('could not locate the desktop app.asar @deepseek-ai/dsh-tools; run with ELECTRON_RUN_AS_NODE=1 using the installed DeepSeek Harness.exe, or set DSH_TOOLS_DIR')
  process.exit(1)
}
const { assertSupportedJsonSchema, validateJsonSchemaValue } = await import(toolsUrl)

const failures = []
const registrations = []
let selectedPlanAgent = null

/** Fake agent scope exposing only what these plugins touch. */
const fakeContext = {
  tools: { register: (definition) => registrations.push(definition) },
  planMode: { set: (agent, active) => {
    if (active !== true) failures.push('plan-entry: planMode.set did not request active state')
    selectedPlanAgent = agent
    return 'queued'
  } }
}

/**
 * Register one plugin and return the definitions it contributed.
 * @param specifier - package subpath to import.
 * @param label - diagnostic label.
 * @returns the registered tool definitions.
 */
async function loadPlugin(specifier, label) {
  const before = registrations.length
  const module = await import(pathToFileURL(join(PACKAGE_DIR, specifier)).href)
  if (typeof module.apply !== 'function') failures.push(`${label}: missing apply()`)
  if (!Array.isArray(module.inject) || module.inject.length === 0) failures.push(`${label}: missing inject[]`)
  module.apply(fakeContext, {})
  const registered = registrations.slice(before)
  if (registered.length === 0) failures.push(`${label}: registered no tools`)
  return registered
}

/** Validate one tool definition's schemas and declared output. */
function checkSchema(label, definition) {
  try {
    assertSupportedJsonSchema(definition.parameters)
  } catch (error) {
    failures.push(`${label}: parameters schema rejected — ${error.message}`)
  }
  try {
    assertSupportedJsonSchema(definition.output.schema)
  } catch (error) {
    failures.push(`${label}: output schema rejected — ${error.message}`)
  }
  if (typeof definition.output.render !== 'function') failures.push(`${label}: output.render missing`)
  if (typeof definition.execute !== 'function') failures.push(`${label}: execute missing`)
  if (typeof definition.description !== 'string' || definition.description.length < 20) {
    failures.push(`${label}: description too thin for a model-facing tool`)
  }
}

const planTools = await loadPlugin('lib/plan-entry.js', 'plan-entry')
for (const definition of planTools) checkSchema('plan-entry', definition)
const plan = planTools[0]
if (plan) {
  const agent = { session: {} }
  const value = await plan.execute({}, { agent })
  const violations = validateJsonSchemaValue(plan.output.schema, value)
  if (violations.length > 0) failures.push(`plan-entry: output invalid — ${violations.join('; ')}`)
  if (selectedPlanAgent !== agent || value.outcome !== 'queued' || value.selected !== true) {
    failures.push('plan-entry: did not select plan mode for the calling agent')
  }
}

const probeTools = await loadPlugin('lib/render-capabilities.js', 'render-capabilities')
for (const definition of probeTools) checkSchema('render-capabilities', definition)

const probe = probeTools[0]
if (probe) {
  const value = await probe.execute({}, { signal: undefined })
  const violations = validateJsonSchemaValue(probe.output.schema, value)
  if (violations.length > 0) failures.push(`render-capabilities: output invalid — ${violations.join('; ')}`)
  console.log('probe renderer :', value.rendersPixels)
  console.log('probe encoder  :', value.encodesVideo)
  console.log('probe voice    :', value.speaks)
  console.log('probe ffmpeg   :', value.capabilities.ffmpeg ?? '(not found)')
  console.log('probe browser  :', value.capabilities.chromeOrEdge ?? '(not found)')
  console.log('probe tts      :', value.capabilities.edgeTtsCli ?? value.capabilities.edgeTtsPythonModule ?? '(not found)')
}

console.log('registered tools:', registrations.map((definition) => definition.name).join(', '))
if (failures.length > 0) {
  console.error('\nSMOKE FAILED:')
  for (const failure of failures) console.error(' -', failure)
  process.exit(1)
}
console.log('SMOKE OK: schemas accepted by @deepseek-ai/dsh-tools; probe output matches its declared schema.')
