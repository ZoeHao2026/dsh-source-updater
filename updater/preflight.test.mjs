import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { assertActivePlugins, atomicJson, hashFile, observeChildExit, parseDataProbe, preflight, quarantineCandidate, requireSuccessfulChildExit, sourceBuildLayout, stageCompatiblePlugins, validateReadyState } from './upgrade-worker.mjs';

const execute = promisify(execFile);
const worker = fileURLToPath(new URL('./upgrade-worker.mjs', import.meta.url));

async function fixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'dp-'));
  const root = await fs.realpath(temporary);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = { schemaVersion: 1, root: path.join(root, 'helper'), installDir: path.join(root, 'install'), userDataDir: path.join(root, 'electron'), sharedDataDir: path.join(root, 'home'), currentVersion: '0.2.0-rc.2', compatibilityPatch: path.join(root, 'fixed.patch'), compatibilityProbe: path.join(root, 'probe.mjs'), buildCacheDir: path.join(root, 'c'), plugins: [], tools: { powershell: { executable: path.join(process.env.SystemRoot ?? '', 'System32/WindowsPowerShell/v1.0/powershell.exe') } } };
  for (const key of ['root', 'installDir', 'userDataDir', 'sharedDataDir']) await fs.mkdir(config[key]);
  await fs.writeFile(config.compatibilityPatch, 'fixed source patch');
  const profile = path.join(config.sharedDataDir, 'profiles/desktop');
  await fs.mkdir(profile, { recursive: true });
  const profileManifest = { dependencies: {}, dsh: { profile: { bundles: [] } } };
  const target = { version: '0.2.1-alpha.5', tag: 'dsh-v0.2.1-alpha.5', commit: 'a'.repeat(40) };
  const targetPlugins = [];
  for (const [index, name] of ['@local/adaptive', '@local/video', '@local/selector'].entries()) {
    const original = path.join(root, 'baseline', String(index));
    const active = path.join(profile, 'node_modules', name);
    const candidate = path.join(root, 'candidate', String(index));
    for (const directory of [original, active, candidate]) await fs.mkdir(directory, { recursive: true });
    const manifest = { name, version: '0.1.0', main: 'index.js', dsh: { bundle: { patch: 'bundle.yml' } } };
    for (const directory of [original, active]) {
      await atomicJson(path.join(directory, 'package.json'), manifest);
      await fs.writeFile(path.join(directory, 'index.js'), `runtime ${index}`);
      await fs.writeFile(path.join(directory, 'bundle.yml'), '[]');
    }
    const files = {};
    for (const filename of ['package.json', 'index.js', 'bundle.yml']) files[filename] = await hashFile(path.join(original, filename));
    config.plugins.push({ name, version: manifest.version, path: original, files });
    profileManifest.dependencies[name] = manifest.version;
    profileManifest.dsh.profile.bundles.push(name);
    const version = `${manifest.version}+dsh.${target.version}`;
    await atomicJson(path.join(candidate, 'package.json'), { ...manifest, version });
    await fs.writeFile(path.join(candidate, 'index.js'), `runtime ${index}`);
    await fs.writeFile(path.join(candidate, 'bundle.yml'), '[]');
    const candidateFiles = {};
    for (const filename of Object.keys(files)) candidateFiles[filename] = await hashFile(path.join(candidate, filename));
    const archive = path.join(root, `plugin-${index}.tgz`); await fs.writeFile(archive, `fixture archive ${index}`);
    targetPlugins.push({ name, version, path: candidate, files: candidateFiles, archive, archiveSha256: await hashFile(archive) });
  }
  await atomicJson(path.join(profile, 'package.json'), profileManifest);
  const artifactPath = path.join(root, 'installer.exe'); await fs.writeFile(artifactPath, 'never executed fixture installer');
  const unpackedApp = path.join(root, 'unpacked.exe'); await fs.writeFile(unpackedApp, 'never executed fixture application');
  const patchSha256 = await hashFile(config.compatibilityPatch);
  const layout = sourceBuildLayout(config, target, patchSha256);
  const activePluginInventory = {};
  const state = { schemaVersion: 1, phase: 'ready', target, targetPlugins, artifactPath, artifactSha256: await hashFile(artifactPath), unpackedApp, patchSha256, activePluginFingerprint: await assertActivePlugins(config, config.sharedDataDir, { capture: activePluginInventory }), activePluginInventory, buildRoot: layout.buildRoot, sourcePath: layout.sourcePath, sourceBuild: true, unsigned: true, appId: 'com.deepseek.dsh' };
  const request = { schemaVersion: 1, target, currentVersion: config.currentVersion, appPid: process.pid, installDir: config.installDir, userDataDir: config.userDataDir, sharedDataDir: config.sharedDataDir };
  const configPath = path.join(config.root, 'updater-config.json'); await atomicJson(configPath, config);
  await atomicJson(path.join(config.root, 'status.json'), state);
  return { root, config, configPath, state, request, profile, profileManifest, layout };
}

