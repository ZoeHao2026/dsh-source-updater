import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { atomicJson, assertActivePlugins, hashFile } from './upgrade-worker.mjs';
import { copyPinnedPlugin, resolveBaselinePlugins } from './deploy-updater.mjs';

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, '..');
const publicPluginAssets = path.join(repository, 'plugins');
const execute = promisify(execFile);
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-kit-test-')));
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
  for (const filename of ['probe.mjs', 'baseline-inventory.json']) await fs.copyFile(path.join(publicPluginAssets, filename), path.join(assets, filename));
  await fs.writeFile(path.join(assets, 'baseline-pins.json'), JSON.stringify(pins));
  return { root, assets, pins };
}

async function deploymentFixture(t) {
  const f = await fixture(t);
  const destination = path.join(f.root, 'helper');
  const pnpmDirectory = path.join(f.root, 'fake-pnpm'); const npmDirectory = path.join(f.root, 'fake-npm');
  await fs.mkdir(pnpmDirectory); await fs.mkdir(npmDirectory);
  await atomicJson(path.join(pnpmDirectory, 'package.json'), { name: 'pnpm', version: '11.28.5' });
  await fs.writeFile(path.join(pnpmDirectory, 'pnpm.cjs'), 'fixture-only, never executed');
  await fs.writeFile(path.join(npmDirectory, 'npm-cli.js'), 'fixture-only, never executed');
  const options = { destination, sourceRepository: path.join(f.root, 'unused-source'), pluginAssets: f.assets, nodeExecutable: process.execPath, pnpmDirectory, npmDirectory, gitExecutable: path.join(f.root, 'never-run-git.exe'), powershellExecutable: path.join(f.root, 'never-run-powershell.exe'), installDir: path.join(f.root, 'install'), userDataDir: path.join(f.root, 'electron'), sharedDataDir: path.join(f.root, 'shared'), buildCacheDir: path.join(f.root, 'c') };
  const optionsPath = path.join(f.root, 'options.json');
  const deploy = async (dryRun = false) => {
    await atomicJson(optionsPath, options);
    const { stdout } = await execute(process.execPath, [path.join(own, 'deploy-updater.mjs'), '--options', optionsPath, ...(dryRun ? ['--dry-run'] : [])], { windowsHide: true });
    return JSON.parse(stdout);
  };
  return { ...f, destination, options, deploy, configPath: path.join(destination, 'updater-config.json') };
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
  const { destination, deploy } = await deploymentFixture(t);
  const plan = await deploy(true);
  assert.equal(plan.pluginVersions.length, 3); assert.equal(plan.clientTouched, false); assert.equal(plan.dataTouched, false);
  await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
});

test('first deployment explicitly trusts frozen files without discovering or changing live data', async t => {
  const f = await deploymentFixture(t);
  await f.deploy();
  const config = JSON.parse(await fs.readFile(f.configPath, 'utf8'));
  const pins = JSON.parse(await fs.readFile(config.activePluginPins, 'utf8'));
  assert.equal(pins.source, 'verified-frozen-deployment');
  assert.deepEqual(pins.plugins, f.pins.plugins.map(({ name, version, files }) => ({ name, version, files })));
  assert.equal(path.dirname(config.activePluginPins), f.destination);
  for (const key of ['installDir', 'userDataDir', 'sharedDataDir', 'buildCacheDir']) await assert.rejects(fs.stat(f.options[key]), { code: 'ENOENT' });
  const deployment = JSON.parse(await fs.readFile(path.join(f.destination, 'deployment.json'), 'utf8'));
  assert.ok(deployment.ownedFiles['upgrade-worker.mjs']);
  assert.ok(deployment.ownedFiles['tools/node.exe']);
  assert.equal(deployment.ownedFiles['updater-config.json'], undefined);
  assert.equal(deployment.ownedFiles['trusted-active-plugins.json'], undefined);
});

test('second deployment preserves selected plugins and the exact trust record advanced by an update', async t => {
  const f = await deploymentFixture(t); const name = '@local/dsh-ui-model-selection-collapsible';
  f.options.selectedPlugins = [name]; await f.deploy();
  const config = JSON.parse(await fs.readFile(f.configPath, 'utf8'));
  assert.deepEqual(config.plugins.map(plugin => plugin.name), [name]);
  const baseline = config.plugins[0];
  const current = '0.2.1-rc.2';
  const home = path.join(f.root, 'qualification-fixture');
  const active = path.join(home, 'profiles/desktop/node_modules', name);
  await fs.cp(baseline.path, active, { recursive: true });
  const manifest = JSON.parse(await fs.readFile(path.join(active, 'package.json'), 'utf8'));
  await atomicJson(path.join(active, 'package.json'), { ...manifest, version: `${baseline.version}+dsh.${current}` });
  await atomicJson(path.join(home, 'profiles/desktop/package.json'), { dependencies: { [name]: 'reviewed-fixture' }, dsh: { profile: { bundles: [name] } } });
  const advanced = { schemaVersion: 1, source: 'verified-source-update', plugins: [{ name, version: `${baseline.version}+dsh.${current}`, files: { ...baseline.files, 'package.json': await hashFile(path.join(active, 'package.json')) } }] };
  await atomicJson(config.activePluginPins, advanced);
  await atomicJson(f.configPath, { ...config, currentVersion: current });
  const bytes = await fs.readFile(config.activePluginPins);
  delete f.options.selectedPlugins;
  delete f.options.buildCacheDir;
  const dry = await f.deploy(true); assert.equal(dry.selectionSource, 'preserved'); assert.equal(dry.trustedPinsPreserved, true);
  await f.deploy();
  const next = JSON.parse(await fs.readFile(f.configPath, 'utf8'));
  assert.equal(next.currentVersion, current);
  assert.equal(next.buildCacheDir, config.buildCacheDir);
  assert.deepEqual(next.plugins.map(plugin => plugin.name), [name]);
  assert.deepEqual(await fs.readFile(next.activePluginPins), bytes);
  await assertActivePlugins(next, home);
  const history = await fs.readdir(path.join(f.destination, 'deployment-history')); assert.equal(history.length, 1);
  await assert.rejects(fs.stat(path.join(f.destination, 'plugin-compat/packages/dsh-adaptive-mode')), { code: 'ENOENT' });
});

