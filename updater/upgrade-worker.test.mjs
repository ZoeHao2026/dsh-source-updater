import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { acquireLock, assertWithin, atomicJson, Blocked, compareVersions, ensureBuildCache, hashFile, latestPublished, requireManualRecovery, restoreTree, restorePreservedDependencyLinks, snapshotTree, sourceBuildLayout, sourceInstallArguments, validateAdmission, verifyPublishedTarget, verifySnapshot } from './upgrade-worker.mjs';

async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-updater-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('published alpha, beta, rc, stable ordering uses complete numeric prerelease identifiers', () => {
  const order = ['0.2.0-rc.2', '0.2.0', '0.2.1-alpha.5', '0.2.1-alpha.10', '0.2.1-beta.1', '0.2.1-rc.1', '0.2.1', '0.10.0'];
  for (let i = 1; i < order.length; i++) assert.equal(compareVersions(order[i], order[i - 1]), 1);
  assert.equal(compareVersions('0.2.1+source', '0.2.1+official'), 0);
  assert.throws(() => compareVersions('0.2.1-alpha.01', '0.2.1'));
  assert.equal(compareVersions('9007199254740993.0.0', '9007199254740992.0.0'), 1);
});

test('only published non-draft dsh tags participate and annotated tags resolve to immutable commits', async () => {
  const sha = 'a'.repeat(40);
  const fetcher = async url => ({ ok: true, json: async () => url.includes('/releases?') ? [
    { tag_name: 'dsh-v0.2.1-alpha.5', published_at: '2026-10-10' },
    { tag_name: 'dsh-v0.2.1-alpha.11', published_at: '2026-10-11' },
    { tag_name: 'dsh-v9.0.0', published_at: '2026-10-11', draft: true },
    { tag_name: 'desktop-v99.0.0', published_at: '2026-10-11' },
    { tag_name: 'dsh-v8.0.0' },
  ] : url.includes('/git/ref/') ? { object: { type: 'tag', sha: 'b'.repeat(40) } } : { object: { type: 'commit', sha } } });
  const result = await latestPublished('0.2.0-rc.2', fetcher);
  assert.deepEqual(result, { version: '0.2.1-alpha.11', tag: 'dsh-v0.2.1-alpha.11', commit: sha, sourceUrl: 'https://github.com/deepseek-ai/deepseek-harness.git' });
  assert.equal(await latestPublished('1.0.0', fetcher), undefined);
});

test('offline and unpublished targets fail before any build', async () => {
  await assert.rejects(latestPublished('0.2.0', async () => { throw new Error('offline'); }), /offline/);
  await assert.rejects(verifyPublishedTarget({ version: '0.2.1-alpha.5', tag: 'dsh-v0.2.1-alpha.5', commit: 'a'.repeat(40) }, async () => ({ ok: true, json: async () => ({ tag_name: 'dsh-v0.2.1-alpha.5', draft: true }) })), Blocked);
  await assert.rejects(verifyPublishedTarget({ version: '0.2.1', tag: 'master', commit: 'a'.repeat(40) }), Blocked);
});

test('input idle, drafts, task, approval, queue and job uncertainty block handoff', () => {
  const safe = { idleMs: 60_000, draftsSaved: true, drained: true, activeTasks: 0, pendingApprovals: 0, queuedMessages: 0, backgroundJobs: 0 };
  validateAdmission(safe);
  for (const [key, value] of [['idleMs', 59_999], ['idleMs', NaN], ['draftsSaved', false], ['drained', false], ['activeTasks', 1], ['pendingApprovals', 1], ['queuedMessages', 1], ['backgroundJobs', 1], ['backgroundJobs', undefined]]) assert.throws(() => validateAdmission({ ...safe, [key]: value }), Blocked);
});

test('simultaneous workers share one lock and interrupted locks never silently disappear', async t => {
  const root = await temporary(t);
  const release = await acquireLock(root);
  await assert.rejects(acquireLock(root), /Another update worker/);
  await release();
  await atomicJson(path.join(root, 'worker.lock'), { pid: 2147483647, token: 'interrupted' });
  await assert.rejects(acquireLock(root), /Interrupted update lock/);
});

