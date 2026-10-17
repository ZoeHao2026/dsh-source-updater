/** Deploy reversible local helper files. This never touches the client installation or shared data. */
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicJson, assertUnlinkedAncestors, assertWithin, hashFile, sourceBuildLayout } from './upgrade-worker.mjs';

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

export async function deployMain(args = process.argv.slice(2)) {
const value = flag => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
const optionsPath = value('--options');
if (!optionsPath) throw new Error('Usage: node deploy-updater.mjs --options ABSOLUTE_JSON [--dry-run]');
const options = JSON.parse(await fs.readFile(optionsPath, 'utf8'));
for (const key of ['destination', 'sourceRepository', 'pluginAssets', 'nodeExecutable', 'pnpmDirectory', 'npmDirectory', 'gitExecutable', 'powershellExecutable', 'installDir', 'userDataDir', 'sharedDataDir']) if (!options[key] || !path.isAbsolute(options[key])) throw new Error(`Absolute ${key} is required`);
const destination = path.resolve(options.destination);
await assertUnlinkedAncestors(destination);
const buildLayout = sourceBuildLayout({ ...options, root: destination }, { commit: '0'.repeat(40), tag: 'dsh-v0.0.0' }, '0'.repeat(64));
if (await fs.lstat(path.join(destination, 'worker.lock')).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error))) throw new Error('Existing update lock prevents helper deployment');
const nodeVersion = (await import('node:child_process')).execFileSync(options.nodeExecutable, ['--version'], { encoding: 'utf8', windowsHide: true }).trim();
if (!/^v(?:2[4-9]|[3-9]\d)\./.test(nodeVersion)) throw new Error(`Node 24+ required for this helper: ${nodeVersion}`);
const pnpmManifest = JSON.parse(await fs.readFile(path.join(options.pnpmDirectory, 'package.json'), 'utf8'));
if (pnpmManifest.name !== 'pnpm' || pnpmManifest.version !== '11.28.5') throw new Error('Initial deployment requires complete pnpm 11.28.5 package directory');
const baseline = JSON.parse(await fs.readFile(path.join(options.pluginAssets, 'baseline-pins.json'), 'utf8'));
const baselinePlugins = await resolveBaselinePlugins(options.pluginAssets, baseline);
const plan = { schemaVersion: 1, destination, buildCacheDir: buildLayout.cache, nodeVersion, pnpmVersion: pnpmManifest.version, pluginVersions: baselinePlugins.map(({ name, version }) => ({ name, version })), currentVersion: options.currentVersion ?? '0.2.0-rc.2', clientTouched: false, dataTouched: false };
if (args.includes('--dry-run')) { process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`); return plan; }

await fs.mkdir(destination, { recursive: true });
const history = path.join(destination, 'deployment-history');
const configPath = path.join(destination, 'updater-config.json');
if (await fs.lstat(configPath).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error))) {
  await fs.mkdir(history, { recursive: true });
  await fs.copyFile(configPath, path.join(history, `config-${Date.now()}.json`));
}
for (const filename of ['upgrade-worker.mjs', 'inspect-processes.ps1', 'inspect-link.ps1', 'inspect-build-cache.ps1', 'installation-metadata.ps1', 'baseline-history.cjs', 'baseline-compatibility.mjs', 'data-probe.mjs', 'README.md']) await fs.copyFile(path.join(ownDirectory, filename), path.join(destination, filename));
const tools = path.join(destination, 'tools'); await fs.mkdir(tools, { recursive: true });
const nodeDestination = path.join(tools, 'node.exe');
await fs.copyFile(options.nodeExecutable, nodeDestination);
await fs.cp(options.pnpmDirectory, path.join(tools, 'pnpm'), { recursive: true, dereference: true, force: true });
await fs.cp(options.npmDirectory, path.join(tools, 'npm'), { recursive: true, dereference: true, force: true });
const pluginDestination = path.join(destination, 'plugin-compat'); await fs.mkdir(pluginDestination, { recursive: true });
for (const filename of ['probe.mjs', 'baseline-inventory.json']) await fs.copyFile(path.join(options.pluginAssets, filename), path.join(pluginDestination, filename));
const plugins = [];
for (const plugin of baselinePlugins) {
  await copyPinnedPlugin(plugin, path.join(pluginDestination, 'packages', plugin.name.split('/').at(-1)));
  const copied = path.join(pluginDestination, 'baseline', plugin.name.split('/').at(-1));
  await copyPinnedPlugin(plugin, copied);
  plugins.push({ ...plugin, path: copied });
}
const config = {
  schemaVersion: 1, root: destination, buildCacheDir: buildLayout.cache, currentVersion: plan.currentVersion,
  installDir: options.installDir, userDataDir: options.userDataDir, sharedDataDir: options.sharedDataDir,
  tools: {
    node: { executable: nodeDestination }, git: { executable: options.gitExecutable },
    pnpm: { executable: nodeDestination, args: [path.join(tools, 'pnpm', 'bin', 'pnpm.cjs')] },
    powershell: { executable: options.powershellExecutable },
  },
  compatibilityPatch: path.join(destination, 'source-compatibility.patch'),
  compatibilityProbe: path.join(pluginDestination, 'probe.mjs'),
  npmCli: path.join(tools, 'npm', 'bin', 'npm-cli.js'),
  dataProbe: path.join(destination, 'data-probe.mjs'), plugins,
  healthTimeoutMs: 120_000,
};
if (options.compatibilityPatch) await fs.copyFile(options.compatibilityPatch, config.compatibilityPatch);
await atomicJson(configPath, config);
await atomicJson(path.join(destination, 'deployment.json'), { ...plan, deployedAt: new Date().toISOString(), nodeSha256: await hashFile(nodeDestination), configPath });
process.stdout.write(`${JSON.stringify({ ...plan, configPath, workerPath: path.join(destination, 'upgrade-worker.mjs') }, null, 2)}\n`);
return { ...plan, configPath, workerPath: path.join(destination, 'upgrade-worker.mjs') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) deployMain().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