test('explicit plugin selection rejects empty, duplicate and unknown lists before creating a helper', async t => {
  const f = await deploymentFixture(t);
  for (const names of [null, 'all', [], ['@local/dsh-ui-model-selection-collapsible', '@local/dsh-ui-model-selection-collapsible'], ['@local/not-reviewed']]) {
    f.options.selectedPlugins = names;
    await assert.rejects(f.deploy(true), /selectedPlugins must be/);
    await assert.rejects(fs.stat(f.destination), { code: 'ENOENT' });
  }
});

test('an explicitly reduced second deployment excludes removed plugins and retains the reviewed survivor pins', async t => {
  const f = await deploymentFixture(t); await f.deploy();
  const original = JSON.parse(await fs.readFile(f.configPath, 'utf8'));
  const originalPins = JSON.parse(await fs.readFile(original.activePluginPins, 'utf8'));
  const name = '@local/dsh-ui-model-selection-collapsible';
  f.options.selectedPlugins = [name]; await f.deploy();
  const next = JSON.parse(await fs.readFile(f.configPath, 'utf8'));
  const pins = JSON.parse(await fs.readFile(next.activePluginPins, 'utf8'));
  assert.deepEqual(next.plugins.map(plugin => plugin.name), [name]);
  assert.deepEqual(pins.plugins, originalPins.plugins.filter(plugin => plugin.name === name));
  await assert.rejects(fs.stat(f.options.sharedDataDir), { code: 'ENOENT' });
});

test('unowned same-name files and external trust paths block redeployment without modifying qualification', async t => {
  const f = await deploymentFixture(t); f.options.selectedPlugins = ['@local/dsh-ui-model-selection-collapsible']; await f.deploy();
  const metadataPath = path.join(f.destination, 'deployment.json'); const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  delete metadata.ownedFiles['README.md']; await atomicJson(metadataPath, metadata);
  const configBytes = await fs.readFile(f.configPath);
  await assert.rejects(f.deploy(true), /Refusing to overwrite a file without delivery ownership: README.md/);
  assert.deepEqual(await fs.readFile(f.configPath), configBytes);
  metadata.ownedFiles['README.md'] = await hashFile(path.join(f.destination, 'README.md')); await atomicJson(metadataPath, metadata);
  const config = JSON.parse(configBytes.toString('utf8'));
  await atomicJson(f.configPath, { ...config, activePluginPins: path.join(f.root, 'external-pins.json') });
  const before = await fs.readFile(f.configPath);
  await assert.rejects(f.deploy(true), /Unsafe child path/);
  assert.deepEqual(await fs.readFile(f.configPath), before);
});

test('unknown or legacy helper contents are retained instead of adopted', async t => {
  const f = await deploymentFixture(t);
  await fs.mkdir(f.destination); const foreign = path.join(f.destination, 'upgrade-worker.mjs'); await fs.writeFile(foreign, 'unowned application');
  await assert.rejects(f.deploy(true), /Unrecognized nonempty helper directory/);
  assert.equal(await fs.readFile(foreign, 'utf8'), 'unowned application');
  await fs.unlink(foreign); await f.deploy();
  const metadataPath = path.join(f.destination, 'deployment.json'); const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  delete metadata.ownedFiles; await atomicJson(metadataPath, metadata);
  const before = await fs.readFile(f.configPath);
  await assert.rejects(f.deploy(), /Legacy helper has no delivered-file ownership inventory/);
  assert.deepEqual(await fs.readFile(f.configPath), before);
});

test('changed managed files block real redeployment while dry-run avoids hashing the tool tree', async t => {
  const f = await deploymentFixture(t); f.options.selectedPlugins = ['@local/dsh-ui-model-selection-collapsible']; await f.deploy();
  const node = path.join(f.destination, 'tools/node.exe'); await fs.writeFile(node, 'changed managed bytes');
  const config = await fs.readFile(f.configPath);
  await f.deploy(true);
  await assert.rejects(f.deploy(), /Managed delivery file changed outside deployment; retained: tools\/node.exe/);
  assert.equal(await fs.readFile(node, 'utf8'), 'changed managed bytes');
  assert.deepEqual(await fs.readFile(f.configPath), config);
  await assert.rejects(fs.stat(path.join(f.destination, 'worker.lock')), { code: 'ENOENT' });
});

test('a helper configuration from another root is never overwritten', async t => {
  const f = await deploymentFixture(t); await f.deploy();
  const config = JSON.parse(await fs.readFile(f.configPath, 'utf8'));
  await atomicJson(f.configPath, { ...config, root: path.join(f.root, 'another-helper') });
  const before = await fs.readFile(f.configPath);
  await assert.rejects(f.deploy(true), /do not identify this helper directory/);
  assert.deepEqual(await fs.readFile(f.configPath), before);
});