async function cli(configPath, action, request, mockRelease = false) {
  const wrapper = `import { main } from ${JSON.stringify(new URL('./upgrade-worker.mjs', import.meta.url).href)};${mockRelease ? `globalThis.fetch=async url=>({ok:true,json:async()=>String(url).includes('/releases?')?[{tag_name:'dsh-v0.2.1-alpha.5',published_at:'2026-01-01'}]:String(url).includes('/git/ref/')?{object:{type:'commit',sha:'${'a'.repeat(40)}'}}:{tag_name:'dsh-v0.2.1-alpha.5',published_at:'2026-01-01'}});` : ''}await main(process.argv.slice(1));`;
  try {
    const result = await execute(process.execPath, ['--input-type=module', '-e', wrapper, action, '--config', configPath, '--request', JSON.stringify(request)], { windowsHide: true });
    return { code: 0, state: JSON.parse(result.stdout) };
  } catch (error) { return { code: error.code, state: JSON.parse(error.stdout) }; }
}

test('preflight qualifies ready bytes while the original app is running without admission, child processes or profile writes', async t => {
  const f = await fixture(t);
  const before = await fs.readFile(path.join(f.profile, 'package.json'));
  assert.equal(await preflight(f.config, f.request, f.state), f.state);
  const result = await cli(f.configPath, 'preflight', f.request);
  assert.equal(result.code, 0); assert.equal(result.state.phase, 'ready');
  assert.deepEqual(result.state.targetPlugins, f.state.targetPlugins);
  assert.deepEqual(await fs.readFile(path.join(f.profile, 'package.json')), before);
  await assert.rejects(fs.stat(path.join(f.config.root, 'transactions')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(f.config.root, 'worker.lock')), { code: 'ENOENT' });
});

test('removed baseline dependencies cannot be restored from stale node_modules by preflight or staging', async t => {
  const f = await fixture(t); const name = f.config.plugins[0].name;
  delete f.profileManifest.dependencies[name]; await atomicJson(path.join(f.profile, 'package.json'), f.profileManifest);
  const result = await cli(f.configPath, 'preflight', f.request);
  assert.equal(result.code, 3); assert.equal(result.state.phase, 'blocked');
  assert.match(result.state.detail, /removed.*@local\/adaptive/);
  await assert.rejects(stageCompatiblePlugins(f.state.targetPlugins, f.config.sharedDataDir), /removed.*@local\/adaptive/);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.profile, 'package.json'))).dependencies[name], undefined);
});

test('missing installed baseline package reports the specific plugin rather than a raw missing-file failure', async t => {
  const f = await fixture(t);
  await fs.rename(path.join(f.profile, 'node_modules', f.config.plugins[0].name), path.join(f.root, 'removed-plugin'));
  const result = await cli(f.configPath, 'preflight', f.request);
  assert.equal(result.code, 3); assert.match(result.state.detail, /not installed, removed or unreadable: @local\/adaptive/);
});

test('new plugins from every scope and dependency section block qualification without editing their declarations', async t => {
  const f = await fixture(t);
  for (const [section, name] of [['dependencies', '@local/new'], ['devDependencies', '@other/new'], ['optionalDependencies', 'unscoped-new']]) {
    const manifest = structuredClone(f.profileManifest); manifest[section] = { ...manifest[section], [name]: '1.0.0' };
    await atomicJson(path.join(f.profile, 'package.json'), manifest);
    await assert.rejects(preflight(f.config, f.request, f.state), error => error.message.includes(name) && error.message.includes('newly declared'));
    assert.equal(JSON.parse(await fs.readFile(path.join(f.profile, 'package.json')))[section][name], '1.0.0');
  }
  await atomicJson(path.join(f.profile, 'package.json'), f.profileManifest);
  await fs.mkdir(path.join(f.profile, 'node_modules/@local/extra'));
  await assert.rejects(preflight(f.config, f.request, f.state), /@local\/extra is newly installed/);
});

test('ready identity, current version, installer, fixed patch and candidate archives are reverified', async t => {
  const f = await fixture(t);
  for (const target of [{ ...f.request.target, commit: 'b'.repeat(40) }, { ...f.request.target, tag: 'master' }]) await assert.rejects(preflight(f.config, { ...f.request, target }, f.state));
  for (const currentVersion of [f.state.target.version, '1.0.0']) await assert.rejects(preflight(f.config, { ...f.request, currentVersion }, f.state), /not newer/);
  await assert.rejects(preflight(f.config, { ...f.request, sharedDataDir: f.root }, f.state), /configured installation/);
  await fs.writeFile(f.state.artifactPath, 'changed'); await assert.rejects(preflight(f.config, f.request, f.state), /Installer digest/);
  await fs.writeFile(f.state.artifactPath, 'never executed fixture installer');
  await fs.writeFile(f.config.compatibilityPatch, 'changed'); await assert.rejects(preflight(f.config, f.request, f.state), /patch digest/);
  await fs.writeFile(f.config.compatibilityPatch, 'fixed source patch');
  await fs.writeFile(f.state.targetPlugins[0].archive, 'changed'); await assert.rejects(preflight(f.config, f.request, f.state), /archive missing or changed: @local\/adaptive/);
});

