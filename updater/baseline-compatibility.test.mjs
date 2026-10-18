import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { assertActivePlugins, hashFile, snapshotInventoryDigest } from './upgrade-worker.mjs';
import { loadHistoryBaseline, matchPreexistingHistoryFailure } from './baseline-compatibility.mjs';

test('baseline exceptions require identical old failure and unchanged raw bytes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-baseline-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const relative = 'sessions/old/session.jsonl.zstd'; const raw = path.join(root, relative);
  await fs.mkdir(path.dirname(raw), { recursive: true }); await fs.writeFile(raw, 'original unsupported bytes');
  const entry = { id: 'old', readable: false, errorName: 'SessionFormatUnsupportedError', reason: 'unsupported v2 at <isolated>/sessions/old', sourceFiles: [{ relative, sha256: await hashFile(raw) }] };
  const filename = path.join(root, 'baseline.json');
  await fs.writeFile(filename, JSON.stringify({ schemaVersion: 1, version: '0.2.0-rc.2', sessions: [entry, { id: 'working', readable: true }] }));
  const baseline = await loadHistoryBaseline(filename);
  const error = Object.assign(new Error(`unsupported v2 at ${root}/sessions/old`), { name: 'SessionFormatUnsupportedError' });
  assert.equal((await matchPreexistingHistoryFailure(baseline, 'old', error, root)).id, 'old');
  await assert.rejects(matchPreexistingHistoryFailure(baseline, 'working', error, root), error);
  await assert.rejects(matchPreexistingHistoryFailure(baseline, 'unknown', error, root), error);
  await assert.rejects(matchPreexistingHistoryFailure(baseline, 'old', new Error('new incompatible migration'), root), /failure changed/);
  await fs.writeFile(raw, 'changed raw history');
  await assert.rejects(matchPreexistingHistoryFailure(baseline, 'old', error, root), /raw history changed/);
  await fs.writeFile(filename, JSON.stringify({ schemaVersion: 1, version: 'old', sessions: [{ ...entry, sourceFiles: [] }] }));
  await assert.rejects(loadHistoryBaseline(filename), /lacks exact failure/);
});

test('baseline cache keys cover complete program bytes and each raw history generation', () => {
  const first = { entries: [{ kind: 'file', relative: 'sessions\\cwd\\id\\session.jsonl.zstd', sha256: 'a'.repeat(64) }, { kind: 'file', relative: 'cache/state', sha256: 'b'.repeat(64) }] };
  const second = { entries: [{ ...first.entries[0], relative: 'sessions/cwd/id/session.jsonl.zstd' }, { ...first.entries[1], sha256: 'c'.repeat(64) }] };
  assert.equal(snapshotInventoryDigest(first, true), snapshotInventoryDigest(second, true));
  assert.notEqual(snapshotInventoryDigest(first), snapshotInventoryDigest(second));
  second.entries.push({ ...first.entries[0], relative: 'sessions/cwd/id/session.v4.jsonl.zstd', sha256: 'd'.repeat(64) });
  assert.notEqual(snapshotInventoryDigest(first, true), snapshotInventoryDigest(second, true));
});

test('manual plugin version and runtime edits cannot be replaced by the pinned baseline', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-active-plugin-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const original = path.join(root, 'baseline'); const home = path.join(root, 'home');
  const active = path.join(home, 'profiles/desktop/node_modules/@local/example');
  await fs.mkdir(original, { recursive: true }); await fs.mkdir(active, { recursive: true });
  const manifest = { name: '@local/example', version: '0.1.14', main: 'index.js', dependencies: { zod: '4.6.5' } };
  await fs.writeFile(path.join(home, 'profiles/desktop/package.json'), JSON.stringify({ dependencies: { [manifest.name]: manifest.version } }));
  for (const directory of [original, active]) {
    await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify(manifest));
    await fs.writeFile(path.join(directory, 'index.js'), 'original runtime');
  }
  const config = { plugins: [{ name: manifest.name, version: manifest.version, path: original, files: { 'index.js': await hashFile(path.join(original, 'index.js')) } }] };
  await assertActivePlugins(config, home);
  await fs.writeFile(path.join(active, 'package.json'), JSON.stringify({ ...manifest, version: '0.1.14+dsh.0.2.1-alpha.5' }));
  await assert.rejects(assertActivePlugins(config, home), /explicit trusted activePluginPins/);
  config.activePluginPins = path.join(root, 'trusted-active-plugins.json');
  await fs.writeFile(config.activePluginPins, JSON.stringify({ plugins: [{ name: manifest.name, version: '0.1.14+dsh.0.2.1-alpha.5', files: { 'package.json': await hashFile(path.join(active, 'package.json')), 'index.js': await hashFile(path.join(active, 'index.js')) } }] }));
  await assertActivePlugins(config, home);
  await fs.writeFile(path.join(active, 'index.js'), 'manual feature change');
  await assert.rejects(assertActivePlugins(config, home), /Active plugin file changed: @local\/example\/index.js/);
  await fs.writeFile(path.join(active, 'package.json'), JSON.stringify({ ...manifest, version: '0.1.15' }));
  await assert.rejects(assertActivePlugins(config, home), /Active plugin changed/);
});
