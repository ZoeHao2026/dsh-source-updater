/** Deploy reversible local helper files. This never touches the client installation or shared data. */
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireLock, atomicJson, assertUnlinkedAncestors, assertWithin, compareVersions, hashFile, selectedPluginNames, sourceBuildLayout } from './upgrade-worker.mjs';

const ownDirectory = path.dirname(fileURLToPath(import.meta.url));

/** Delivery manifests resolve relative paths only inside their extracted pluginAssets directory. */
export async function resolveBaselinePlugins(pluginAssets, baseline) {
  if (baseline.plugins?.length !== 3) throw new Error('Three pinned baseline plugins are required');
  const assets = path.resolve(pluginAssets);
  const physicalAssets = await fs.realpath(assets);
  const plugins = [];
  for (const plugin of baseline.plugins) {
    if (!/^@local\/[a-z0-9-]+$/.test(plugin.name) || typeof plugin.path !== 'string' || !plugin.path) throw new Error('Invalid pinned baseline plugin');
    const relative = !path.isAbsolute(plugin.path);
    if (relative && (plugin.path.includes(':') || plugin.path.startsWith('\\'))) throw new Error(`Invalid relative baseline path: ${plugin.path}`);
    const directory = relative ? assertWithin(assets, path.resolve(assets, plugin.path)) : path.resolve(plugin.path);
    if (relative) {
      await assertUnlinkedAncestors(directory);
      assertWithin(physicalAssets, await fs.realpath(directory));
    }
    if (!plugin.files || Object.keys(plugin.files).length === 0) throw new Error(`Pinned plugin files are required: ${plugin.name}`);
    for (const [file, sha256] of Object.entries(plugin.files)) {
      if (path.isAbsolute(file) || file.includes(':')) throw new Error(`Invalid pinned file: ${file}`);
      const filename = assertWithin(directory, path.resolve(directory, file));
      if (relative) await assertUnlinkedAncestors(filename);
      if (await hashFile(filename) !== sha256) throw new Error(`Baseline plugin changed: ${plugin.name}/${file}`);
    }
    plugins.push({ ...plugin, path: directory });
  }
  return plugins;
}

/** Copy only the exact pinned inventory, excluding accidental local files from the kit. */
export async function copyPinnedPlugin(plugin, destination) {
  await fs.mkdir(destination, { recursive: true });
  for (const [relative, sha256] of Object.entries(plugin.files)) {
    const source = assertWithin(plugin.path, path.resolve(plugin.path, relative));
    const target = assertWithin(destination, path.resolve(destination, relative));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
    if (await hashFile(target) !== sha256) throw new Error(`Copied baseline changed: ${plugin.name}/${relative}`);
  }
}

const samePath = (left, right) => path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
const readJson = async filename => JSON.parse(await fs.readFile(filename, 'utf8'));
const present = async filename => fs.lstat(filename).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error));

function explicitSelection(value, known) {
  if (!Array.isArray(value) || value.length === 0 || value.some(name => typeof name !== 'string') || new Set(value).size !== value.length || value.some(name => !known.includes(name))) throw new Error('selectedPlugins must be an explicit nonempty list of distinct known plugin names');
  return value;
}

function helperFile(root, filename) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename)) throw new Error('Existing helper files must use absolute helper-local paths');
  return assertWithin(root, filename);
}

