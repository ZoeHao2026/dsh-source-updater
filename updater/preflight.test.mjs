import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { assertActivePlugins, assertCompatiblePlugins, assertPlugins, atomicJson, hashFile, observeChildExit, parseDataProbe, preflight, quarantineCandidate, requireSuccessfulChildExit, selectedPluginNames, sourceBuildLayout, stageCompatiblePlugins, validateReadyState } from './upgrade-worker.mjs';

const execute = promisify(execFile);
const worker = fileURLToPath(new URL('./upgrade-worker.mjs', import.meta.url));

async function fixture(t, names = ['@local/adaptive', '@local/video', '@local/selector']) {
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
  for (const [index, name] of names.entries()) {
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

test('an explicitly qualified selector-only profile can stage and preflight without restoring removed modes', async t => {
  const f = await fixture(t, ['@local/selector']);
  await assertPlugins(f.config);
  await preflight(f.config, f.request, f.state);
  await stageCompatiblePlugins(f.state.targetPlugins, f.config.sharedDataDir);
  const manifest = JSON.parse(await fs.readFile(path.join(f.profile, 'package.json')));
  assert.deepEqual(Object.keys(manifest.dependencies), ['@local/selector']);
  assert.deepEqual(manifest.dsh.profile.bundles, ['@local/selector']);
  assert.deepEqual(await fs.readdir(path.join(f.profile, 'node_modules/@local')), ['selector']);
});

test('empty, duplicated and extra compatibility selections cannot enter staging or ready qualification', async t => {
  const f = await fixture(t, ['@local/selector']);
  for (const plugins of [[], [f.config.plugins[0], f.config.plugins[0]], [null]]) {
    assert.throws(() => selectedPluginNames(plugins), /selection|duplicate baseline/);
    await assert.rejects(assertPlugins({ plugins }), /selection|duplicate baseline/);
  }
  const candidate = f.state.targetPlugins[0];
  for (const plugins of [[], [candidate, candidate], [candidate, { ...candidate, name: '@local/extra' }], [{ ...candidate, name: '@local/extra' }]]) {
    await assert.rejects(assertCompatiblePlugins(f.config, plugins, f.state.target), /inventory differs/);
    await assert.rejects(preflight(f.config, f.request, { ...f.state, targetPlugins: plugins }), /inventory differs/);
  }
  await assert.rejects(stageCompatiblePlugins([], f.config.sharedDataDir), /selection/);
  await assert.rejects(stageCompatiblePlugins([candidate, candidate], f.config.sharedDataDir), /duplicate baseline/);
});

test('removed and unsupported profile bundles block promotion even if dependency bytes remain installed', async t => {
  const f = await fixture(t, ['@local/selector']);
  for (const bundles of [[], ['@local/selector', '@other/unqualified']]) {
    await atomicJson(path.join(f.profile, 'package.json'), { ...f.profileManifest, dsh: { profile: { bundles } } });
    await assert.rejects(preflight(f.config, f.request, f.state), /removed from Desktop bundles|newly selected in Desktop bundles/);
    await assert.rejects(stageCompatiblePlugins(f.state.targetPlugins, f.config.sharedDataDir), /removed from Desktop bundles|newly selected in Desktop bundles/);
  }
});

test('a changed explicit selection receives its own cache and rejects an older ready inventory', async t => {
  const f = await fixture(t);
  const one = { ...f.config, plugins: [f.config.plugins[2]] };
  assert.notEqual(sourceBuildLayout(one, f.state.target, f.state.patchSha256).buildRoot, f.layout.buildRoot);
  assert.equal(sourceBuildLayout({ ...f.config, plugins: [...f.config.plugins].reverse() }, f.state.target, f.state.patchSha256).buildRoot, f.layout.buildRoot);
  delete f.profileManifest.dependencies['@local/adaptive']; delete f.profileManifest.dependencies['@local/video'];
  f.profileManifest.dsh.profile.bundles = ['@local/selector'];
  await atomicJson(path.join(f.profile, 'package.json'), f.profileManifest);
  for (const name of ['adaptive', 'video']) await fs.rm(path.join(f.profile, 'node_modules/@local', name), { recursive: true });
  await assert.rejects(preflight(one, f.request, f.state), /fingerprint|configuration or bytes changed/);
});

test('an explicit retry rebuilds a stale candidate only after its new plugin selection qualifies', async t => {
  const f = await fixture(t);
  const one = { ...f.config, plugins: [f.config.plugins[2]] };
  for (const name of ['adaptive','video']) {
    delete f.profileManifest.dependencies[`@local/${name}`];
    await fs.rm(path.join(f.profile,'node_modules/@local',name),{recursive:true});
  }
  f.profileManifest.dsh.profile.bundles=['@local/selector'];
  await atomicJson(path.join(f.profile,'package.json'),f.profileManifest);
  await atomicJson(f.configPath,one);
  const result=await cli(f.configPath,'check',{...f.request,manualRetry:true},true);
  assert.equal(result.code,0);assert.equal(result.state.phase,'available');
  assert.equal(result.state.artifactPath,undefined);
  assert.match(result.state.detail,/fresh source build/);
  await atomicJson(path.join(f.profile,'package.json'),{...f.profileManifest,dependencies:{}});
  await atomicJson(path.join(f.config.root,'status.json'),f.state);
  const unqualified=await cli(f.configPath,'check',{...f.request,manualRetry:true},true);
  assert.equal(unqualified.code,3);assert.equal(unqualified.state.phase,'blocked');
});

test('status reports a live lock as busy even before the owner changes its previous phase', async t => {
  const f=await fixture(t);
  await atomicJson(path.join(f.config.root,'status.json'),{...f.state,phase:'available'});
  await atomicJson(path.join(f.config.root,'worker.lock'),{pid:process.pid,token:'live-test-owner'});
  const result=await cli(f.configPath,'status',{});
  assert.equal(result.code,0);assert.equal(result.state.phase,'busy');assert.equal(result.state.activePhase,'available');
});

test('offline check produces an observable retryable query failure without altering the current profile', async t => {
  const f=await fixture(t);
  const original=await fs.readFile(path.join(f.profile,'package.json'));
  const script=`import {main} from ${JSON.stringify(new URL('./upgrade-worker.mjs',import.meta.url).href)};globalThis.fetch=async()=>{throw new Error('offline fixture')};await main(process.argv.slice(1));`;
  let output;
  try {await execute(process.execPath,['--input-type=module','-e',script,'check','--config',f.configPath,'--request','{}'],{windowsHide:true});assert.fail('Expected unavailable exit');}
  catch(error){assert.equal(error.code,1);output=JSON.parse(error.stdout);}
  assert.equal(output.phase,'check-unavailable');assert.match(output.detail,/offline fixture/);
  assert.deepEqual(await fs.readFile(path.join(f.profile,'package.json')),original);
  await assert.rejects(fs.stat(path.join(f.config.root,'worker.lock')),{code:'ENOENT'});
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

test('a confirmed writer after accepted native exit quarantines the candidate without installing or restarting a competing Host', async t => {
  const f = await fixture(t);
  const before = await fs.readFile(path.join(f.profile, 'package.json'));
  const request = { ...f.request, appPid: 2147483647,
    handoffToken: '11111111-1111-1111-1111-111111111111', handoffReceipt: path.join(f.config.root, 'accepted.json'),
    admission: { idleMs: 60_000, draftsSaved: true, drained: true, activeTasks: 0, pendingApprovals: 0, queuedMessages: 0, backgroundJobs: 0 } };
  const wrapper = `import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';const actual=cp.spawn;cp.spawn=(file,args,options)=>{if(args.some(value=>String(value).endsWith('inspect-processes.ps1')))return actual(process.execPath,['-e','process.stdout.write(JSON.stringify([{pid:99999,name:"fixture-other-writer"}]))'],options);throw new Error('Unexpected installer or Host spawn: '+file)};syncBuiltinESMExports();const {main}=await import(${JSON.stringify(new URL('./upgrade-worker.mjs', import.meta.url).href)});await main(process.argv.slice(1));`;
  let blocked;
  try {
    const result = await execute(process.execPath, ['--input-type=module', '-e', wrapper, 'apply', '--config', f.configPath, '--request', JSON.stringify(request)], { windowsHide: true });
    blocked = JSON.parse(result.stdout);
  } catch (error) { assert.equal(error.code, 3); blocked = JSON.parse(error.stdout); }
  assert.equal(blocked.phase, 'blocked');
  assert.match(blocked.detail, /Original program and data retained; candidate stopped automatic retries/);
  assert.match(blocked.detail, /No client was restarted/);
  assert.match(blocked.detail, /fixture-other-writer:99999/);
  assert.match(blocked.detail, /explicit update retry/);
  const receipt = JSON.parse(await fs.readFile(request.handoffReceipt, 'utf8'));
  assert.equal(receipt.accepted, true); assert.equal(receipt.token, request.handoffToken);
  await assert.rejects(fs.stat(path.join(f.config.root, 'transactions')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(f.config.root, 'worker.lock')), { code: 'ENOENT' });
  assert.deepEqual(await fs.readFile(path.join(f.profile, 'package.json')), before);
  assert.equal(await fs.readFile(f.state.artifactPath, 'utf8'), 'never executed fixture installer');
  const rejectionNames = await fs.readdir(path.join(f.config.root, 'rejected-candidates')); assert.equal(rejectionNames.length, 1);
  const rejection = JSON.parse(await fs.readFile(path.join(f.config.root, 'rejected-candidates', rejectionNames[0]), 'utf8'));
  assert.equal(rejection.phase, 'deferred-writer-present'); assert.equal(rejection.active, true);
  for (let cold = 0; cold < 2; cold++) {
    const check = await cli(f.configPath, 'check', f.request, true);
    assert.equal(check.code, 3); assert.equal(check.state.phase, 'blocked');
    assert.match(check.state.detail, /quarantined after deferred-writer-present/);
  }
  const retry = await cli(f.configPath, 'check', { ...f.request, manualRetry: true }, true);
  assert.equal(retry.code, 0); assert.equal(retry.state.phase, 'ready');
  assert.deepEqual(await fs.readFile(path.join(f.profile, 'package.json')), before);
});

test('an unsaved post-exit writer rejection retains the lock and reports recovery-required', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.config.root, 'rejected-candidates'), 'fixture disk obstruction; retain');
  const request = { ...f.request, appPid: 2147483647,
    admission: { idleMs: 60_000, draftsSaved: true, drained: true, activeTasks: 0, pendingApprovals: 0, queuedMessages: 0, backgroundJobs: 0 } };
  const wrapper = `import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';const actual=cp.spawn;cp.spawn=(file,args,options)=>{if(args.some(value=>String(value).endsWith('inspect-processes.ps1')))return actual(process.execPath,['-e','process.stdout.write(JSON.stringify([{pid:99999,name:"fixture-other-writer"}]))'],options);throw new Error('Unexpected installer or Host spawn: '+file)};syncBuiltinESMExports();const {main}=await import(${JSON.stringify(new URL('./upgrade-worker.mjs', import.meta.url).href)});await main(process.argv.slice(1));`;
  let blocked;
  try { const result = await execute(process.execPath, ['--input-type=module', '-e', wrapper, 'apply', '--config', f.configPath, '--request', JSON.stringify(request)], { windowsHide: true }); blocked = JSON.parse(result.stdout); }
  catch (error) { assert.equal(error.code, 3); blocked = JSON.parse(error.stdout); }
  assert.equal(blocked.phase, 'recovery-required');
  assert.match(blocked.detail, /writer rejection could not be saved/);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.config.root, 'worker.lock'), 'utf8')).pid > 0, true);
  const retry = await cli(f.configPath, 'check', { ...f.request, manualRetry: true }, true);
  assert.equal(retry.code, 3); assert.match(retry.state.detail, /Interrupted update lock/);
});