test('recovery journal failures preserve lock retention for uncertain install and incomplete rollback', async t => {
  const root = await temporary(t);
  const blocker = path.join(root, 'file-instead-of-directory'); await fs.writeFile(blocker, 'retained');
  for (const message of ['Installation outcome uncertain', 'Matched rollback could not finish']) {
    const tx = { transaction: root, stage: 'installed-validation' };
    const failure = await requireManualRecovery(tx, path.join(blocker, 'transaction.json'), message, new Error('original failure'));
    assert.equal(failure.retainLock, true);
    assert.equal(failure.recoveryRequired, true);
    assert.equal(tx.stage, 'recovery-required');
    assert.equal(failure.transaction, root);
    assert.match(failure.message, /recovery journal could not be written/);
    assert.ok(failure.journalFailure);
  }
});

test('path containment refuses traversal, identical root and another drive', () => {
  const root = path.resolve('C:\\scratch\\allowed');
  assert.throws(() => assertWithin(root, root));
  assert.throws(() => assertWithin(root, path.join(root, '..', 'other')));
  assert.equal(assertWithin(root, path.join(root, 'child')), path.join(root, 'child'));
});

test('Windows source builds use short distinct cache paths and shortened virtual-store names', () => {
  const config = { root: 'C:\\Users\\fixture\\AppData\\Local\\DSH Source Updater', buildCacheDir: 'C:\\Users\\fixture\\Documents\\DSHB', installDir: 'C:\\Users\\fixture\\AppData\\Local\\Programs\\DeepSeek Harness', sharedDataDir: 'C:\\Users\\fixture\\.dsh', userDataDir: 'C:\\Users\\fixture\\AppData\\Roaming\\dsh' };
  const target = { commit: 'a'.repeat(40), tag: 'dsh-v0.2.1-rc.1' };
  const layout = sourceBuildLayout(config, target, 'b'.repeat(64), 'win32');
  assert.equal(path.dirname(layout.buildRoot), config.buildCacheDir);
  assert.match(path.basename(layout.buildRoot), /^[a-f0-9]{16}$/);
  assert.equal(layout.sourcePath, path.join(layout.buildRoot, 's'));
  assert.deepEqual(sourceInstallArguments('win32'), ['install', '--frozen-lockfile', '--config.virtual-store-dir-max-length=40']);
  assert.deepEqual(sourceInstallArguments('linux'), ['install', '--frozen-lockfile']);
  assert.notEqual(sourceBuildLayout(config, { ...target, commit: 'b'.repeat(40) }, 'b'.repeat(64)).buildRoot, layout.buildRoot);
  assert.notEqual(sourceBuildLayout(config, target, 'c'.repeat(64)).buildRoot, layout.buildRoot);
});

test('source cache refuses long, redirected-prone, relative and state-overlapping roots', () => {
  const config = { root: 'C:\\updater', sharedDataDir: 'C:\\Users\\fixture\\.dsh' };
  const target = { commit: 'a'.repeat(40), tag: 'dsh-v0.2.1' };
  for (const cache of ['relative-cache', 'C:\\', 'C:\\Users\\fixture\\.dsh\\builds', 'C:\\updater\\builds', 'C:\\x'.padEnd(100, 'x'), '\\\\server\\cache']) assert.throws(() => sourceBuildLayout({ ...config, buildCacheDir: cache }, target, 'b'.repeat(64), 'win32'), Blocked);
});

