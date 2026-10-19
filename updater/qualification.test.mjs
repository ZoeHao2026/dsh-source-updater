import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { assertActivePlugins, atomicJson, commitUpdaterQualification, hashFile, planUpdaterQualification, restoreUpdaterQualification, snapshotUpdaterQualification, stageCompatiblePlugins, verifyUpdaterQualification } from './upgrade-worker.mjs';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dq-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'helper'); const home = path.join(directory, 'home');
  const baseline = path.join(directory, 'baseline'); const candidate = path.join(directory, 'candidate');
  const name = '@local/selector'; const version = '0.2.3';
  const active = path.join(home, 'profiles/desktop/node_modules', name);
  for (const value of [root, baseline, candidate, active]) await fs.mkdir(value, { recursive: true });
  const manifest = { name, version, type: 'module', main: 'index.js' };
  for (const value of [baseline, active, candidate]) {
    await atomicJson(path.join(value, 'package.json'), manifest);
    await fs.writeFile(path.join(value, 'index.js'), 'export const unchangedRuntime = true;\n');
  }
  await atomicJson(path.join(active, 'package.json'), { ...manifest, version: '0.2.3+dsh.0.2.1-alpha.5' });
  const target = { version: '0.2.1-rc.2', tag: 'dsh-v0.2.1-rc.2', commit: 'a'.repeat(40) };
  await atomicJson(path.join(candidate, 'package.json'), { ...manifest, version: `${version}+dsh.${target.version}` });
  const filesFor = async value => Object.fromEntries(await Promise.all(['package.json', 'index.js'].map(async relative => [relative, await hashFile(path.join(value, relative))])));
  const plugins = [{ name, version, path: baseline, files: await filesFor(baseline) }];
  const pinsPath = path.join(root, 'trusted-active-plugins.json');
  await atomicJson(pinsPath, { schemaVersion: 1, plugins: [{ name, version: '0.2.3+dsh.0.2.1-alpha.5', files: await filesFor(active) }] });
  const config = { schemaVersion: 1, root, sharedDataDir: home, currentVersion: '0.2.1-alpha.5', activePluginPins: pinsPath, plugins };
  const configPath = path.join(root, 'updater-config.json'); await atomicJson(configPath, config);
  await atomicJson(path.join(home, 'profiles/desktop/package.json'), { dependencies: { [name]: 'existing-qualified-package' }, dsh: { profile: { bundles: [name] } } });
  const archive = path.join(directory, 'candidate.tgz'); await fs.writeFile(archive, 'fixture-only archive');
  const targetPlugins = [{ name, version: `${version}+dsh.${target.version}`, path: candidate, files: await filesFor(candidate), archive, archiveSha256: await hashFile(archive) }];
  const state = { target, targetPlugins };
  const transaction = path.join(root, 'transactions', 'fixture'); await fs.mkdir(transaction, { recursive: true });
  const journalPath = path.join(transaction, 'transaction.json');
  const qualification = await snapshotUpdaterQualification({ ...config, configPath }, configPath, transaction);
  const tx = { transaction, qualification, stage: 'installed-validation' };
  const originals = { config: await fs.readFile(configPath), pins: await fs.readFile(pinsPath) };
  return { directory, root, home, active, config, configPath, pinsPath, state, tx, journalPath, originals };
}

test('verified candidate pins and actual installed version advance together and permit the next released update', async t => {
  const f = await fixture(t);
  await assertActivePlugins(f.config, f.home);
  await stageCompatiblePlugins(f.state.targetPlugins, f.home);
  const planned = await planUpdaterQualification(f.config, f.state, f.home, f.tx.qualification);
  assert.deepEqual(planned.pins.value.plugins[0].files, f.state.targetPlugins[0].files);
  await commitUpdaterQualification(f.tx, f.journalPath, planned);
  const currentConfig = JSON.parse(await fs.readFile(f.configPath, 'utf8'));
  const currentPins = JSON.parse(await fs.readFile(f.pinsPath, 'utf8'));
  assert.equal(currentConfig.currentVersion, f.state.target.version);
  assert.equal(currentPins.plugins[0].version, f.state.targetPlugins[0].version);
  await assertActivePlugins(currentConfig, f.home);
  const saved = JSON.parse(await fs.readFile(f.journalPath, 'utf8'));
  assert.equal(saved.stage, 'committing-updater-qualification');
  assert.equal(saved.qualification.files.pins.committedSha256, await hashFile(f.pinsPath));
  assert.equal(saved.qualification.files.config.committedSha256, await hashFile(f.configPath));
  const nextTx = path.join(f.root, 'transactions', 'next'); await fs.mkdir(nextTx);
  await snapshotUpdaterQualification({ ...currentConfig, configPath: f.configPath }, f.configPath, nextTx);
});

