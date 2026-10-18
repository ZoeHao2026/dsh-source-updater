/** Exercise the real coordinator with explicit, disposable fixture inputs only. */
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { atomicJson, assertActivePlugins, assertWithin, hashFile, snapshotTree, snapshotInventoryDigest } from './upgrade-worker.mjs';
const execute = promisify(execFile);
const own = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const usage = 'Create: node recovery-integration.mjs --create-fixture-inputs ABS_EMPTY_OWNED_SANDBOX. Run: node recovery-integration.mjs --fixture-config ABS_JSON --compatible-manifest ABS_JSON --workspace ABS_OWNED_SANDBOX [--writer-blocks-rollback | --journal-failure | --invalid-data-probe | --health-nonzero]. Never supply production configuration.';
const absolute = flag => {
  const index = args.indexOf(flag);
  if (index < 0 || args.lastIndexOf(flag) !== index || !args[index + 1] || !path.isAbsolute(args[index + 1])) throw new Error(usage);
  return path.resolve(args[index + 1]);
};
const creating = args.includes('--create-fixture-inputs');
const fixtureConfigPath = creating ? undefined : absolute('--fixture-config');
const compatibleManifestPath = creating ? undefined : absolute('--compatible-manifest');
const workspace = absolute(creating ? '--create-fixture-inputs' : '--workspace');
const writerBlocksRollback = args.includes('--writer-blocks-rollback');
const journalFailure = args.includes('--journal-failure');
const invalidDataProbe = args.includes('--invalid-data-probe');
const healthNonzero = args.includes('--health-nonzero');
if ([writerBlocksRollback, journalFailure, invalidDataProbe, healthNonzero].filter(Boolean).length > 1 || creating && args.length !== 2) throw new Error(usage);
if (process.platform !== 'win32') throw new Error('This explicit recovery fixture requires Windows.');
const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const workspaceStat = await fs.lstat(workspace);
if (!workspaceStat.isDirectory() || workspaceStat.isSymbolicLink() || workspace === path.parse(workspace).root) throw new Error('An existing physical disposable workspace is required.');
if ((await fs.realpath(workspace)).toLowerCase() !== workspace.toLowerCase()) throw new Error('Recovery workspace must use its physical path.');
const owner = JSON.parse((await execute(powershell, ['-NoProfile', '-NonInteractive', '-File', path.join(own, 'inspect-build-cache.ps1'), '-CachePath', workspace], { windowsHide: true })).stdout);
assert.equal(owner.ownedByCurrentUser, true, 'Recovery workspace must be owned by the current Windows account.');
const markerPath = path.join(workspace, '.recovery-fixture-workspace.json');
const names = ['@local/dsh-adaptive-mode', '@local/dsh-code-video-mode', '@local/dsh-ui-model-selection-collapsible'];
const versions = ['0.1.14', '0.1.3', '0.2.3'];
const targetVersion = '0.2.1-alpha.5';

