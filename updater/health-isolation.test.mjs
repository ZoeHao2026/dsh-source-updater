/** Real Node subprocesses exercise health launch paths without starting Electron or reading a user profile. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { atomicJson } from './upgrade-worker.mjs';

const execute = promisify(execFile);
const workerUrl = new URL('./upgrade-worker.mjs', import.meta.url).href;

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-health-cwd-')));
  t.after(async () => {
    assert.ok(root.startsWith(await fs.realpath(os.tmpdir()) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  const install = path.join(root, 'synthetic-install');
  await fs.mkdir(install);
  const originalLog = Buffer.from('existing synthetic installation debug log\n');
  await fs.writeFile(path.join(install, 'debug.log'), originalLog);
  const inheritedLog = path.join(install, 'inherited-chromium.log');
  const configPath = path.join(root, 'helper-config.json');
  await atomicJson(configPath, { schemaVersion: 1, fixtureOnly: true });
  const childScript = path.join(root, 'synthetic-health.mjs');
  await fs.writeFile(childScript, `
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
const args = process.argv.slice(2);
const value = name => args.find(item => item.startsWith(name + '='))?.slice(name.length + 1);
const request = JSON.parse(await fs.readFile(value('--source-update-health'), 'utf8'));
// An early runtime write follows cwd before the synthetic health protocol starts.
await fs.appendFile(path.join(process.cwd(), 'debug.log'), 'synthetic early runtime log\\n');
const cliLog = value('--log-file');
assert.ok(cliLog && path.isAbsolute(cliLog));
await fs.appendFile(cliLog, 'synthetic CLI-directed Chromium log\\n');
assert.ok(process.env.ELECTRON_LOG_FILE);
await fs.appendFile(process.env.ELECTRON_LOG_FILE, 'synthetic environment-directed Chromium log\\n');
await fs.writeFile(path.join(path.dirname(request.receiptPath), 'observed-launch.json'), JSON.stringify({
  cwd: process.cwd(), args, home: process.env.DSH_HOME,
  configPath: process.env.DSH_SOURCE_UPDATER_CONFIG,
  schedulesDisabled: process.env.DSH_SOURCE_UPDATE_DISABLE_SCHEDULES,
  runAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null,
  environmentLog: process.env.ELECTRON_LOG_FILE, request,
}));
await fs.writeFile(request.receiptPath, JSON.stringify({ token: request.token, version: request.version,
  commit: request.commit, appId: request.appId, profileLoaded: true, schedulesDisabled: true,
  pluginsLoaded: true, pluginVersions: Object.fromEntries(request.plugins.map(item => [item.name, item.version])),
}));
const deadline = Date.now() + 8000;
for (;;) {
  try {
    const release = JSON.parse(await fs.readFile(request.releasePath, 'utf8'));
    assert.equal(release.token, request.token); assert.equal(release.action, 'exit');
    await fs.writeFile(path.join(path.dirname(request.receiptPath), 'graceful-release-observed.json'), JSON.stringify(release));
    break;
  } catch (error) {
    if (error.code !== 'ENOENT' || Date.now() > deadline) throw error;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
process.exitCode = Number(process.env.DSH_SYNTHETIC_HEALTH_EXIT);
`);
  return { root, install, originalLog, inheritedLog, configPath, childScript };
}

async function invoke(f, phase, exitCode = 0) {
  const transaction = path.join(f.root, `${phase}-${exitCode}`);
  const state = { transaction, isolatedSharedDataDir: path.join(transaction, 'shared'),
    isolatedUserDataDir: path.join(transaction, 'electron'),
    target: { version: '0.2.1-alpha.5', commit: 'a'.repeat(40) },
    targetPlugins: [{ name: '@local/selector', version: '0.2.3+dsh.0.2.1-alpha.5' }] };
  for (const directory of [state.isolatedSharedDataDir, state.isolatedUserDataDir]) await fs.mkdir(directory, { recursive: true });
  const payload = { config: { configPath: f.configPath, healthTimeoutMs: 10_000 }, state, phase };
  const wrapper = `
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const spawn = cp.spawn;
cp.spawn = (executable, args, options) => {
  if (executable !== process.execPath) throw new Error('Unexpected non-fixture executable');
  return spawn(executable, [${JSON.stringify(f.childScript)}, ...args], options);
};
syncBuiltinESMExports();
const { health } = await import(${JSON.stringify(workerUrl)});
const { config, state, phase } = JSON.parse(process.argv[1]);
const receipt = await health(config, process.execPath, {}, state, phase);
process.stdout.write(JSON.stringify(receipt));
`;
  const environment = { ...process.env, ELECTRON_LOG_FILE: f.inheritedLog, ELECTRON_ENABLE_LOGGING: '1',
    ELECTRON_RUN_AS_NODE: '1', DSH_HOME: path.join(f.install, 'wrong-home'), DSH_SYNTHETIC_HEALTH_EXIT: String(exitCode) };
  // The launcher itself inherits the simulated installed program directory, as the real updater did.
  const outcome = await execute(process.execPath, ['--input-type=module', '-e', wrapper, JSON.stringify(payload)], {
    cwd: f.install, env: environment, windowsHide: true, timeout: 20_000,
  }).then(result => ({ code: 0, stdout: result.stdout }), error => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }));
  return { state, phase, outcome };
}

async function verifyPrivateLaunch(f, result) {
  const { state, phase } = result;
  const observed = JSON.parse(await fs.readFile(path.join(state.transaction, 'observed-launch.json'), 'utf8'));
  assert.equal(observed.cwd, state.transaction);
  assert.equal(observed.home, state.isolatedSharedDataDir);
  assert.equal(observed.configPath, f.configPath);
  assert.equal(observed.schedulesDisabled, '1');
  assert.equal(observed.runAsNode, null);
  assert.equal(observed.request.phase, phase);
  assert.equal(observed.request.homePath, state.isolatedSharedDataDir);
  assert.equal(observed.request.userDataPath, state.isolatedUserDataDir);
  assert.equal(observed.request.disableSchedules, true);
  assert.equal(observed.request.blockAdmissions, true);
  assert.deepEqual(observed.request.plugins, state.targetPlugins);
  assert.ok(observed.args.includes(`--user-data-dir=${state.isolatedUserDataDir}`));
  assert.ok(observed.args.includes('--enable-logging=file'));
  const chromiumLog = path.join(state.transaction, `${phase}-chromium.log`);
  assert.ok(observed.args.includes(`--log-file=${chromiumLog}`));
  assert.equal(observed.environmentLog, chromiumLog);
  assert.match(await fs.readFile(chromiumLog, 'utf8'), /CLI-directed[\s\S]+environment-directed/);
  assert.match(await fs.readFile(path.join(state.transaction, 'debug.log'), 'utf8'), /early runtime log/);
  const release = JSON.parse(await fs.readFile(path.join(state.transaction, 'graceful-release-observed.json'), 'utf8'));
  assert.equal(release.token, observed.request.token);
  assert.equal(release.action, 'exit');
  assert.deepEqual(await fs.readFile(path.join(f.install, 'debug.log')), f.originalLog);
  await assert.rejects(fs.stat(f.inheritedLog), { code: 'ENOENT' });
}

test('all health phases confine early and Chromium logs while preserving the request and graceful exit protocol', async t => {
  const f = await fixture(t);
  for (const phase of ['isolated', 'installed', 'installed-final']) {
    const result = await invoke(f, phase);
    assert.equal(result.outcome.code, 0, result.outcome.stderr);
    const receipt = JSON.parse(result.outcome.stdout);
    assert.equal(receipt.version, result.state.target.version);
    assert.equal(receipt.commit, result.state.target.commit);
    assert.equal(receipt.pluginsLoaded, true);
    await verifyPrivateLaunch(f, result);
  }
});

test('a private healthy receipt still fails when the released child exits with a nonzero status', async t => {
  const f = await fixture(t);
  const result = await invoke(f, 'installed-final', 7);
  assert.notEqual(result.outcome.code, 0);
  assert.match(result.outcome.stderr, /health child did not exit successfully: 7/);
  await verifyPrivateLaunch(f, result);
});