for (const fault of ['mkdir', 'journal', 'quarantine']) test(`post-exit transaction ${fault} failure retains untouched program and data and cannot repeat automatic shutdown`, async t => {
  const f = await fixture(t);
  const before = await fs.readFile(path.join(f.profile, 'package.json'));
  if (fault === 'quarantine') await fs.writeFile(path.join(f.config.root, 'rejected-candidates'), 'fixture rejection storage obstruction');
  const request = { ...f.request, appPid: 2147483647,
    admission: { idleMs: 60_000, draftsSaved: true, drained: true, activeTasks: 0, pendingApprovals: 0, queuedMessages: 0, backgroundJobs: 0 } };
  const wrapper = `import cp from 'node:child_process';import fs from 'node:fs/promises';import path from 'node:path';import {syncBuiltinESMExports} from 'node:module';
const transactions=${JSON.stringify(path.join(f.config.root, 'transactions'))};const fault=${JSON.stringify(fault)};const originalMkdir=fs.mkdir;const originalWrite=fs.writeFile;
fs.mkdir=async(filename,...rest)=>{if(fault!=='journal'&&String(filename).startsWith(transactions+path.sep))throw Object.assign(new Error('fixture transaction mkdir refused'),{code:'EACCES'});return originalMkdir(filename,...rest)};
fs.writeFile=async(filename,...rest)=>{if(fault==='journal'&&String(filename).startsWith(transactions+path.sep)&&String(filename).includes('transaction.json.'))throw Object.assign(new Error('fixture first journal refused'),{code:'EACCES'});return originalWrite(filename,...rest)};
const actual=cp.spawn;cp.spawn=(file,args,options)=>{if(args.some(value=>String(value).endsWith('inspect-processes.ps1')))return actual(process.execPath,['-e','process.stdout.write("[]")'],options);throw new Error('Unexpected installer or Host spawn: '+file)};syncBuiltinESMExports();const {main}=await import(${JSON.stringify(new URL('./upgrade-worker.mjs', import.meta.url).href)});await main(process.argv.slice(1));`;
  let result;
  try { const output = await execute(process.execPath, ['--input-type=module', '-e', wrapper, 'apply', '--config', f.configPath, '--request', JSON.stringify(request)], { windowsHide: true }); result = { code: 0, state: JSON.parse(output.stdout) }; }
  catch (error) { result = { code: error.code, state: JSON.parse(error.stdout) }; }
  assert.deepEqual(await fs.readFile(path.join(f.profile, 'package.json')), before);
  assert.equal(await fs.readFile(f.state.artifactPath, 'utf8'), 'never executed fixture installer');
  if (fault === 'quarantine') {
    assert.equal(result.code, 3); assert.equal(result.state.phase, 'recovery-required');
    assert.match(result.state.detail, /transaction initialization rejection could not be saved/);
    assert.equal(JSON.parse(await fs.readFile(path.join(f.config.root, 'worker.lock'), 'utf8')).pid > 0, true);
    const retry = await cli(f.configPath, 'check', { ...f.request, manualRetry: true }, true);
    assert.equal(retry.code, 3); assert.match(retry.state.detail, /Interrupted update lock/);
    return;
  }
  assert.equal(result.code, 0); assert.equal(result.state.phase, 'blocked');
  assert.match(result.state.detail, /Original program and data retained; candidate stopped automatic retries/);
  assert.match(result.state.detail, /explicit update retry/);
  await assert.rejects(fs.stat(path.join(f.config.root, 'worker.lock')), { code: 'ENOENT' });
  if (fault === 'journal') assert.equal((await fs.stat(result.state.transaction)).isDirectory(), true);
  const names = await fs.readdir(path.join(f.config.root, 'rejected-candidates'));
  assert.equal(names.length, 1);
  const rejection = JSON.parse(await fs.readFile(path.join(f.config.root, 'rejected-candidates', names[0]), 'utf8'));
  assert.equal(rejection.phase, 'transaction-initialization-failed'); assert.equal(rejection.active, true);
  for (let cold = 0; cold < 2; cold++) {
    const check = await cli(f.configPath, 'check', f.request, true);
    assert.equal(check.code, 3); assert.match(check.state.detail, /quarantined after transaction-initialization-failed/);
  }
});