if (creating) {
  assert.deepEqual(await fs.readdir(workspace), [], 'Input creation requires an empty sandbox.');
  const baseline = []; const candidates = [];
  for (const [index, name] of names.entries()) for (const candidate of [false, true]) {
    const directory = path.join(workspace, candidate ? 'compatible' : 'baseline', name.split('/')[1]);
    const version = versions[index] + (candidate ? `+dsh.${targetVersion}` : '');
    await fs.mkdir(directory, { recursive: true });
    await atomicJson(path.join(directory, 'package.json'), { name, version, type: 'module', main: 'index.js', fixtureOnly: true });
    await fs.writeFile(path.join(directory, 'index.js'), 'export const fixtureOnly = true;\n');
    const files = Object.fromEntries(await Promise.all(['package.json', 'index.js'].map(async relative => [relative, await hashFile(path.join(directory, relative))])));
    const entry = { name, version, path: directory, files };
    if (candidate) {
      // The coordinator copies package directories; this sentinel is never unpacked or installed as a package.
      entry.archive = path.join(workspace, `${name.split('/')[1]}-fixture.tgz`);
      await fs.writeFile(entry.archive, 'fixture-only archive sentinel; not an installable plugin\n');
      entry.archiveSha256 = await hashFile(entry.archive);
    }
    (candidate ? candidates : baseline).push(entry);
  }
  const patch = path.join(workspace, 'fixture.patch');
  await fs.writeFile(patch, 'fixture-only patch sentinel; no source build is performed\n');
  await atomicJson(path.join(workspace, 'fixture-config.json'), { schemaVersion: 1, fixtureOnly: true, currentVersion: '0.2.0-rc.2', compatibilityPatch: patch, plugins: baseline });
  await atomicJson(path.join(workspace, 'compatible-manifest.json'), { schemaVersion: 1, fixtureOnly: true, targetVersion, targetCommit: '1'.repeat(40), plugins: candidates });
  await atomicJson(markerPath, { schemaVersion: 1, fixtureOnly: true });
  console.log(JSON.stringify({ fixtureOnly: true, workspace, fixtureConfig: path.join(workspace, 'fixture-config.json'), compatibleManifest: path.join(workspace, 'compatible-manifest.json') }, null, 2));
  process.exit(0);
}