test('short source cache claims only an empty owned directory and retains unfamiliar data', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'db-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = { root: path.join(root, 'helper'), buildCacheDir: path.join(root, 'c'), tools: { powershell: { executable: path.join(process.env.SystemRoot ?? '', 'System32/WindowsPowerShell/v1.0/powershell.exe') } } };
  const layout = sourceBuildLayout(config, { commit: 'a'.repeat(40), tag: 'dsh-v0.2.1' }, 'b'.repeat(64));
  await ensureBuildCache(config, layout);
  const marker = JSON.parse(await fs.readFile(path.join(layout.cache, '.dsh-source-cache.json'), 'utf8'));
  await ensureBuildCache(config, layout);
  assert.equal(marker.schemaVersion, 1);
  await assert.rejects(ensureBuildCache({ ...config, root: path.join(root, 'different-helper') }, layout), /another updater/);
  const unknown = path.join(root, 'unknown'); await fs.mkdir(unknown); await fs.writeFile(path.join(unknown, 'retain.txt'), 'do not modify');
  await assert.rejects(ensureBuildCache({ ...config, buildCacheDir: unknown }, { ...layout, cache: unknown, buildRoot: path.join(unknown, '0123456789abcdef') }), /Unfamiliar nonempty/);
  assert.equal(await fs.readFile(path.join(unknown, 'retain.txt'), 'utf8'), 'do not modify');
});

test('verified snapshots restore matched program, history, attachment bytes and settings after failure', async t => {
  const root = await temporary(t);
  const roots = ['install', 'home', 'electron'];
  const manifests = [];
  for (const name of roots) {
    const source = path.join(root, name);
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'original.bin'), Buffer.from([0, 255, 1, 64]));
    await fs.writeFile(path.join(source, 'settings.json'), '{"provider":"preserved"}');
    manifests.push(await snapshotTree(source, path.join(root, `backup-${name}`)));
    await fs.writeFile(path.join(source, 'settings.json'), '{"migration":"new"}');
    await fs.writeFile(path.join(source, 'new-generation.jsonl'), 'unreadable by old');
  }
  for (const manifest of manifests) {
    await restoreTree(manifest);
    assert.equal(await fs.readFile(path.join(manifest.source, 'settings.json'), 'utf8'), '{"provider":"preserved"}');
    assert.deepEqual(await fs.readFile(path.join(manifest.source, 'original.bin')), Buffer.from([0, 255, 1, 64]));
    await assert.rejects(fs.stat(path.join(manifest.source, 'new-generation.jsonl')), { code: 'ENOENT' });
  }
});

test('snapshot corruption is detected before program or data restoration', async t => {
  const root = await temporary(t); const source = path.join(root, 'home');
  await fs.mkdir(source); await fs.writeFile(path.join(source, 'session.jsonl'), 'original history');
  const manifest = await snapshotTree(source, path.join(root, 'backup'));
  await fs.writeFile(path.join(root, 'backup', 'session.jsonl'), 'tampered');
  await assert.rejects(verifySnapshot(manifest), /hash mismatch/);
  await assert.rejects(restoreTree(manifest), /hash mismatch/);
  assert.equal(await fs.readFile(path.join(source, 'session.jsonl'), 'utf8'), 'original history');
});

test('external plugin junction bytes are snapshotted, isolated, then original topology restored', async t => {
  const root = await temporary(t); const source = path.join(root, 'home'); const external = path.join(root, 'plugin');
  await fs.mkdir(source); await fs.mkdir(external); await fs.writeFile(path.join(external, 'index.js'), 'original plugin');
  await fs.symlink(external, path.join(source, 'plugin'), process.platform === 'win32' ? 'junction' : 'dir');
  const manifest = await snapshotTree(source, path.join(root, 'backup'));
  assert.equal((await fs.lstat(path.join(root, 'backup', 'plugin'))).isSymbolicLink(), false);
  await fs.writeFile(path.join(source, 'state.json'), 'new migration');
  await restoreTree(manifest);
  assert.equal((await fs.lstat(path.join(source, 'plugin'))).isSymbolicLink(), true);
  assert.equal(await fs.readFile(path.join(external, 'index.js'), 'utf8'), 'original plugin');
});

test('concurrently changed external plugin target blocks rollback without overwriting it', async t => {
  const root = await temporary(t); const source = path.join(root, 'home'); const external = path.join(root, 'plugin');
  await fs.mkdir(source); await fs.mkdir(external); await fs.writeFile(path.join(external, 'index.js'), 'original');
  await fs.symlink(external, path.join(source, 'plugin'), process.platform === 'win32' ? 'junction' : 'dir');
  const manifest = await snapshotTree(source, path.join(root, 'backup'));
  await fs.writeFile(path.join(external, 'index.js'), 'concurrent edit');
  await assert.rejects(restoreTree(manifest), /External link target changed/);
  assert.equal(await fs.readFile(path.join(external, 'index.js'), 'utf8'), 'concurrent edit');
});

