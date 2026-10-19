import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const probe = join(dirname(fileURLToPath(import.meta.url)), '..', 'probe.mjs')
const ui = '@local/dsh-ui-model-selection-collapsible'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-selected-plugin-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source')
  const files = {
    'package.json': JSON.stringify({version:'0.2.1-alpha.5'}),
    'apps/desktop/package.json': JSON.stringify({version:'0.2.1-alpha.5'}),
    'vendor/cordis/package.json': JSON.stringify({version:'4.0.0'}),
    'packages/client/web/src/platform.ts': "'react' 'react/jsx-runtime' 'react-dom' '@deepseek-ai/dsh-client-ui-primitives'",
    'packages/client/ui-model-selection/src/client/directory.ts': 'current: ModelSelection | null; routable: boolean | null; pending: ModelSelection | null; async load(); async select(selection: ModelSelection)',
    'packages/client/ui-model-selection/src/client/service.ts': 'directoryFor(sessionId:',
    'packages/api/session-controller/src/client/sessions/manager.ts': 'subagentAddress( projectionValues(',
    'packages/client/ui-primitives/src/index.ts': 'MenuSurface Toast StateDot rankByName',
  }
  for (const [relative, content] of Object.entries(files)) {
    const filename = join(source, relative)
    await mkdir(dirname(filename), {recursive:true})
    await writeFile(filename, content)
  }
  await run('git', ['init', '--quiet', source])
  await run('git', ['-C', source, '-c', 'user.name=DSH test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '--quiet', '-m', 'fixture'])
  const configPath = join(root, 'probe-config.json')
  const outputDir = join(root, 'output')
  const execute = async selectedPlugins => {
    await writeFile(configPath, JSON.stringify({selectedPlugins,outputDir,pack:false}))
    return run(process.execPath, [probe, '--source', source, '--config', configPath], {windowsHide:true})
  }
  return {root,source,outputDir,execute}
}

test('UI-only qualification ignores removed mode contracts and emits only its selected package', async t => {
  const f = await fixture(t)
  await f.execute([ui])
  const manifest = JSON.parse(await readFile(join(f.outputDir,'compatibility-manifest.json'),'utf8'))
  assert.deepEqual(manifest.plugins.map(p=>p.name), [ui])
  assert.equal(manifest.plugins[0].version,'0.2.3+dsh.0.2.1-alpha.5')
  assert.ok(manifest.contractChecks.length > 0)
  assert.ok(manifest.contractChecks.every(c=>!c.path.includes('plan-mode') && !c.path.includes('tools/src')))
  await assert.rejects(access(join(f.outputDir,'dsh-adaptive-mode')))
  await assert.rejects(access(join(f.outputDir,'dsh-code-video-mode')))
})

test('UI-only qualification still refuses a missing contract consumed by the selected plugin', async t => {
  const f = await fixture(t)
  await writeFile(join(f.source,'packages/client/ui-primitives/src/index.ts'),'MenuSurface Toast StateDot')
  await assert.rejects(f.execute([ui]), /model selector.*rankByName/s)
  await assert.rejects(access(f.outputDir))
})

for (const selected of [[],[ui,ui],['@local/unqualified'],[ui,42]]) {
  test(`invalid selected plugin inventory fails before candidate output: ${JSON.stringify(selected)}`, async t => {
    const f = await fixture(t)
    await assert.rejects(f.execute(selected), /selectedPlugins|baseline not established/)
    await assert.rejects(access(f.outputDir))
  })
}