assertWithin(workspace, fixtureConfigPath); assertWithin(workspace, compatibleManifestPath);
assert.deepEqual(JSON.parse(await fs.readFile(markerPath, 'utf8')), { schemaVersion: 1, fixtureOnly: true });
const fixtureConfig = JSON.parse(await fs.readFile(fixtureConfigPath, 'utf8'));
const plugins = JSON.parse(await fs.readFile(compatibleManifestPath, 'utf8'));
assert.equal(fixtureConfig.fixtureOnly, true, 'Production configuration is forbidden.');
assert.equal(plugins.fixtureOnly, true, 'Production compatibility manifests are forbidden.');
assert.deepEqual(fixtureConfig.plugins.map(plugin => plugin.name).sort(), [...names].sort());
assert.deepEqual(plugins.plugins.map(plugin => plugin.name).sort(), [...names].sort());
assertWithin(workspace, fixtureConfig.compatibilityPatch);
for (const plugin of [...fixtureConfig.plugins, ...plugins.plugins]) {
  assertWithin(workspace, plugin.path);
  if (plugin.archive) assertWithin(workspace, plugin.archive);
  assert.equal((await fs.realpath(plugin.path)).toLowerCase(), path.resolve(plugin.path).toLowerCase(), 'Fixture plugin paths must be physical sandbox directories.');
}
const root = await fs.mkdtemp(path.join(workspace, 'rollback-fixture-'));
const fixture = path.join(root, 'UpdateFixture.exe');
let source = await fs.readFile(path.join(own, 'tests/RecoveryFixture.cs'), 'utf8');
const installerInsertion = 'if (install == null) return 3;';
assert.ok(source.includes(installerInsertion), 'Fixture installer hook must exist.');
source = source.replace(installerInsertion, `${installerInsertion}\n        string marker = Environment.GetEnvironmentVariable("DSH_FIXTURE_INSTALL_MARKER");\n        if (!String.IsNullOrEmpty(marker)) File.WriteAllText(marker, "fixture installer invoked");`);
if (healthNonzero) {
  const altered = source.replace(/      return 0;\r?\n    } catch/, '      return 7;\n    } catch');
  assert.notEqual(altered, source, 'Fixture health exit hook must exist.'); source = altered;
}
const fixtureSource = path.join(root, 'RecoveryFixture.cs'); await fs.writeFile(fixtureSource, source);
await execute(powershell, ['-NoProfile', '-NonInteractive', '-File', path.join(own, 'tests/compile-recovery-fixture.ps1'), '-Source', fixtureSource, '-OutputPath', fixture], { windowsHide: true });
const install = path.join(root, 'install'); const home = path.join(root, 'shared'); const electron = path.join(root, 'electron'); const helper = path.join(root, 'helper');
for (const directory of [install, home, electron, helper, path.join(home, 'sessions')]) await fs.mkdir(directory, { recursive: true });
await fs.copyFile(fixture, path.join(install, 'UpdateFixture.exe'));
await fs.writeFile(path.join(install, 'version.txt'), 'old-program');
await fs.writeFile(path.join(home, 'history-version.txt'), 'old-history');
await fs.writeFile(path.join(electron, 'settings.json'), '{"schema":1}');
const profile = path.join(home, 'profiles/desktop'); await fs.mkdir(profile, { recursive: true });
await atomicJson(path.join(profile, 'package.json'), { dependencies: Object.fromEntries(fixtureConfig.plugins.map(plugin => [plugin.name, plugin.version])) });
for (const plugin of fixtureConfig.plugins) await fs.cp(plugin.path, path.join(profile, 'node_modules', plugin.name), { recursive: true, dereference: true });
await fs.copyFile(path.join(own, 'upgrade-worker.mjs'), path.join(helper, 'upgrade-worker.mjs'));
await fs.writeFile(path.join(helper, 'inspect-processes.ps1'), "param([string]$RequestPath)\nif ($env:DSH_FIXTURE_RECOVERY_WRITER_MARKER -and (Test-Path -LiteralPath $env:DSH_FIXTURE_RECOVERY_WRITER_MARKER)) { Write-Output '[{\"pid\":99999,\"name\":\"fixture-active-writer\"}]' } else { Write-Output '[]' }\n");
await fs.writeFile(path.join(helper, 'installation-metadata.ps1'), "param([string]$Action,[string]$ConfigPath,[string]$Destination)\n$ErrorActionPreference='Stop'\n$config=Get-Content -LiteralPath $ConfigPath -Raw|ConvertFrom-Json\nAdd-Content -LiteralPath (Join-Path $config.root 'metadata-actions.txt') -Value $Action\nWrite-Output ('{\"fixture\":true,\"action\":\"'+$Action+'\"}')\n");
const evidence = { schemaVersion: 1, baselineReadabilityPreserved: true, attachmentsReadable: true, historyReadable: true, sessionsRead: 0, preexistingUnreadable: 0, preservedFailures: [] };
await fs.writeFile(path.join(helper, 'data-probe.mjs'), `import fs from 'node:fs/promises';import path from 'node:path';const args=process.argv.slice(2);const home=args[args.indexOf('--home')+1];await fs.writeFile(path.join(home,'history-version.txt'),'new-history');console.log(${JSON.stringify(invalidDataProbe ? 'invalid fixture probe JSON' : JSON.stringify(evidence))});\n`);
const oldInstall = await snapshotTree(install, path.join(root, 'expected-install'));
const oldHome = await snapshotTree(home, path.join(root, 'expected-shared'));
const oldElectron = await snapshotTree(electron, path.join(root, 'expected-electron'));
const programDigest = snapshotInventoryDigest(oldInstall); const inventoryDigest = snapshotInventoryDigest(oldHome, true);
await atomicJson(path.join(helper, 'history-baselines', `${programDigest}-${inventoryDigest}.json`), { schemaVersion: 1, version: fixtureConfig.currentVersion, sessions: [], readable: 0, preexistingUnreadable: 0, programDigest, inventoryDigest });
const config = { schemaVersion: 1, currentVersion: fixtureConfig.currentVersion, compatibilityPatch: fixtureConfig.compatibilityPatch, plugins: fixtureConfig.plugins,
  root: helper, installDir: install, sharedDataDir: home, userDataDir: electron, dataProbe: path.join(helper, 'data-probe.mjs'), healthTimeoutMs: 15000,
  tools: { node: { executable: process.execPath }, powershell: { executable: powershell } } };