test('a modified promoted runtime cannot be promoted into a new trust record', async t => {
  const f = await fixture(t);
  await stageCompatiblePlugins(f.state.targetPlugins, f.home);
  await fs.writeFile(path.join(f.active, 'index.js'), 'unreviewed manual feature');
  await assert.rejects(planUpdaterQualification(f.config, f.state, f.home, f.tx.qualification), /Promoted plugin differs/);
  assert.deepEqual(await fs.readFile(f.pinsPath), f.originals.pins);
  assert.deepEqual(await fs.readFile(f.configPath), f.originals.config);
});

test('a partial pins commit is restored byte-for-byte with the matching old configuration', async t => {
  const f = await fixture(t);
  await stageCompatiblePlugins(f.state.targetPlugins, f.home);
  const planned = await planUpdaterQualification(f.config, f.state, f.home, f.tx.qualification);
  f.tx.qualification.planned = planned;
  f.tx.stage = 'committing-updater-qualification';
  await atomicJson(f.journalPath, f.tx);
  // Simulate interruption after the first atomic rename and before the config rename.
  await atomicJson(f.pinsPath, planned.pins.value);
  await restoreUpdaterQualification(f.tx.qualification);
  assert.deepEqual(await fs.readFile(f.pinsPath), f.originals.pins);
  assert.deepEqual(await fs.readFile(f.configPath), f.originals.config);
  await verifyUpdaterQualification(f.tx.qualification);
});

test('external helper edits block commit and matching restoration without overwriting either file', async t => {
  const f = await fixture(t);
  await stageCompatiblePlugins(f.state.targetPlugins, f.home);
  const planned = await planUpdaterQualification(f.config, f.state, f.home, f.tx.qualification);
  const external = { ...f.config, healthTimeoutMs: 123456 };
  await atomicJson(f.configPath, external);
  await assert.rejects(commitUpdaterQualification(f.tx, f.journalPath, planned), /changed since its transaction snapshot/);
  await assert.rejects(restoreUpdaterQualification(f.tx.qualification), /changed externally/);
  assert.deepEqual(JSON.parse(await fs.readFile(f.configPath, 'utf8')), external);
  assert.deepEqual(await fs.readFile(f.pinsPath), f.originals.pins);
});

test('a corrupted qualification backup is never used to restore helper state', async t => {
  const f = await fixture(t);
  await fs.writeFile(f.tx.qualification.files.pins.backupPath, 'changed backup');
  await assert.rejects(verifyUpdaterQualification(f.tx.qualification), /changed since/);
  await assert.rejects(restoreUpdaterQualification(f.tx.qualification), /backup changed/);
  assert.deepEqual(await fs.readFile(f.pinsPath), f.originals.pins);
});

test('qualification paths require the actual helper-local CLI file and a separate nonlinked pin record', async t => {
  const f = await fixture(t);
  const attempt = async (config, filename) => {
    const transaction = await fs.mkdtemp(path.join(f.root, 'tx-'));
    return snapshotUpdaterQualification(config, filename, transaction);
  };
  const outside = path.join(f.directory, 'outside.json'); await atomicJson(outside, f.config);
  await assert.rejects(attempt(f.config, outside), /inside the configured helper root/);
  await assert.rejects(attempt({ ...f.config, activePluginPins: f.configPath }, f.configPath), /configuration changed|distinct files/);
  await assert.rejects(attempt({ ...f.config, currentVersion: 'wrong-loaded-version' }, f.configPath), /changed after the CLI loaded/);
  const link = path.join(f.root, 'linked.json');
  try { await fs.symlink(f.configPath, link, 'file'); }
  catch (error) { if (!['EPERM', 'EACCES'].includes(error.code)) throw error; return; }
  await assert.rejects(attempt(f.config, link), /Linked transaction path/);
});

test('without an existing explicit trust record qualification advances only the actual installed version', async t => {
  const f = await fixture(t);
  delete f.config.activePluginPins;
  await atomicJson(f.configPath, f.config);
  const transaction = await fs.mkdtemp(path.join(f.root, 'tx-'));
  const qualification = await snapshotUpdaterQualification(f.config, f.configPath, transaction);
  await stageCompatiblePlugins(f.state.targetPlugins, f.home);
  const planned = await planUpdaterQualification(f.config, f.state, f.home, qualification);
  assert.equal(planned.pins, undefined);
  await commitUpdaterQualification({ transaction, qualification }, path.join(transaction, 'transaction.json'), planned);
  assert.equal(JSON.parse(await fs.readFile(f.configPath, 'utf8')).currentVersion, f.state.target.version);
  assert.deepEqual(await fs.readFile(f.pinsPath), f.originals.pins);
});