/** Configuration and pins are mutable transaction inputs, outside the delivered-file ownership inventory. */
async function inspectExisting(destination, configPath, options, baselinePlugins) {
  if (!await present(destination)) return undefined;
  if (!samePath(await fs.realpath(destination), destination)) throw new Error('Deployment target must be a physical helper directory');
  const entries = await fs.readdir(destination);
  if (entries.length === 0) return undefined;
  const deploymentPath = path.join(destination, 'deployment.json');
  if (!await present(configPath) || !await present(deploymentPath)) throw new Error('Unrecognized nonempty helper directory retained; deploy to a new empty directory and explicitly configure the client to use it. See DEPLOYMENT.md');
  await assertUnlinkedAncestors(configPath); await assertUnlinkedAncestors(deploymentPath);
  const config = await readJson(configPath); const deployment = await readJson(deploymentPath);
  if (config.schemaVersion !== 1 || !samePath(config.root ?? '', destination) || deployment.schemaVersion !== 1 || !samePath(deployment.destination ?? '', destination) || !samePath(deployment.configPath ?? '', configPath)) throw new Error('Existing configuration and deployment do not identify this helper directory');
  for (const key of ['installDir', 'userDataDir', 'sharedDataDir']) if (typeof config[key] !== 'string' || !samePath(config[key], options[key])) throw new Error(`Existing helper ${key} differs from the requested installation`);
  compareVersions(config.currentVersion, config.currentVersion);
  if (options.currentVersion !== undefined && options.currentVersion !== config.currentVersion) throw new Error('Redeployment cannot reset the transactionally maintained currentVersion');
  const names = selectedPluginNames(config.plugins);
  explicitSelection(names, baselinePlugins.map(plugin => plugin.name));
  for (const plugin of config.plugins) {
    const baseline = baselinePlugins.find(item => item.name === plugin.name);
    if (plugin.version !== baseline.version || JSON.stringify(Object.entries(plugin.files ?? {}).sort()) !== JSON.stringify(Object.entries(baseline.files).sort())) throw new Error(`Existing frozen baseline differs from the reviewed delivery: ${plugin.name}`);
    helperFile(destination, plugin.path); await assertUnlinkedAncestors(plugin.path);
  }
  if (!deployment.ownedFiles || typeof deployment.ownedFiles !== 'object' || Array.isArray(deployment.ownedFiles) || Object.keys(deployment.ownedFiles).length === 0) throw new Error('Legacy helper has no delivered-file ownership inventory; retained without changes. Deploy to a new empty directory and explicitly configure the client to use it. See DEPLOYMENT.md');
  for (const [relative, sha256] of Object.entries(deployment.ownedFiles)) {
    if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256) || path.isAbsolute(relative) || relative.includes(':')) throw new Error('Invalid delivered-file ownership inventory');
    const filename = assertWithin(destination, path.resolve(destination, relative));
    if (['updater-config.json', 'deployment.json', 'status.json', 'worker.lock'].includes(relative) || (config.activePluginPins && samePath(filename, config.activePluginPins))) throw new Error('Mutable helper state cannot be a delivered-file ownership entry');
    await assertUnlinkedAncestors(filename);
  }
  let pins;
  if (config.activePluginPins !== undefined) {
    helperFile(destination, config.activePluginPins); await assertUnlinkedAncestors(config.activePluginPins);
    if (samePath(config.activePluginPins, configPath) || samePath(config.activePluginPins, deploymentPath)) throw new Error('Trusted pins must be separate from helper configuration and deployment metadata');
    pins = await readJson(config.activePluginPins);
    if (pins.schemaVersion !== 1 || !Array.isArray(pins.plugins) || pins.plugins.length !== names.length || new Set(pins.plugins.map(plugin => plugin.name)).size !== names.length) throw new Error('Existing trusted pin inventory differs from the explicit plugin selection');
    for (const pin of pins.plugins) {
      const baseline = baselinePlugins.find(plugin => plugin.name === pin.name);
      if (!names.includes(pin.name) || typeof pin.version !== 'string' || pin.version.split('+')[0] !== baseline.version || !pin.files?.['package.json']) throw new Error(`Invalid trusted plugin qualification: ${pin.name}`);
      for (const [relative, sha256] of Object.entries(pin.files)) {
        if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256) || path.isAbsolute(relative) || relative.includes(':')) throw new Error('Invalid trusted plugin file pin');
        assertWithin(destination, path.resolve(destination, relative));
      }
    }
  }
  return { config, deployment, pins, configBytes: await fs.readFile(configPath), deploymentBytes: await fs.readFile(deploymentPath), pinsBytes: config.activePluginPins ? await fs.readFile(config.activePluginPins) : undefined };
}

async function addDirectoryCopies(copies, source, target, ancestors = []) {
  const real = await fs.realpath(source);
  if (ancestors.includes(real)) throw new Error(`Cyclic tool directory: ${source}`);
  const stat = await fs.stat(source);
  if (stat.isFile()) { copies.push({ source, target }); return; }
  if (!stat.isDirectory()) throw new Error(`Tool input is not a regular file or directory: ${source}`);
  for (const name of await fs.readdir(source)) await addDirectoryCopies(copies, path.join(source, name), path.join(target, name), [...ancestors, real]);
}

async function assertOwnedTargets(destination, copies, existing, verifyBytes) {
  for (const { target } of copies) {
    await assertUnlinkedAncestors(target);
    if (!await present(target)) continue;
    const relative = path.relative(destination, target).replaceAll('\\', '/');
    const expected = existing?.deployment.ownedFiles[relative];
    if (!expected) throw new Error(`Refusing to overwrite a file without delivery ownership: ${relative}`);
    if (verifyBytes && await hashFile(target) !== expected) throw new Error(`Managed delivery file changed outside deployment; retained: ${relative}`);
  }
}