const configPath = path.join(helper, 'updater-config.json'); await atomicJson(configPath, config);
const target = { version: plugins.targetVersion, tag: `dsh-v${plugins.targetVersion}`, commit: plugins.targetCommit };
const activePluginInventory = {};
const activePluginFingerprint = await assertActivePlugins(config, home, { capture: activePluginInventory });
const ready = { schemaVersion: 1, phase: 'ready', target, targetPlugins: plugins.plugins, artifactPath: fixture, artifactSha256: await hashFile(fixture), unpackedApp: fixture,
  patchSha256: await hashFile(config.compatibilityPatch), activePluginFingerprint, activePluginInventory, buildRoot: path.join(root, 'build'), sourceBuild: true, unsigned: true, appId: 'com.deepseek.dsh' };
await atomicJson(path.join(helper, 'status.json'), ready);
const exited = spawn(fixture, ['--fixture-exit'], { windowsHide: true }); const appPid = exited.pid;
await new Promise((resolve, reject) => { exited.once('error', reject); exited.once('exit', resolve); });
const request = { schemaVersion: 1, target, currentVersion: fixtureConfig.currentVersion, appPid, installDir: install, sharedDataDir: home, userDataDir: electron,
  admission: { idleMs: 60000, draftsSaved: true, drained: true, activeTasks: 0, pendingApprovals: 0, queuedMessages: 0, backgroundJobs: 0 } };
const requestPath = path.join(root, 'apply.json'); await atomicJson(requestPath, request);
const installMarker = path.join(root, 'installer-invoked.marker');
const environment = { ...process.env, DSH_FIXTURE_INSTALL_MARKER: installMarker,
  ...(writerBlocksRollback ? { DSH_FIXTURE_RECOVERY_WRITER_MARKER: path.join(root, 'writer-active.marker') } : {}),
  ...(journalFailure ? { DSH_FIXTURE_RECOVERY_JOURNAL_FAILURE: '1' } : {}) };
for (const key of ['DSH_HOME', 'DSH_SOURCE_UPDATER_CONFIG', 'DSH_SOURCE_UPDATE_HEALTH', 'DSH_SOURCE_UPDATE_DISABLE_SCHEDULES', 'ELECTRON_RUN_AS_NODE']) delete environment[key];
const invoke = async action => {
  try { return await execute(process.execPath, [path.join(helper, 'upgrade-worker.mjs'), action, '--config', configPath, '--request-path', requestPath], { env: environment, windowsHide: true, maxBuffer: 1024 * 1024, timeout: 120000 }); }
  catch (error) { if (![1, 3].includes(error.code) || !error.stdout) throw error; return error; }
};
const result = await invoke('apply');
await fs.writeFile(path.join(root, 'worker-output.log'), result.stdout + result.stderr);
const status = JSON.parse(await fs.readFile(path.join(helper, 'status.json'), 'utf8'));
const earlyFailure = invalidDataProbe || healthNonzero;
assert.equal(status.phase, writerBlocksRollback || journalFailure ? 'recovery-required' : earlyFailure ? 'blocked' : 'rolled-back');
assert.match(status.detail, writerBlocksRollback ? /Data writers still running: fixture-active-writer:99999/ : journalFailure ? /Matched rollback could not finish/ : invalidDataProbe ? /probe did not return valid JSON/ : healthNonzero ? /isolated health child did not exit successfully: 7/ : /installed-final health receipt failed required checks/);
const journalPath = path.join(status.transaction, 'transaction.json');
const tx = JSON.parse(await fs.readFile(journalFailure ? `${journalPath}.before-fixture-fault` : journalPath, 'utf8'));
if (!earlyFailure) assert.ok(tx.promoted.sharedDataDir && tx.promoted.userDataDir, 'Failure must occur after data and settings promotion.');
else {
  assert.equal(tx.stage, 'deferred-before-install');
  assert.equal(await fs.lstat(installMarker).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; }), false, 'Invalid probe or unsuccessful health must never invoke the installer.');
}
const report = { pass: true, fixtureOnly: true, root,
  scope: 'Real apply coordinator and Windows child processes; synthetic baseline packages, fixture installer, health, writer and metadata adapters; no live configuration, user data, model, client or registry writes' };