test('manual retry never clears an interrupted recovery lock', async t => {
  const f = await fixture(t);
  await atomicJson(path.join(f.config.root, 'worker.lock'), { pid: 2147483647, token: 'retain' });
  const result = await cli(f.configPath, 'check', { ...f.request, manualRetry: true }, true);
  assert.equal(result.code, 3); assert.match(result.state.detail, /Interrupted update lock/);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.config.root, 'worker.lock'))).token, 'retain');
});

test('a source preparation failure is quarantined before cold checks can start another full build', async t => {
  const f=await fixture(t,['@local/selector']);
  const counter=path.join(f.root,'git-invocations.txt');
  f.config.tools.git={executable:process.execPath,args:['-e',`require('node:fs').appendFileSync(${JSON.stringify(counter)},'invoked\\n');process.exit(7)`,'--']};
  await atomicJson(f.configPath,f.config);
  const prepared=await cli(f.configPath,'prepare',f.request,true);
  assert.equal(prepared.code,1);assert.equal(prepared.state.phase,'failed');
  assert.equal(await fs.readFile(counter,'utf8'),'invoked\n');
  assert.equal((await fs.readdir(path.join(f.config.root,'rejected-candidates'))).length,1);
  for(let i=0;i<2;i++){
    const next=await cli(f.configPath,'check',f.request,true);
    assert.equal(next.code,3);assert.equal(next.state.phase,'blocked');assert.match(next.state.detail,/quarantined after prepare-failed/);
  }
  assert.equal(await fs.readFile(counter,'utf8'),'invoked\n');
  const retry=await cli(f.configPath,'check',{...f.request,manualRetry:true},true);
  assert.equal(retry.code,0);assert.equal(retry.state.phase,'available');
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
