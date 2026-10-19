import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { acquireLock, atomicJson, Blocked, main } from './upgrade-worker.mjs';

async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function patch(t, name, implementation) {
  const original = fs[name];
  fs[name] = implementation(original);
  syncBuiltinESMExports();
  t.after(() => { fs[name] = original; syncBuiltinESMExports(); });
}

const leftoverNames = async root => (await fs.readdir(root)).filter(name => name.startsWith('.worker-lock-'));

test('a Windows hard link publishes complete ownership bytes and each contender cleans only its temporary name', async t => {
  const root = await temporary(t); const lockPath = path.join(root, 'worker.lock');
  const foreign = path.join(root, '.worker-lock-foreign.tmp'); await fs.writeFile(foreign, 'another pending contender');
  let publications = 0;
  patch(t, 'link', original => async (source, target) => {
    assert.equal(target, lockPath);
    const before = JSON.parse(await fs.readFile(source, 'utf8'));
    assert.equal(before.pid, process.pid); assert.equal(typeof before.token, 'string');
    assert.ok(before.startedAt);
    await original(source, target);
    assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')), before);
    assert.equal((await fs.stat(target)).nlink, 2);
    publications++;
  });
  const release = await acquireLock(root);
  assert.equal(publications, 1);
  assert.deepEqual(await leftoverNames(root), [path.basename(foreign)]);
  await release();
  await assert.rejects(fs.stat(lockPath), { code: 'ENOENT' });
  assert.equal(await fs.readFile(foreign, 'utf8'), 'another pending contender');
});

test('simultaneous atomic lock contenders admit exactly one owner without corrupting its file', async t => {
  const root = await temporary(t);
  const outcomes = await Promise.allSettled(Array.from({ length: 12 }, () => acquireLock(root)));
  const accepted = outcomes.filter(item => item.status === 'fulfilled');
  assert.equal(accepted.length, 1);
  for (const failure of outcomes.filter(item => item.status === 'rejected')) {
    assert.ok(failure.reason instanceof Blocked); assert.equal(failure.reason.lockState, 'busy');
  }
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'worker.lock'), 'utf8')).pid, process.pid);
  assert.deepEqual(await leftoverNames(root), []);
  await accepted[0].value();
});

test('a completed owner disappearing after EEXIST permits a bounded new atomic acquisition', async t => {
  const root = await temporary(t); const lockPath = path.join(root, 'worker.lock');
  await atomicJson(lockPath, { pid: process.pid, token: 'previous-completed-owner' });
  let read = false;
  patch(t, 'readFile', original => async (...args) => {
    if (args[0] === lockPath && !read) {
      read = true; await fs.unlink(lockPath);
      throw Object.assign(new Error('owner completed between link EEXIST and read'), { code: 'ENOENT' });
    }
    return original(...args);
  });
  const release = await acquireLock(root);
  assert.equal(read, true);
  assert.notEqual(JSON.parse(await fs.readFile(lockPath, 'utf8')).token, 'previous-completed-owner');
  await release();
  assert.deepEqual(await leftoverNames(root), []);
});

test('a lock disappearing during status is ordinary completion and rereads the latest successful status', async t => {
  const root = await temporary(t); const lockPath = path.join(root, 'worker.lock'); const statusPath = path.join(root, 'status.json');
  const configPath = path.join(root, 'config.json');
  await atomicJson(configPath, { schemaVersion: 1, root });
  await atomicJson(statusPath, { schemaVersion: 1, phase: 'building', detail: 'earlier observation' });
  await atomicJson(lockPath, { pid: process.pid, token: 'completed-owner' });
  let removed = false;
  patch(t, 'readFile', original => async (...args) => {
    if (args[0] === lockPath && !removed) {
      removed = true;
      await atomicJson(statusPath, { schemaVersion: 1, phase: 'ready', detail: 'completed build' });
      await fs.unlink(lockPath);
      throw Object.assign(new Error('owner completed before lock read'), { code: 'ENOENT' });
    }
    return original(...args);
  });
  const state = await main(['status', '--config', configPath]);
  assert.equal(state.phase, 'ready'); assert.equal(state.detail, 'completed build');
  await assert.rejects(fs.stat(lockPath), { code: 'ENOENT' });
});

test('malformed and dead locks remain byte-for-byte inspection barriers', async t => {
  const root = await temporary(t); const lockPath = path.join(root, 'worker.lock'); const configPath = path.join(root, 'config.json');
  await atomicJson(configPath, { schemaVersion: 1, root });
  await atomicJson(path.join(root, 'status.json'), { schemaVersion: 1, phase: 'ready' });
  for (const bytes of ['', 'not-json', '{}', JSON.stringify({ pid: 2147483647, token: 'interrupted' })]) {
    await fs.writeFile(lockPath, bytes);
    await assert.rejects(acquireLock(root), error => error instanceof Blocked && error.lockState === 'interrupted');
    assert.equal(await fs.readFile(lockPath, 'utf8'), bytes);
    const state = await main(['status', '--config', configPath]); assert.equal(state.phase, 'blocked');
    assert.equal(await fs.readFile(lockPath, 'utf8'), bytes);
    assert.deepEqual(await leftoverNames(root), []);
  }
});

test('repeated completion contention has a finite acquisition budget and remains observable as busy', async t => {
  const root = await temporary(t); let attempts = 0;
  patch(t, 'link', () => async () => { attempts++; throw Object.assign(new Error('completed contender'), { code: 'EEXIST' }); });
  await assert.rejects(acquireLock(root), error => error instanceof Blocked && error.lockState === 'busy');
  assert.equal(attempts, 3);
  assert.deepEqual(await leftoverNames(root), []);
  await assert.rejects(fs.stat(path.join(root, 'worker.lock')), { code: 'ENOENT' });
});

test('failed publication cleans only this unpublished temporary while preserving unrelated evidence', async t => {
  const root = await temporary(t); const foreign = path.join(root, '.worker-lock-foreign.tmp'); await fs.writeFile(foreign, 'retain');
  patch(t, 'link', () => async () => { throw Object.assign(new Error('fixture unsupported filesystem'), { code: 'ENOTSUP' }); });
  await assert.rejects(acquireLock(root), { code: 'ENOTSUP' });
  assert.deepEqual(await leftoverNames(root), [path.basename(foreign)]);
  await assert.rejects(fs.stat(path.join(root, 'worker.lock')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(foreign, 'utf8'), 'retain');
});

test('release refuses changed ownership and never removes its replacement', async t => {
  const root = await temporary(t); const lockPath = path.join(root, 'worker.lock');
  const release = await acquireLock(root);
  const replacement = { pid: process.pid, token: 'external-replacement-owner' };
  await atomicJson(lockPath, replacement);
  await assert.rejects(release(), /Update lock ownership changed/);
  assert.deepEqual(JSON.parse(await fs.readFile(lockPath, 'utf8')), replacement);
});
