/** Offline fixture exercises pnpm's actual applyPatchToDir and frozen install at the short build path. */
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { atomicJson, ensureBuildCache, hashFile, sourceBuildLayout, sourceInstallArguments } from './upgrade-worker.mjs';

const execute = promisify(execFile);
const own = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const sourceIndex = args.indexOf('--source-checkout');
if (sourceIndex < 0 || args.lastIndexOf('--source-checkout') !== sourceIndex || !args[sourceIndex + 1] || !path.isAbsolute(args[sourceIndex + 1])) throw new Error('Usage: node test-short-pnpm-build.mjs --source-checkout ABS_OFFICIAL_CHECKOUT (with pinned pnpm installed).');
const sourceCheckout = path.resolve(args[sourceIndex + 1]);
const npmCli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const pnpmDirectory = path.join(sourceCheckout, 'node_modules/pnpm');
const pnpmCli = path.join(pnpmDirectory, 'bin/pnpm.cjs');
const pnpmManifest = JSON.parse(await fs.readFile(path.join(pnpmDirectory, 'package.json'), 'utf8'));
assert.equal(pnpmManifest.name, 'pnpm');
assert.equal(pnpmManifest.version, '11.28.5', 'Explicit checkout must provide the fixture pinned pnpm version.');
await fs.access(npmCli);
await fs.access(pnpmCli);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'dp-'));
const resultPath = path.join(own, 'tests', 'short-pnpm-result.json');
const config = { root: path.join(temporary, 'helper'), buildCacheDir: path.join(temporary, 'c'), tools: { powershell: { executable: path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe') } } };
const target = { version: '0.0.0-fixture.1', tag: 'dsh-v0.0.0-fixture.1', commit: '1'.repeat(40) };
const layout = sourceBuildLayout(config, target, '2'.repeat(64));
try {
  await ensureBuildCache(config, layout);
  await fs.mkdir(layout.sourcePath, { recursive: true });
  const packageDirectory = path.join(temporary, 'package'); await fs.mkdir(packageDirectory);
  await atomicJson(path.join(packageDirectory, 'package.json'), { name: '@electron/osx-sign', version: '1.3.3', main: 'index.js', files: ['index.js'] });
  await fs.writeFile(path.join(packageDirectory, 'index.js'), 'module.exports = "before-patch";\n');
  const packed = JSON.parse((await execute(process.execPath, [npmCli, 'pack', '--json', '--ignore-scripts', '--pack-destination', layout.sourcePath], { cwd: packageDirectory, windowsHide: true })).stdout);
  const archive = packed[0].filename;
  await atomicJson(path.join(layout.sourcePath, 'package.json'), { name: 'dsh-short-path-fixture', private: true, version: '0.0.0', packageManager: 'pnpm@11.28.5', dependencies: { '@electron/osx-sign': `file:./${archive}` } });
  await fs.mkdir(path.join(layout.sourcePath, 'patches'));
  await fs.writeFile(path.join(layout.sourcePath, 'patches', 'osx-sign.patch'), 'diff --git a/index.js b/index.js\nindex 08e7f00..f0a1b00 100644\n--- a/index.js\n+++ b/index.js\n@@ -1 +1 @@\n-module.exports = "before-patch";\n+module.exports = "after-patch";\n');
  await fs.writeFile(path.join(layout.sourcePath, 'pnpm-workspace.yaml'), "packages:\n  - '.'\npatchedDependencies:\n  '@electron/osx-sign@1.3.3': patches/osx-sign.patch\n");
  const command = async args => execute(process.execPath, [pnpmCli, ...args, '--offline', '--ignore-scripts', '--store-dir', path.join(temporary, 'store')], { cwd: layout.sourcePath, windowsHide: true, maxBuffer: 1024 * 1024, timeout: 120000 });
  await command(['install', '--lockfile-only', '--config.virtual-store-dir-max-length=40']);
  const lockPath = path.join(layout.sourcePath, 'pnpm-lock.yaml'); const lockHash = await hashFile(lockPath);
  const installed = await command(sourceInstallArguments());
  assert.equal(await hashFile(lockPath), lockHash, 'frozen install must not rewrite the lockfile');
  const dependency = await fs.realpath(path.join(layout.sourcePath, 'node_modules/@electron/osx-sign'));
  const code = await fs.readFile(path.join(dependency, 'index.js'), 'utf8');
  assert.match(code, /after-patch/);
  assert.ok(dependency.length < 240, `patched package path must remain below conservative legacy limit: ${dependency.length}`);
  const folder = path.relative(path.join(layout.sourcePath, 'node_modules/.pnpm'), dependency).split(path.sep)[0];
  assert.ok(folder.length <= 40, 'pnpm must use the requested shorter virtual-store folder limit');
  const result = { pass: true, pnpm: '11.28.5', network: 'offline', scope: 'isolated fixture only; no official source build, live data, deployment or global policy changes', cache: layout.cache, sourcePath: layout.sourcePath, patchedPackagePathLength: dependency.length, virtualStoreFolderLength: folder.length, lockfileUnchanged: true, patchedDependencyRead: true, installOutput: installed.stdout.slice(-2000) };
  await atomicJson(resultPath, result); process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  // Fixed temporary root owned by this fixture; never recurse through other directories.
  await fs.rm(temporary, { recursive: true, force: true });
}