test('snapshot junction cycles fail explicitly', async t => {
  const root = await temporary(t); const source = path.join(root, 'home');
  await fs.mkdir(source); await fs.symlink(source, path.join(source, 'cycle'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(snapshotTree(source, path.join(root, 'backup')), /Cyclic snapshot/);
});

test('retired dependency cycles preserve pointers without entering external source trees', async t => {
  const root = await temporary(t); const source = path.join(root, 'home'); const external = path.join(root, 'external');
  const modules = path.join(source, 'profiles', 'node_modules');
  await fs.mkdir(modules, { recursive: true }); await fs.mkdir(external);
  await fs.writeFile(path.join(external, 'original.txt'), 'external source retained');
  await fs.symlink(external, path.join(external, 'cycle'), process.platform === 'win32' ? 'junction' : 'dir');
  await fs.symlink(external, path.join(modules, 'old-core'), process.platform === 'win32' ? 'junction' : 'dir');
  const manifest = await snapshotTree(source, path.join(root, 'backup'), { preserveDependencyLinks: true });
  assert.equal(manifest.entries.filter(entry => entry.preservedDependency).length, 1);
  const isolated = path.join(root, 'isolated');
  await fs.cp(manifest.destination, isolated, { recursive: true });
  assert.equal((await fs.lstat(path.join(isolated, 'profiles', 'node_modules', 'old-core'))).isSymbolicLink(), false);
  await restorePreservedDependencyLinks(manifest, isolated);
  assert.equal((await fs.lstat(path.join(isolated, 'profiles', 'node_modules', 'old-core'))).isSymbolicLink(), true);
  await restoreTree(manifest);
  assert.equal((await fs.lstat(path.join(modules, 'old-core'))).isSymbolicLink(), true);
  assert.equal(await fs.readFile(path.join(external, 'original.txt'), 'utf8'), 'external source retained');
});

test('active desktop dependency bytes remain materialized for isolated plugin qualification', async t => {
  const root = await temporary(t); const source = path.join(root, 'home'); const external = path.join(root, 'zod');
  const modules = path.join(source, 'profiles', 'desktop', 'node_modules');
  await fs.mkdir(modules, { recursive: true }); await fs.mkdir(external);
  await fs.writeFile(path.join(external, 'index.js'), 'exact installed runtime');
  await fs.symlink(external, path.join(modules, 'zod'), process.platform === 'win32' ? 'junction' : 'dir');
  const manifest = await snapshotTree(source, path.join(root, 'backup'), { preserveDependencyLinks: true });
  assert.equal(manifest.entries.some(entry => entry.preservedDependency), false);
  assert.equal(await fs.readFile(path.join(manifest.destination, 'profiles', 'desktop', 'node_modules', 'zod', 'index.js'), 'utf8'), 'exact installed runtime');
});

test('dangling archived junction is recorded, isolated and restored without inventing missing data', async t => {
  const root = await temporary(t); const source = path.join(root, 'home');
  await fs.mkdir(source);
  const absent = path.join(root, 'retired-profile');
  const link = path.join(source, 'old-playbooks');
  await fs.symlink(absent, link, process.platform === 'win32' ? 'junction' : 'dir');
  const powershell = process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : undefined;
  const manifest = await snapshotTree(source, path.join(root, 'backup'), { linkInspectorExecutable: powershell });
  assert.equal(manifest.entries.find(entry => entry.relative === 'old-playbooks').dangling, true);
  assert.equal((await fs.lstat(path.join(root, 'backup', 'old-playbooks'))).isSymbolicLink(), false);
  await restoreTree(manifest);
  assert.equal((await fs.lstat(link)).isSymbolicLink(), true);
  await assert.rejects(fs.stat(link), { code: 'ENOENT' });
  await fs.mkdir(absent);
  await assert.rejects(restoreTree(manifest), /target appeared during rollback/);
});