test('active runtime, package metadata and cached fingerprints detect post-build changes', async t => {
  const f = await fixture(t); const active = path.join(f.profile, 'node_modules', f.config.plugins[0].name);
  await fs.writeFile(path.join(active, 'index.js'), 'manual edit');
  await assert.rejects(preflight(f.config, f.request, f.state), /Active plugin file changed: @local\/adaptive\/index.js/);
  await fs.writeFile(path.join(active, 'index.js'), 'runtime 0');
  const manifest = JSON.parse(await fs.readFile(path.join(active, 'package.json'))); manifest.version += '+dsh.manual'; await atomicJson(path.join(active, 'package.json'), manifest);
  await assert.rejects(preflight(f.config, f.request, f.state), /@local\/adaptive; explicit trusted activePluginPins/);
  manifest.version = '0.1.0'; await atomicJson(path.join(active, 'package.json'), manifest);
  await assert.rejects(validateReadyState(f.config, f.request, { ...f.state, activePluginFingerprint: undefined }), /lacks a current plugin fingerprint/);
});

test('check and prepare cannot return a cached ready build after a plugin has been removed', async t => {
  const f = await fixture(t);
  await atomicJson(path.join(f.layout.buildRoot, 'ready.json'), f.state);
  delete f.profileManifest.dependencies[f.config.plugins[1].name]; await atomicJson(path.join(f.profile, 'package.json'), f.profileManifest);
  for (const action of ['check', 'prepare']) {
    await atomicJson(path.join(f.config.root, 'status.json'), f.state);
    const result = await cli(f.configPath, action, f.request, true);
    assert.equal(result.code, 3); assert.equal(result.state.phase, 'blocked'); assert.match(result.state.detail, /removed.*@local\/video/);
    assert.deepEqual(result.state.target, f.state.target);
  }
});

test('deterministic rejected candidates remain quarantined across cold checks and only explicit validated manual retry clears them', async t => {
  const f = await fixture(t);
  await quarantineCandidate(f.config, f.state, 'rolled-back', 'health child rejected');
  for (const phase of ['rolled-back', 'blocked']) {
    await atomicJson(path.join(f.config.root, 'status.json'), { ...f.state, phase });
    const result = await cli(f.configPath, 'check', f.request, true);
    assert.equal(result.code, 3); assert.match(result.state.detail, /quarantined after rolled-back/);
  }
  await atomicJson(path.join(f.config.root, 'status.json'), { ...f.state, phase: 'rolled-back' });
  const result = await cli(f.configPath, 'check', { ...f.request, manualRetry: true }, true);
  assert.equal(result.code, 0); assert.equal(result.state.phase, 'ready');
  await preflight(f.config, f.request, result.state);
});

test('manual retry never clears an interrupted recovery lock', async t => {
  const f = await fixture(t);
  await atomicJson(path.join(f.config.root, 'worker.lock'), { pid: 2147483647, token: 'retain' });
  const result = await cli(f.configPath, 'check', { ...f.request, manualRetry: true }, true);
  assert.equal(result.code, 3); assert.match(result.state.detail, /Interrupted update lock/);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.config.root, 'worker.lock'))).token, 'retain');
});

test('invalid or incomplete successful data-probe output fails before installation', () => {
  for (const output of ['not json', '{}', '{"sessionsRead":1}', '{"sessionsRead":-1,"preexistingUnreadable":0}', '{"sessionsRead":0,"preexistingUnreadable":null}', '{"sessionsRead":0,"preexistingUnreadable":0}']) assert.throws(() => parseDataProbe(output), /probe did not return/);
  const complete = { schemaVersion: 1, baselineReadabilityPreserved: true, attachmentsReadable: true, historyReadable: false, sessionsRead: 2, preexistingUnreadable: 1, preservedFailures: [{ id: 'old', reason: 'same old failure' }] };
  assert.deepEqual(parseDataProbe(JSON.stringify(complete)), complete);
  for (const field of ['baselineReadabilityPreserved', 'attachmentsReadable']) assert.throws(() => parseDataProbe(JSON.stringify({ ...complete, [field]: false })), /readability evidence/);
});

test('a valid health receipt cannot excuse a nonzero child exit after graceful release', async () => {
  for (const code of [0, 1]) {
    const child = spawn(process.execPath, ['-e', `process.stdout.write('valid fixture receipt');process.exitCode=${code}`], { windowsHide: true, stdio: 'ignore' });
    const outcome = observeChildExit(child);
    if (code === 0) await requireSuccessfulChildExit(child, outcome, 'installed-final');
    else await assert.rejects(requireSuccessfulChildExit(child, outcome, 'installed-final'), /health child did not exit successfully: 1/);
  }
});