export async function deployMain(args = process.argv.slice(2)) {
const value = flag => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
const optionsPath = value('--options');
if (!optionsPath) throw new Error('Usage: node deploy-updater.mjs --options ABSOLUTE_JSON [--dry-run]');
const options = JSON.parse(await fs.readFile(optionsPath, 'utf8'));
for (const key of ['destination', 'sourceRepository', 'pluginAssets', 'nodeExecutable', 'pnpmDirectory', 'npmDirectory', 'gitExecutable', 'powershellExecutable', 'installDir', 'userDataDir', 'sharedDataDir']) if (!options[key] || !path.isAbsolute(options[key])) throw new Error(`Absolute ${key} is required`);
const destination = path.resolve(options.destination);
await assertUnlinkedAncestors(destination);
if (await fs.lstat(path.join(destination, 'worker.lock')).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error))) throw new Error('Existing update lock prevents helper deployment');
const nodeVersion = (await import('node:child_process')).execFileSync(options.nodeExecutable, ['--version'], { encoding: 'utf8', windowsHide: true }).trim();
if (!/^v(?:2[4-9]|[3-9]\d)\./.test(nodeVersion)) throw new Error(`Node 24+ required for this helper: ${nodeVersion}`);
const pnpmManifest = JSON.parse(await fs.readFile(path.join(options.pnpmDirectory, 'package.json'), 'utf8'));
if (pnpmManifest.name !== 'pnpm' || pnpmManifest.version !== '11.28.5') throw new Error('Initial deployment requires complete pnpm 11.28.5 package directory');
const baseline = JSON.parse(await fs.readFile(path.join(options.pluginAssets, 'baseline-pins.json'), 'utf8'));
const baselinePlugins = await resolveBaselinePlugins(options.pluginAssets, baseline);
const configPath = path.join(destination, 'updater-config.json');
const existing = await inspectExisting(destination, configPath, options, baselinePlugins);
const buildLayout = sourceBuildLayout({ ...options, buildCacheDir: options.buildCacheDir ?? existing?.config.buildCacheDir, root: destination }, { commit: '0'.repeat(40), tag: 'dsh-v0.0.0' }, '0'.repeat(64));
const hasExplicitSelection = Object.hasOwn(options, 'selectedPlugins');
const names = explicitSelection(hasExplicitSelection ? options.selectedPlugins : existing?.config.plugins.map(plugin => plugin.name) ?? baselinePlugins.map(plugin => plugin.name), baselinePlugins.map(plugin => plugin.name));
const selectedBaselines = names.map(name => baselinePlugins.find(plugin => plugin.name === name));
const activePluginPins = existing?.config.activePluginPins ?? path.join(destination, 'trusted-active-plugins.json');
helperFile(destination, activePluginPins); await assertUnlinkedAncestors(activePluginPins);
if (!existing?.config.activePluginPins && await present(activePluginPins)) throw new Error('Refusing to adopt an existing trust file without explicit helper ownership');
const selectionUnchanged = existing && JSON.stringify([...names].sort()) === JSON.stringify(existing.config.plugins.map(plugin => plugin.name).sort());
const nextPins = { schemaVersion: 1, qualifiedAt: new Date().toISOString(), source: 'verified-frozen-deployment', plugins: selectedBaselines.map(plugin => existing?.pins?.plugins.find(pin => pin.name === plugin.name) ?? { name: plugin.name, version: plugin.version, files: { ...plugin.files } }) };
const plan = { schemaVersion: 1, destination, buildCacheDir: buildLayout.cache, nodeVersion, pnpmVersion: pnpmManifest.version, pluginVersions: selectedBaselines.map(({ name, version }) => ({ name, version })), currentVersion: existing?.config.currentVersion ?? options.currentVersion ?? '0.2.0-rc.2', activePluginPins, selectionSource: hasExplicitSelection ? 'explicit' : existing ? 'preserved' : 'default', trustedPinsPreserved: !!(selectionUnchanged && existing.pins), clientTouched: false, dataTouched: false, managedBytesVerifiedBeforeWrite: true };
compareVersions(plan.currentVersion, plan.currentVersion);
const copies = [];
for (const filename of ['upgrade-worker.mjs', 'inspect-processes.ps1', 'inspect-link.ps1', 'inspect-build-cache.ps1', 'installation-metadata.ps1', 'baseline-history.cjs', 'baseline-compatibility.mjs', 'data-probe.mjs', 'README.md', 'DEPLOYMENT.md']) copies.push({ source: path.join(ownDirectory, filename), target: path.join(destination, filename) });
const tools = path.join(destination, 'tools');
const nodeDestination = path.join(tools, 'node.exe');
copies.push({ source: options.nodeExecutable, target: nodeDestination });
await addDirectoryCopies(copies, options.pnpmDirectory, path.join(tools, 'pnpm'));
await addDirectoryCopies(copies, options.npmDirectory, path.join(tools, 'npm'));
const pluginDestination = path.join(destination, 'plugin-compat');
for (const filename of ['probe.mjs', 'baseline-inventory.json']) copies.push({ source: path.join(options.pluginAssets, filename), target: path.join(pluginDestination, filename) });
const plugins = [];
for (const plugin of selectedBaselines) {
  const copied = path.join(pluginDestination, 'baseline', plugin.name.split('/').at(-1));
  for (const target of [path.join(pluginDestination, 'packages', plugin.name.split('/').at(-1)), copied]) for (const relative of Object.keys(plugin.files)) copies.push({ source: assertWithin(plugin.path, path.resolve(plugin.path, relative)), target: assertWithin(target, path.resolve(target, relative)) });
  plugins.push({ ...plugin, path: copied });
}
const compatibilityPatch = path.join(destination, 'source-compatibility.patch');
if (options.compatibilityPatch) {
  if (!path.isAbsolute(options.compatibilityPatch)) throw new Error('compatibilityPatch must be an absolute reviewed source patch');
  copies.push({ source: options.compatibilityPatch, target: compatibilityPatch });
}
for (const { source, target } of copies) {
  assertWithin(destination, target);
  if (!await present(source) || !(await fs.stat(source)).isFile()) throw new Error(`Deployment input is not a regular file: ${source}`);
  if (samePath(source, target)) throw new Error('Deployment inputs must remain separate from the target helper');
}
await assertOwnedTargets(destination, copies, existing, false);
if (args.includes('--dry-run')) { process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`); return plan; }

const release = await acquireLock(destination);
try {
await assertOwnedTargets(destination, copies, existing, true);
if (existing) {
  if (!existing.configBytes.equals(await fs.readFile(configPath)) || !existing.deploymentBytes.equals(await fs.readFile(path.join(destination, 'deployment.json'))) || (existing.pinsBytes && !existing.pinsBytes.equals(await fs.readFile(activePluginPins)))) throw new Error('Existing helper qualification changed after deployment planning; retained');
  const history = path.join(destination, 'deployment-history', `${Date.now()}-${process.pid}`); await assertUnlinkedAncestors(history); await fs.mkdir(history, { recursive: true });
  await fs.writeFile(path.join(history, 'updater-config.json'), existing.configBytes, { flag: 'wx' });
  await fs.writeFile(path.join(history, 'deployment.json'), existing.deploymentBytes, { flag: 'wx' });
  if (existing.pinsBytes) await fs.writeFile(path.join(history, 'trusted-active-plugins.json'), existing.pinsBytes, { flag: 'wx' });
}
const ownedFiles = { ...existing?.deployment.ownedFiles };
for (const { source, target } of copies) {
  await assertUnlinkedAncestors(target); await fs.mkdir(path.dirname(target), { recursive: true });
  const sourceSha256 = await hashFile(source);
  await fs.copyFile(source, target);
  if (await hashFile(target) !== sourceSha256) throw new Error(`Copied delivery file differs from its source: ${target}`);
  ownedFiles[path.relative(destination, target).replaceAll('\\', '/')] = sourceSha256;
}
const config = {
  ...existing?.config,
  schemaVersion: 1, root: destination, buildCacheDir: buildLayout.cache, currentVersion: plan.currentVersion,
  installDir: options.installDir, userDataDir: options.userDataDir, sharedDataDir: options.sharedDataDir,
  tools: {
    node: { executable: nodeDestination }, git: { executable: options.gitExecutable },
    pnpm: { executable: nodeDestination, args: [path.join(tools, 'pnpm', 'bin', 'pnpm.cjs')] },
    powershell: { executable: options.powershellExecutable },
  },
  compatibilityPatch,
  compatibilityProbe: path.join(pluginDestination, 'probe.mjs'),
  npmCli: path.join(tools, 'npm', 'bin', 'npm-cli.js'),
  dataProbe: path.join(destination, 'data-probe.mjs'), plugins, activePluginPins,
  healthTimeoutMs: existing?.config.healthTimeoutMs ?? 120_000,
};
if (!selectionUnchanged || !existing.pins) await atomicJson(activePluginPins, nextPins);
await atomicJson(configPath, config);
await atomicJson(path.join(destination, 'deployment.json'), { ...plan, deployedAt: new Date().toISOString(), nodeSha256: ownedFiles['tools/node.exe'], configPath, ownedFiles });
process.stdout.write(`${JSON.stringify({ ...plan, configPath, workerPath: path.join(destination, 'upgrade-worker.mjs') }, null, 2)}\n`);
return { ...plan, configPath, workerPath: path.join(destination, 'upgrade-worker.mjs') };
} finally { await release(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) deployMain().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
