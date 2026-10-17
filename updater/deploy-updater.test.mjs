import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyPinnedPlugin, resolveBaselinePlugins } from './deploy-updater.mjs';

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, '..');
const publicPluginAssets = path.join(repository, 'plugins');
const execute = promisify(execFile);
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-kit-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const assets = path.join(root, 'kit', 'plugins'); await fs.mkdir(assets, { recursive: true });
  const pins = JSON.parse(await fs.readFile(path.join(publicPluginAssets, 'baseline-pins.json'), 'utf8'));
  // Copy the published pinned inventory only; supplementary LICENSE files are not added to the original 77 pins.
  for (const plugin of pins.plugins) {
    const source = path.resolve(publicPluginAssets, plugin.path);
    const destination = path.join(assets, plugin.path);
    for (const relative of Object.keys(plugin.files)) {
      const target = path.join(destination, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(path.join(source, relative), target);
    }
  }
  await fs.writeFile(path.join(assets, 'baseline-pins.json'), JSON.stringify(pins));
  return { root, assets, pins };
}

test('delivery manifest resolves all 77 original plugin files from extracted relative paths', async t => {
  const { assets, pins } = await fixture(t);
  const plugins = await resolveBaselinePlugins(assets, pins);
  assert.equal(plugins.length, 3);
  assert.equal(plugins.reduce((sum, plugin) => sum + Object.keys(plugin.files).length, 0), 77);
  for (const plugin of plugins) assert.equal(path.isAbsolute(plugin.path), true);
});

test('relative plugin paths reject traversal, drive-relative paths and external junctions', async t => {
  const { root, assets, pins } = await fixture(t);
  for (const directory of ['../outside', '.', 'C:ambiguous']) {
    await assert.rejects(resolveBaselinePlugins(assets, { plugins: [{ ...pins.plugins[0], path: directory }, ...pins.plugins.slice(1)] }));
  }
  const external = path.join(root, 'outside'); await fs.mkdir(external);
  await fs.symlink(external, path.join(assets, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(resolveBaselinePlugins(assets, { plugins: [{ ...pins.plugins[0], path: 'linked' }, ...pins.plugins.slice(1)] }), /Linked transaction path/);
  await assert.rejects(resolveBaselinePlugins(assets, { plugins: [{ ...pins.plugins[0], files: { '../outside.txt': '0'.repeat(64) } }, ...pins.plugins.slice(1)] }), /Unsafe child path/);
});

test('existing absolute plugin paths remain accepted without requiring relocation', async t => {
  const { assets, pins } = await fixture(t);
  const legacy = { plugins: pins.plugins.map(plugin => ({ ...plugin, path: path.resolve(publicPluginAssets, plugin.path) })) };
  const plugins = await resolveBaselinePlugins(assets, legacy);
  assert.deepEqual(plugins.map(plugin => plugin.path), legacy.plugins.map(plugin => plugin.path));
});

test('deployed baseline copies contain only the exact pinned files', async t => {
  const { root, assets, pins } = await fixture(t);
  const [plugin] = await resolveBaselinePlugins(assets, pins);
  await fs.writeFile(path.join(plugin.path, 'untracked.txt'), 'do not bundle');
  const destination = path.join(root, 'copied');
  await copyPinnedPlugin(plugin, destination);
  await assert.rejects(fs.stat(path.join(destination, 'untracked.txt')), { code: 'ENOENT' });
  const count = async directory => {
    let files = 0;
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) files += entry.isDirectory() ? await count(path.join(directory, entry.name)) : 1;
    return files;
  };
  assert.equal(await count(destination), Object.keys(plugin.files).length);
});

test('extracted-kit deployment dry-run accepts relative pins and creates no helper directory', async t => {
  const { root, assets } = await fixture(t);
  const destination = path.join(root, 'helper');
  const sourceRepository = path.join(root, 'source-repository');
  const pnpmDirectory = path.join(root, 'pnpm');
  const npmDirectory = path.join(root, 'npm');
  const fixtureTools = path.join(root, 'fixture-tools');
  for (const directory of [sourceRepository, pnpmDirectory, npmDirectory, fixtureTools]) await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(pnpmDirectory, 'package.json'), JSON.stringify({ name: 'pnpm', version: '11.28.5' }));
  // Dry-run reads only the pnpm manifest and actual Node version. These absolute executable placeholders are never invoked.
  const options = { destination, sourceRepository, pluginAssets: assets, nodeExecutable: process.execPath, pnpmDirectory, npmDirectory, gitExecutable: path.join(fixtureTools, 'git.exe'), powershellExecutable: path.join(fixtureTools, 'powershell.exe'), installDir: path.join(root, 'install'), userDataDir: path.join(root, 'electron'), sharedDataDir: path.join(root, 'shared') };
  const optionsPath = path.join(root, 'options.json'); await fs.writeFile(optionsPath, JSON.stringify(options));
  const result = await execute(process.execPath, [path.join(own, 'deploy-updater.mjs'), '--options', optionsPath, '--dry-run'], { windowsHide: true });
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.pluginVersions.length, 3); assert.equal(plan.clientTouched, false); assert.equal(plan.dataTouched, false);
  await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
});