let reportName;
if (writerBlocksRollback || journalFailure) {
  assert.ok((await fs.stat(path.join(helper, 'worker.lock'))).isFile(), 'Unresolved transactions retain their lock.');
  if (!journalFailure) assert.equal(tx.stage, 'recovery-required'); else assert.ok(status.journalFailure, 'Journal failure is reported without dropping the lock.');
  assert.equal(await fs.readFile(path.join(install, 'version.txt'), 'utf8'), 'new-program');
  assert.equal(await fs.readFile(path.join(home, 'history-version.txt'), 'utf8'), 'new-history');
  assert.equal(await fs.readFile(path.join(electron, 'settings.json'), 'utf8'), '{"schema":2}');
  assert.equal(await fs.readFile(path.join(helper, 'metadata-actions.txt'), 'utf8'), 'Snapshot\r\nRestoreShortcuts\r\n');
  assert.equal(JSON.parse((await invoke('status')).stdout).phase, 'recovery-required');
  const retry = JSON.parse((await invoke('apply')).stdout); assert.equal(retry.phase, 'blocked'); assert.match(retry.detail, /Interrupted update lock requires inspection/);
  Object.assign(report, { fault: writerBlocksRollback ? 'Writer inspection becomes active after final health failure' : 'Transaction journal becomes unwritable after final health failure',
    lockRetained: true, recoveryRequired: true, newProgramPreserved: true, migratedDataPreserved: true, migratedSettingsPreserved: true, automaticRetryBlocked: true,
    ...(journalFailure ? { journalFailureReported: true } : {}) });
  reportName = `recovery-${writerBlocksRollback ? 'writer' : 'journal'}-integration-result.json`;
} else {
  for (const [name, directory, expected] of [['install', install, oldInstall], ['shared', home, oldHome], ['electron', electron, oldElectron]]) {
    const observed = await snapshotTree(directory, path.join(root, `observed-${name}`));
    assert.equal(snapshotInventoryDigest(observed), snapshotInventoryDigest(expected), `${name} must exactly match its old-generation snapshot`);
  }
  assert.equal(await fs.readFile(path.join(helper, 'metadata-actions.txt'), 'utf8'), earlyFailure ? 'Snapshot\r\n' : 'Snapshot\r\nRestoreShortcuts\r\nRestore\r\n');
  const rejected = await fs.readdir(path.join(helper, 'rejected-candidates'));
  assert.equal(rejected.length, 1); assert.equal(JSON.parse(await fs.readFile(path.join(helper, 'rejected-candidates', rejected[0]), 'utf8')).active, true);
  // Rediscovering the same cache on a new launch must not bypass its persistent rejection.
  await atomicJson(path.join(helper, 'status.json'), ready);
  const retry = JSON.parse((await invoke('preflight')).stdout); assert.equal(retry.phase, 'blocked'); assert.match(retry.detail, /is quarantined/);
  Object.assign(report, { fault: invalidDataProbe ? 'Probe exits zero with invalid JSON' : healthNonzero ? 'Health child writes a valid receipt then exits seven' : 'Installed final health rejected after installation and both data roots were promoted',
    programRestored: true, sharedDataRestored: true, desktopSettingsRestored: true, candidateQuarantined: true, automaticRetryBlocked: true,
    ...(earlyFailure ? { installerNeverInvoked: true, originalStateUnchanged: true, rollbackPerformed: false } : { metadataRestorationRequested: true, rollbackPerformed: true }) });
  reportName = invalidDataProbe ? 'recovery-invalid-data-probe-result.json' : healthNonzero ? 'recovery-health-nonzero-result.json' : 'recovery-integration-result.json';
}
await atomicJson(path.join(workspace, reportName), report);
console.log(JSON.stringify(report, null, 2));
