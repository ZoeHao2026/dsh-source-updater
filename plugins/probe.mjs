import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { resolve, dirname, join, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ownRoot = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const arg = key => args.includes(key) ? args[args.indexOf(key) + 1] : undefined
const sourceArgument = arg('--source')
if (!sourceArgument || !isAbsolute(sourceArgument)) throw new Error('Usage: node probe.mjs --source ABS_OFFICIAL_CHECKOUT [--config ABS_JSON]')
const sourceRoot = resolve(sourceArgument)
const config = arg('--config') ? JSON.parse(await readFile(resolve(arg('--config')), 'utf8')) : {}
let baselineRoot
if (config.baselineRoot !== undefined) {
  if (typeof config.baselineRoot !== 'string' || !isAbsolute(config.baselineRoot)) throw new Error('config.baselineRoot must be an absolute directory')
  baselineRoot = resolve(config.baselineRoot)
} else {
  baselineRoot = join(ownRoot, 'packages')
  try {
    if (!(await stat(baselineRoot)).isDirectory()) throw new Error('Deployed baseline packages path must be a directory')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    baselineRoot = join(ownRoot, 'baseline-sources')
  }
}
if (!(await stat(baselineRoot)).isDirectory()) throw new Error('Baseline source root must be a directory')
const outputRoot = resolve(config.pluginOutputDir ?? config.outputDir ?? join(ownRoot, 'ported'))
const sourceVersion = JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8')).version
const targetVersion = JSON.parse(await readFile(join(sourceRoot, 'apps/desktop/package.json'), 'utf8')).version
const cordisVersion = JSON.parse(await readFile(join(sourceRoot, 'vendor/cordis/package.json'), 'utf8')).version
const targetCommit = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (config.expectedCommit) assert.equal(targetCommit, config.expectedCommit, 'target commit drift')
const sha256 = value => createHash('sha256').update(value).digest('hex')
const normalized = value => value.replace(/\r\n?/g, '\n')
const standard = normalized(await readFile(join(sourceRoot, 'packages/bundle/web-app/presets/standard.patch.yml'), 'utf8'))
const baseline = JSON.parse(await readFile(join(ownRoot, 'baseline-inventory.json'), 'utf8'))
const readTarget = path => readFile(join(sourceRoot, path), 'utf8')
const checks = []
async function requireFragments(plugin, path, fragments) {
  let text
  try { text = await readTarget(path) }
  catch (error) { throw new Error(`${plugin}: target contract ${path} is unavailable: ${error.message}`, { cause: error }) }
  for (const fragment of fragments) assert.ok(text.includes(fragment), `${plugin}: ${path} no longer provides ${fragment}`)
  checks.push({ plugin, path, fragments })
}
// Check the actual official contracts consumed by the unchanged shipped bundles.
await requireFragments('adaptive', 'packages/client/ui-conversation/src/client/contract/slots.ts', ["'conversation.input.right'", "scope: 'session'"])
await requireFragments('adaptive', 'packages/interaction/commands/src/index.ts', ['execute('])
await requireFragments('adaptive', 'packages/plan/plan-mode/src/index.ts', ['get(agent:', 'set(agent:', 'pending?: boolean'])
await requireFragments('adaptive', 'packages/core/system-prompt/src/index.ts', ['getSectionOrder(', 'section(section:'])
await requireFragments('adaptive', 'packages/session/session-projection/src/index.ts', ['stateOf<', 'register<'])
await requireFragments('adaptive', 'packages/goal/goal/src/index.ts', ['current: goalProjectionSchema', "zod.literal('active')"])
await requireFragments('adaptive, model selector', 'packages/client/web/src/platform.ts', ["'react'", "'react/jsx-runtime'", "'react-dom'", "'@deepseek-ai/dsh-client-ui-primitives'"])
await requireFragments('model selector', 'packages/client/ui-model-selection/src/client/directory.ts', ['current: ModelSelection | null', 'routable: boolean | null', 'pending: ModelSelection | null', 'async load()', 'async select(selection: ModelSelection)'])
await requireFragments('model selector', 'packages/client/ui-model-selection/src/client/service.ts', ['directoryFor(sessionId:'])
await requireFragments('model selector', 'packages/api/session-controller/src/client/sessions/manager.ts', ['subagentAddress(', 'projectionValues('])
await requireFragments('model selector', 'packages/client/ui-primitives/src/index.ts', ['MenuSurface', 'Toast', 'StateDot', 'rankByName'])
await requireFragments('code-video, adaptive', 'packages/core/tools/src/index.ts', ['register(definition: ToolDefinition)', 'readonly output: ToolOutputDefinition', 'execute(args: unknown, exec: ToolRunContext)'])

function replaceOnce(text, needle, replacement, plugin) {
  assert.equal(text.split(needle).length - 1, 1, `${plugin}: expected one ${needle}`)
  return text.replace(needle, replacement)
}
function customPreset(name, persona) {
  const adaptive = name === 'dsh-adaptive-mode'
  const id = adaptive ? 'adaptive' : 'code-video'
  let patch = replaceOnce(standard, '    - id: preset-standard', `    - id: preset-${id}`, id)
  patch = replaceOnce(patch, '        id: standard', `        id: ${id}`, id)
  patch = replaceOnce(patch, '        order: 1', `        order: ${adaptive ? 5 : 6}`, id)
  patch = replaceOnce(patch, '        plugins:', `        name: ${adaptive ? '自适应模式' : '代码视频'}\n        description: ${adaptive ? '完整继承标准模式能力，按任务风险动态选择 Playbook、规划、技能与验证。' : '用代码生成高品质程序化视频：一句主题描述即从创意、文案、分镜推进到最终 MP4。'}\n        plugins:`, id)
  const prefix = '              prefix: You are a coding agent powered by the {{model}} model.'
  const resource = `              suffix: !!js "'Your working directory is {{cwd}}. ${adaptive ? 'Adaptive' : 'Code-video'} resource root: ' + process.getBuiltinModule('node:path').dirname(process.getBuiltinModule('node:module').createRequire(baseUrl).resolve('@local/${name}/package.json'))"`
  const prefixLines = adaptive ? prefix : `              prefix: |-\n${persona.trimEnd().split('\n').map(line => line ? '                ' + line : '').join('\n')}`
  patch = replaceOnce(patch, prefix, `${resource}\n${prefixLines}`, id)
  const skill = "            name: '@deepseek-ai/dsh-skill-filesystem'"
  patch = replaceOnce(patch, skill, `${skill}\n            config:\n              customSkillDirs:\n                - !!js "process.getBuiltinModule('node:path').join(process.getBuiltinModule('node:path').dirname(process.getBuiltinModule('node:module').createRequire(baseUrl).resolve('@local/${name}/package.json')), 'skills')"`, id)
  const planningEnd = '          - id: compaction\n'
  const extraPlanning = adaptive
    ? "              - id: adaptive-plan-entry\n                name: '@local/dsh-adaptive-mode/plan-entry'\n              - id: adaptive-dpira-max\n                name: '@local/dsh-adaptive-mode/dpira-max'\n"
    : "              - id: code-video-plan-entry\n                name: '@local/dsh-code-video-mode/plan-entry'\n"
  patch = replaceOnce(patch, planningEnd, extraPlanning + planningEnd, id)
  if (adaptive) patch += "\n- insert:\n    - id: adaptive-max-ui\n      name: '@local/dsh-adaptive-mode'\n"
  else patch = replaceOnce(patch, '          - id: present\n', "          - id: code-video-render-capabilities\n            name: '@local/dsh-code-video-mode/render-capabilities'\n          - id: present\n", id)
  return `# Local compatibility port from exact installed plugin; official source ${targetCommit}, version ${targetVersion}.\n` + patch
}

const manifest = { targetVersion, targetCommit, sourceVersion, generatedAt: new Date().toISOString(), plugins: [], contractChecks: checks }
await mkdir(outputRoot, { recursive: true })
for (const entry of baseline) {
  const directory = entry.name.slice('@local/'.length)
  const from = join(baselineRoot, directory)
  const to = join(outputRoot, directory)
  if (to === from) throw new Error('Output must not overwrite baseline source')
  for (const baselineFile of entry.files) {
    assert.equal(sha256(await readFile(join(from, baselineFile.path))), baselineFile.sha256, `${entry.name}: saved baseline ${baselineFile.path} changed`)
  }
  await mkdir(to, { recursive: true })
  await cp(from, to, { recursive: true })
  const pkg = JSON.parse(await readFile(join(to, 'package.json'), 'utf8'))
  pkg.version = `${entry.version}+dsh.${targetVersion}`
  pkg.dshCompatibility = { baselineVersion: entry.version, harnessVersion: targetVersion, harnessCommit: targetCommit, baselineArchiveSha256: entry.archiveSha256 }
  for (const section of ['peerDependencies', 'devDependencies']) {
    for (const dependency of Object.keys(pkg[section] ?? {})) {
      if (dependency.startsWith('@deepseek-ai/dsh-')) pkg[section][dependency] = targetVersion
      if (dependency === '@deepseek-ai/cordis') pkg[section][dependency] = cordisVersion
    }
  }
  if (directory !== 'dsh-ui-model-selection-collapsible') {
    const persona = directory === 'dsh-code-video-mode' ? normalized(await readFile(join(to, 'mode/persona.md'), 'utf8')) : ''
    await writeFile(join(to, 'cordis.patch.yml'), customPreset(directory, persona))
  }
  await writeFile(join(to, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)
  const files = {}
  const visit = async (path, rel = '') => {
    for (const f of await readdir(path, { withFileTypes: true })) {
      if (f.name === 'node_modules') continue
      const name = rel ? `${rel}/${f.name}` : f.name
      if (f.isDirectory()) await visit(join(path, f.name), name)
      else files[name] = sha256(await readFile(join(path, f.name)))
    }
  }
  await visit(to)
  const port = { name: entry.name, version: pkg.version, baselineVersion: entry.version, path: to, files }
  if (config.pack !== false) {
    const releaseDir = join(outputRoot, 'releases')
    await mkdir(releaseDir, { recursive: true })
    const npmCli = config.npmCli ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
    const packed = JSON.parse(execFileSync(process.execPath, [npmCli, 'pack', '--json', '--ignore-scripts', '--pack-destination', releaseDir], { cwd: to, encoding: 'utf8' }))
    port.archive = join(releaseDir, packed[0].filename)
    port.archiveSha256 = sha256(await readFile(port.archive))
  }
  manifest.plugins.push(port)
}
await writeFile(join(outputRoot, 'compatibility-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(JSON.stringify({ ok: true, targetVersion, targetCommit, outputDir: outputRoot, manifest: join(outputRoot, 'compatibility-manifest.json'), plugins: manifest.plugins.map(({ name, version, path }) => ({ name, version, path })) }))
