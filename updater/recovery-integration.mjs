/** Exercise the real apply coordinator with fixture processes and three disposable state roots. */
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { atomicJson, hashFile, snapshotTree, snapshotInventoryDigest } from './upgrade-worker.mjs';
const execute = promisify(execFile);
const own = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const usage = 'Usage: node recovery-integration.mjs --fixture-config ABS_JSON --compatible-manifest ABS_JSON --workspace ABS_OWNED_SANDBOX [--writer-blocks-rollback | --journal-failure]. Never supply a production updater configuration.';
const requiredAbsolute = flag => {
  const index = args.indexOf(flag);
  if (index < 0 || args.lastIndexOf(flag) !== index || !args[index + 1] || !path.isAbsolute(args[index + 1])) throw new Error(usage);
  return path.resolve(args[index + 1]);
};
// All required arguments are checked before reading any configuration or creating a temporary directory.
const fixtureConfigPath = requiredAbsolute('--fixture-config');
const compatibleManifestPath = requiredAbsolute('--compatible-manifest');
const workspace = requiredAbsolute('--workspace');
const writerBlocksRollback = args.includes('--writer-blocks-rollback');
const journalFailure = args.includes('--journal-failure');
if (writerBlocksRollback && journalFailure) throw new Error(usage);
if (process.platform !== 'win32') throw new Error('This explicit recovery fixture requires Windows.');
const windowsPowerShell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const workspaceStat = await fs.lstat(workspace);
if (!workspaceStat.isDirectory() || workspaceStat.isSymbolicLink() || workspace === path.parse(workspace).root) throw new Error('An existing physical disposable workspace is required.');
if ((await fs.realpath(workspace)).toLowerCase() !== workspace.toLowerCase()) throw new Error('Recovery workspace must use its physical path.');
const owner = JSON.parse((await execute(windowsPowerShell, ['-NoProfile', '-NonInteractive', '-File', path.join(own, 'inspect-build-cache.ps1'), '-CachePath', workspace], { windowsHide: true })).stdout);
assert.equal(owner.ownedByCurrentUser, true, 'Recovery workspace must be owned by the current Windows account.');
const fixtureConfig = JSON.parse(await fs.readFile(fixtureConfigPath, 'utf8'));
const plugins = JSON.parse(await fs.readFile(compatibleManifestPath, 'utf8'));
const root = await fs.mkdtemp(path.join(workspace, 'rollback-fixture-'));
const fixture = path.join(root, 'UpdateFixture.exe');
await execute(windowsPowerShell, ['-NoProfile', '-NonInteractive', '-File', path.join(own, 'tests/compile-recovery-fixture.ps1'), '-Source', path.join(own, 'tests/RecoveryFixture.cs'), '-OutputPath', fixture], { windowsHide: true });
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
await fs.writeFile(path.join(helper, 'data-probe.mjs'), "import fs from 'node:fs/promises';import path from 'node:path';const args=process.argv.slice(2);const home=args[args.indexOf('--home')+1];await fs.writeFile(path.join(home,'history-version.txt'),'new-history');console.log(JSON.stringify({sessionsRead:0,preexistingUnreadable:0}));\n");
const oldInstall = await snapshotTree(install, path.join(root, 'expected-install'));
const oldHome = await snapshotTree(home, path.join(root, 'expected-shared'));
const oldElectron = await snapshotTree(electron, path.join(root, 'expected-electron'));
const programDigest = snapshotInventoryDigest(oldInstall); const inventoryDigest = snapshotInventoryDigest(oldHome, true);
await atomicJson(path.join(helper, 'history-baselines', `${programDigest}-${inventoryDigest}.json`), { schemaVersion: 1, version: '0.2.0-rc.2', sessions: [], readable: 0, preexistingUnreadable: 0, programDigest, inventoryDigest });
const config = { ...fixtureConfig, root: helper, installDir: install, sharedDataDir: home, userDataDir: electron, dataProbe: path.join(helper, 'data-probe.mjs'), healthTimeoutMs: 15000 };
const configPath = path.join(helper, 'updater-config.json'); await atomicJson(configPath, config);
const target = { version: plugins.targetVersion, tag: `dsh-v${plugins.targetVersion}`, commit: plugins.targetCommit };
await atomicJson(path.join(helper, 'status.json'), { schemaVersion: 1, phase: 'ready', target, targetPlugins: plugins.plugins, artifactPath: fixture, artifactSha256: await hashFile(fixture), unpackedApp: fixture, buildRoot: path.join(root, 'build'), sourceBuild: true, unsigned: true, appId: 'com.deepseek.dsh' });
const exited = spawn(fixture, ['--fixture-exit'], { windowsHide: true }); const appPid = exited.pid;
await new Promise((resolve, reject) => { exited.once('error', reject); exited.once('exit', resolve); });
const request = { schemaVersion: 1, target, appPid, installDir: install, sharedDataDir: home, userDataDir: electron, admission: { idleMs: 60000, draftsSaved: true, drained: true, activeTasks: 0, pendingApprovals: 0, queuedMessages: 0, backgroundJobs: 0 } };
const requestPath = path.join(root, 'apply.json'); await atomicJson(requestPath, request);
const environment = { ...process.env, ...(writerBlocksRollback ? { DSH_FIXTURE_RECOVERY_WRITER_MARKER: path.join(root, 'writer-active.marker') } : {}), ...(journalFailure ? { DSH_FIXTURE_RECOVERY_JOURNAL_FAILURE: '1' } : {}) };
let result;
try { result = await execute(process.execPath, [path.join(helper, 'upgrade-worker.mjs'), 'apply', '--config', configPath, '--request-path', requestPath], { env: environment, windowsHide: true, maxBuffer: 1024 * 1024, timeout: 120000 }); }
catch (error) {
  if ((!writerBlocksRollback && !journalFailure) || error.code !== 3) throw error;
  result = error;
}
await fs.writeFile(path.join(root, 'worker-output.log'), result.stdout + result.stderr);
const status = JSON.parse(await fs.readFile(path.join(helper, 'status.json'), 'utf8'));
assert.equal(status.phase, writerBlocksRollback || journalFailure ? 'recovery-required' : 'rolled-back');
assert.match(status.detail, writerBlocksRollback ? /Data writers still running: fixture-active-writer:99999/ : journalFailure ? /Matched rollback could not finish/ : /installed-final health receipt failed required checks/);
const journalPath = path.join(status.transaction, 'transaction.json');
const tx = JSON.parse(await fs.readFile(journalFailure ? `${journalPath}.before-fixture-fault` : journalPath, 'utf8'));
assert.ok(tx.promoted.sharedDataDir && tx.promoted.userDataDir, 'failure must occur after data and settings promotion');
if (writerBlocksRollback || journalFailure) {
  const lockPath = path.join(helper, 'worker.lock');
  assert.ok((await fs.stat(lockPath)).isFile(), 'unresolved transaction must retain its worker lock');
  if (!journalFailure) assert.equal(tx.stage, 'recovery-required');
  else assert.ok(status.journalFailure, 'journal failure must be reported without dropping the lock');
  assert.equal(await fs.readFile(path.join(install, 'version.txt'), 'utf8'), 'new-program');
  assert.equal(await fs.readFile(path.join(home, 'history-version.txt'), 'utf8'), 'new-history');
  assert.equal(await fs.readFile(path.join(electron, 'settings.json'), 'utf8'), '{"schema":2}');
  assert.equal(await fs.readFile(path.join(helper, 'metadata-actions.txt'), 'utf8'), 'Snapshot\r\nRestoreShortcuts\r\n');
  const snapshot = await execute(process.execPath, [path.join(helper, 'upgrade-worker.mjs'), 'status', '--config', configPath], { windowsHide: true });
  assert.equal(JSON.parse(snapshot.stdout).phase, 'recovery-required', 'status must preserve the unresolved recovery state after worker exit');
  let retry;
  try { await execute(process.execPath, [path.join(helper, 'upgrade-worker.mjs'), 'apply', '--config', configPath, '--request-path', requestPath], { windowsHide: true }); }
  catch (error) { retry = JSON.parse(error.stdout); }
  assert.equal(retry.phase, 'blocked');
  assert.match(retry.detail, /Interrupted update lock requires inspection/);
  const report = { pass: true, root, fault: writerBlocksRollback ? 'Writer inspection becomes active after final health failure' : 'Transaction journal becomes unwritable after final health failure', lockRetained: true, recoveryRequired: true, newProgramPreserved: true, migratedDataPreserved: true, migratedSettingsPreserved: true, automaticRetryBlocked: true, ...(journalFailure ? { journalFailureReported: true } : {}), scope: 'Real apply coordinator and Windows child processes; fixture installer, health, writer and metadata adapters; no live user data or registry writes' };
  await atomicJson(path.join(workspace, `recovery-${writerBlocksRollback ? 'writer' : 'journal'}-integration-result.json`), report);
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}
for (const [name, directory, expected] of [['install', install, oldInstall], ['shared', home, oldHome], ['electron', electron, oldElectron]]) {
  const observed = await snapshotTree(directory, path.join(root, `observed-${name}`));
  assert.equal(snapshotInventoryDigest(observed), snapshotInventoryDigest(expected), `${name} must exactly match its old-generation snapshot`);
}
assert.equal(await fs.readFile(path.join(helper, 'metadata-actions.txt'), 'utf8'), 'Snapshot\r\nRestoreShortcuts\r\nRestore\r\n');
const report = { pass: true, root, fault: 'Installed final health rejected after program installation and both data roots were promoted', programRestored: true, sharedDataRestored: true, desktopSettingsRestored: true, metadataRestorationRequested: true, scope: 'Real apply coordinator and Windows child processes; fixture installer, health responder and metadata adapter; no live user data or registry writes' };
await atomicJson(path.join(workspace, 'recovery-integration-result.json'), report);
console.log(JSON.stringify(report, null, 2));
