/** Local Windows source updater. No agents, remote scripts, or automatic source repair. */
import { spawn } from 'node:child_process';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const SELF = fileURLToPath(import.meta.url);
const OFFICIAL = 'https://github.com/deepseek-ai/deepseek-harness.git';
const RELEASES = 'https://api.github.com/repos/deepseek-ai/deepseek-harness/releases';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const exists = async value => fs.lstat(value).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error));
const json = async value => JSON.parse(await fs.readFile(value, 'utf8'));
const digest = value => createHash('sha256').update(value).digest('hex');

export class Blocked extends Error { constructor(message, options) { super(message, options); this.name = 'Blocked'; } }

/** A read-only release query failed; another explicit client launch may try again. */
export class ReleaseCheckUnavailable extends Error {
  constructor(message, options) { super(message, options); this.name = 'ReleaseCheckUnavailable'; }
}

/** Publish one complete JSON file; readers never observe truncated state. */
export async function atomicJson(filename, value) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  await fs.rename(temporary, filename);
}

export async function hashFile(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

export function assertWithin(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (relative === '' || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(`Unsafe child path: ${child}`);
  }
  return path.resolve(child);
}

export async function assertUnlinkedAncestors(filename) {
  let current = path.resolve(filename);
  for (;;) {
    const stat = await fs.lstat(current).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (stat?.isSymbolicLink()) throw new Blocked(`Linked transaction path: ${current}`);
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function livePid(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

class WorkerLockBlocked extends Blocked {
  constructor(lockState, message) { super(message); this.lockState = lockState; }
}

/** An absent lock is ordinary completion; malformed or dead ownership remains an inspection barrier. */
async function readWorkerLock(lockPath) {
  let bytes;
  try { bytes = await fs.readFile(lockPath, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return { kind: 'absent' }; throw error; }
  let owner;
  try { owner = JSON.parse(bytes); }
  catch (error) { if (error instanceof SyntaxError) return { kind: 'invalid' }; throw error; }
  if (!owner || typeof owner !== 'object' || !Number.isSafeInteger(owner.pid) || owner.pid < 1 || typeof owner.token !== 'string' || !owner.token) return { kind: 'invalid' };
  return { kind: 'owned', owner };
}

/** Do not steal a dead lock: interrupted installation requires journal inspection. */
export async function acquireLock(root) {
  await fs.mkdir(root, { recursive: true });
  await assertUnlinkedAncestors(root);
  const lockPath = path.join(root, 'worker.lock');
  const token = randomUUID();
  const temporary = path.join(root, `.worker-lock-${process.pid}-${token}.tmp`);
  let ownedTemporary = false;
  try {
    const staged = await fs.open(temporary, 'wx', 0o600);
    ownedTemporary = true;
    try { await staged.writeFile(JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() })); }
    finally { await staged.close(); }
    let published = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await fs.link(temporary, lockPath); published = true; break; }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      const lock = await readWorkerLock(lockPath);
      if (lock.kind === 'absent') continue;
      if (lock.kind === 'owned' && livePid(lock.owner.pid)) throw new WorkerLockBlocked('busy', `Another update worker is running (${lock.owner.pid})`);
      throw new WorkerLockBlocked('interrupted', `${lock.kind === 'invalid' ? 'Invalid' : 'Interrupted'} update lock requires inspection: ${lockPath}`);
    }
    if (!published) throw new WorkerLockBlocked('busy', 'Update worker ownership changed repeatedly; observe the shared task before retrying');
  } finally {
    // This contender owns only its unique temporary name, never another worker's published lock.
    if (ownedTemporary) await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  return async () => {
    const lock = await readWorkerLock(lockPath);
    if (lock.kind !== 'owned' || lock.owner.token !== token) throw new Error('Update lock ownership changed');
    await fs.unlink(lockPath);
  };
}

/** Spawn without a shell. .cmd wrappers use a separately configured Node entry instead. */
export async function run(executable, args, options = {}) {
  const { log, timeoutMs = 3_600_000, ...spawnOptions } = options;
  if (/\.(?:cmd|bat|ps1)$/i.test(executable)) throw new Blocked(`Configure the executable or Node CLI entry instead of a shell wrapper: ${executable}`);
  let output = '';
  let diagnostics = '';
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...spawnOptions });
    const timer = setTimeout(() => {
      // Never kill an uncertain installer or process tree and then continue to rollback.
      const failure = new Blocked(`Command exceeded deadline; inspect surviving PID ${child.pid}: ${executable}`);
      failure.retainLock = true;
      reject(failure);
    }, timeoutMs);
    const onData = (chunk, stdout) => {
      if (stdout) output = (output + chunk.toString()).slice(-256_000);
      diagnostics = (diagnostics + chunk.toString()).slice(-256_000);
      if (log) log.write(chunk);
    };
    child.stdout.on('data', chunk => onData(chunk, true)); child.stderr.on('data', chunk => onData(chunk, false));
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else { const error = new Error(`Command exited ${code}: ${executable}\n${diagnostics.slice(-4000)}`); error.processExited = true; reject(error); }
    });
  });
  return output.trim();
}

/** Snapshot reachable bytes while recording links. Cycles and special files fail explicitly. */
export async function snapshotTree(source, destination, options = {}) {
  if (await exists(destination)) throw new Error(`Snapshot destination already exists: ${destination}`);
  const entries = [];
  async function visit(input, output, relative, ancestors) {
    const stat = await fs.lstat(input);
    if (stat.isSymbolicLink()) {
      const link = await fs.readlink(input);
      const normalized = relative.replaceAll('\\', '/');
      if (options.preserveDependencyLinks && normalized.split('/').includes('node_modules')
        && !/(?:^|\/)desktop\/node_modules(?:\/|$)/.test(normalized)) {
        const resolved = path.resolve(path.dirname(input), link);
        let target;
        try { target = await fs.stat(input); }
        catch (error) {
          if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
        }
        entries.push({ relative, kind: 'link', link, resolved, directory: target?.isDirectory() ?? true, preservedDependency: true });
        if (target?.isFile()) await fs.writeFile(output, '', { flag: 'wx' });
        else await fs.mkdir(output, { recursive: true });
        return;
      }
      let resolved;
      try { resolved = await fs.realpath(input); }
      catch (error) {
        const physical = path.resolve(path.dirname(input), link);
        const allowed = (options.opaqueAsarRoots ?? []).some(root => {
          const relative = path.relative(root, physical);
          return !relative.startsWith('..') && !path.isAbsolute(relative) && /(?:^|[\\/])app\.asar[\\/]/i.test(physical);
        });
        if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
        if (!allowed) {
          if (process.platform === 'win32' && !options.linkInspectorExecutable) throw error;
          const information = process.platform === 'win32' ? JSON.parse(await run(options.linkInspectorExecutable,
            ['-NoProfile', '-NonInteractive', '-File', path.join(path.dirname(SELF), 'inspect-link.ps1'), '-LiteralPath', input], { timeoutMs: 30_000 })) : { directory: false };
          if (typeof information.directory !== 'boolean') throw new Blocked(`Unknown dangling link type: ${input}`);
          entries.push({ relative, kind: 'link', link, resolved: physical, directory: information.directory, dangling: true });
          if (information.directory) await fs.mkdir(output, { recursive: true });
          else await fs.writeFile(output, '', { flag: 'wx' });
          return;
        }
        // Electron resolves these links inside the archived runtime. Program bytes are in the separate install snapshot.
        entries.push({ relative, kind: 'link', link, resolved: physical, directory: true, opaqueAsar: true });
        await fs.mkdir(output, { recursive: true });
        return;
      }
      if (ancestors.includes(resolved)) throw new Blocked(`Cyclic snapshot link: ${input}`);
      entries.push({ relative, kind: 'link', link, resolved, directory: (await fs.stat(input)).isDirectory() });
      await visit(resolved, output, relative, ancestors);
      return;
    }
    if (stat.isDirectory()) {
      const real = await fs.realpath(input);
      if (ancestors.includes(real)) throw new Blocked(`Cyclic snapshot directory: ${input}`);
      await fs.mkdir(output, { recursive: true, mode: stat.mode });
      entries.push({ relative, kind: 'directory', mode: stat.mode });
      for (const name of (await fs.readdir(input)).sort()) await visit(path.join(input, name), path.join(output, name), path.join(relative, name), [...ancestors, real]);
    } else if (stat.isFile()) {
      await fs.mkdir(path.dirname(output), { recursive: true });
      await pipeline(createReadStream(input), createWriteStream(output, { flags: 'wx', mode: stat.mode }));
      const [sourceHash, copiedHash] = await Promise.all([hashFile(input), hashFile(output)]);
      const after = await fs.stat(input);
      if (sourceHash !== copiedHash || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Blocked(`File changed during consistent snapshot: ${input}`);
      await fs.utimes(output, stat.atime, stat.mtime);
      entries.push({ relative, kind: 'file', bytes: stat.size, sha256: copiedHash, mode: stat.mode });
    } else throw new Blocked(`Unsupported snapshot entry: ${input}`);
  }
  await visit(source, destination, '', []);
  const manifest = { schemaVersion: 1, source: path.resolve(source), destination: path.resolve(destination), entries };
  await verifySnapshotSource(manifest);
  return manifest;
}

/** Re-read a finished snapshot's source, including child sets and original link topology. No files are written. */
export async function verifySnapshotSource(manifest) {
  const groups = new Map();
  const children = new Map();
  const keyOf = value => value.replaceAll('\\', '/');
  for (const entry of manifest.entries) {
    const key = keyOf(entry.relative);
    if (key) assertWithin(manifest.source, path.resolve(manifest.source, entry.relative));
    const group = groups.get(key) ?? []; group.push(entry); groups.set(key, group);
    if (key) {
      const slash = key.lastIndexOf('/'); const parent = slash < 0 ? '' : key.slice(0, slash);
      const names = children.get(parent) ?? new Set(); names.add(key.slice(slash + 1)); children.set(parent, names);
    }
  }
  const visited = new Set();
  const changed = relative => new Blocked(`Source changed after snapshot copy: ${relative || '<root>'}; installation deferred`);
  async function visit(filename, relative, throughLink = false, ancestors = []) {
    const group = groups.get(relative);
    if (!group) throw changed(relative);
    const information = throughLink ? await fs.stat(filename) : await fs.lstat(filename);
    const link = group.find(entry => entry.kind === 'link');
    if (!throughLink && link) {
      if (!information.isSymbolicLink() || await fs.readlink(filename) !== link.link) throw changed(relative);
      visited.add(relative);
      if (link.preservedDependency) return; // Record the pointer; unrelated retired dependency bytes were never copied.
      if (link.dangling || link.opaqueAsar) {
        try { await fs.realpath(filename); }
        catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return; throw error; }
        throw changed(relative);
      }
      const resolved = await fs.realpath(filename);
      if (resolved !== link.resolved || ancestors.includes(resolved)) throw changed(relative);
      return visit(filename, relative, true, ancestors);
    }
    if (!throughLink && information.isSymbolicLink()) throw changed(relative);
    visited.add(relative);
    if (information.isDirectory()) {
      if (!group.some(entry => entry.kind === 'directory')) throw changed(relative);
      const physical = await fs.realpath(filename);
      if (ancestors.includes(physical)) throw changed(relative);
      const actual = (await fs.readdir(filename)).sort();
      const expected = [...(children.get(relative) ?? [])].sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) throw changed(relative);
      for (const name of actual) await visit(path.join(filename, name), relative ? `${relative}/${name}` : name, false, [...ancestors, physical]);
    } else if (information.isFile()) {
      const file = group.find(entry => entry.kind === 'file');
      if (!file || information.size !== file.bytes || await hashFile(filename) !== file.sha256) throw changed(relative);
    } else throw changed(relative);
  }
  try { await visit(manifest.source, ''); }
  catch (error) {
    if (error instanceof Blocked) throw error;
    throw new Blocked(`Source unavailable during completed snapshot verification: ${error.message}`);
  }
  if (visited.size !== groups.size) throw new Blocked('Source directory inventory changed after snapshot copy; installation deferred');
  return true;
}

export async function verifySnapshot(manifest) {
  for (const entry of manifest.entries) {
    const filename = entry.relative ? assertWithin(manifest.destination, path.join(manifest.destination, entry.relative)) : manifest.destination;
    if (entry.kind === 'file' && await hashFile(filename) !== entry.sha256) throw new Error(`Snapshot hash mismatch: ${filename}`);
  }
}

/** Restore a fully verified snapshot, retaining original link topology. */
export async function restoreTree(manifest) {
  await verifySnapshot(manifest);
  const source = path.resolve(manifest.source);
  await assertUnlinkedAncestors(path.dirname(source));
  // Link targets outside this tree are read-only throughout the transaction. Do not overwrite projects.
  const links = manifest.entries.filter(entry => entry.kind === 'link').sort((a, b) => a.relative.length - b.relative.length);
  for (const entry of links) {
    const external = path.relative(source, entry.resolved);
    if (entry.dangling && await exists(entry.resolved)) throw new Blocked(`Dangling link target appeared during rollback: ${entry.resolved}`);
    if (!entry.opaqueAsar && !entry.preservedDependency && !entry.dangling && (external === '..' || external.startsWith(`..${path.sep}`) || path.isAbsolute(external))) {
      const materialized = path.join(manifest.destination, entry.relative);
      const check = await fs.mkdtemp(path.join(path.dirname(manifest.destination), 'external-check-'));
      await fs.rmdir(check);
      const current = await snapshotTree(entry.resolved, check);
      const expected = manifest.entries.filter(item => item.kind === 'file' && (item.relative === entry.relative || item.relative.startsWith(`${entry.relative}${path.sep}`))).map(item => [path.relative(entry.relative, item.relative), item.sha256]);
      const actual = current.entries.filter(item => item.kind === 'file').map(item => [item.relative, item.sha256]);
      if (JSON.stringify(expected.sort()) !== JSON.stringify(actual.sort())) throw new Blocked(`External link target changed; retained snapshot ${materialized}, original target ${entry.resolved}`);
    }
  }
  const restoreStage = `${source}.dsh-restore-${randomUUID()}`;
  await fs.cp(manifest.destination, restoreStage, { recursive: true, dereference: true, errorOnExist: true, force: false });
  const completed = [];
  for (const entry of links) {
    if (completed.some(parent => entry.relative.startsWith(`${parent}${path.sep}`))) continue;
    const linkPath = entry.relative ? assertWithin(restoreStage, path.join(restoreStage, entry.relative)) : restoreStage;
    await fs.rm(linkPath, { recursive: true, force: true });
    await fs.symlink(entry.link, linkPath, entry.directory && process.platform === 'win32' ? 'junction' : entry.directory ? 'dir' : 'file');
    completed.push(entry.relative);
  }
  const displaced = `${source}.dsh-failed-${randomUUID()}`;
  if (await exists(source)) await fs.rename(source, displaced);
  try { await fs.rename(restoreStage, source); }
  catch (error) { if (await exists(displaced)) await fs.rename(displaced, source); throw error; }
  return { source, displaced };
}

function parseTarget(target) {
  if (!target || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(target.version) || target.tag !== `dsh-v${target.version}` || !/^[a-f0-9]{40}$/.test(target.commit)) throw new Blocked('Target must name a complete official dsh-v version and 40-character commit');
  try { compareVersions(target.version, target.version); }
  catch (error) { throw new Blocked(`Invalid target version: ${error.message}`); }
  return target;
}

export function compareVersions(left, right) {
  const parse = value => {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
    if (!match) throw new Error(`Invalid version: ${value}`);
    const pre = match[4]?.split('.') ?? [];
    if (pre.some(item => /^\d+$/.test(item) && item.length > 1 && item.startsWith('0'))) throw new Error(`Invalid numeric prerelease: ${value}`);
    return { core: match.slice(1, 4).map(BigInt), pre };
  };
  const a = parse(left); const b = parse(right);
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
  if (!a.pre.length || !b.pre.length) return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    if (a.pre[i] === undefined || b.pre[i] === undefined) return a.pre[i] === undefined ? -1 : 1;
    if (a.pre[i] === b.pre[i]) continue;
    const numericA = /^\d+$/.test(a.pre[i]); const numericB = /^\d+$/.test(b.pre[i]);
    if (numericA !== numericB) return numericA ? -1 : 1;
    if (numericA) return BigInt(a.pre[i]) > BigInt(b.pre[i]) ? 1 : -1;
    return a.pre[i] > b.pre[i] ? 1 : -1;
  }
  return 0;
}

export async function latestPublished(currentVersion, fetcher = fetch) {
  compareVersions(currentVersion, currentVersion);
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'DSH-Local-Source-Updater' };
  const get = async url => {
    try {
      const response = await fetcher(url, { headers, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Official release check failed (${response.status})`);
      return await response.json();
    } catch (error) { throw new ReleaseCheckUnavailable(`Official release check unavailable; current installation retained: ${error.message}`, { cause: error }); }
  };
  let best;
  for (let page = 1; page <= 20; page++) {
    const releases = await get(`${RELEASES}?per_page=100&page=${page}`);
    if (!Array.isArray(releases)) throw new Error('Official release response must be a list');
    for (const release of releases) {
      if (release.draft || !release.published_at || !/^dsh-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(release.tag_name ?? '')) continue;
      const version = release.tag_name.slice(5);
      try {
        if (compareVersions(version, currentVersion) > 0 && (!best || compareVersions(version, best.version) > 0)) best = { version, tag: release.tag_name };
      } catch { /* Ignore release names that are not valid semver. */ }
    }
    if (releases.length < 100) break;
    if (page === 20) throw new Error('Official release pagination limit reached; comparison incomplete');
  }
  if (!best) return undefined;
  let ref = await get(`https://api.github.com/repos/deepseek-ai/deepseek-harness/git/ref/tags/${encodeURIComponent(best.tag)}`);
  for (let depth = 0; ref.object?.type === 'tag' && depth < 5; depth++) ref = await get(`https://api.github.com/repos/deepseek-ai/deepseek-harness/git/tags/${ref.object.sha}`);
  if (ref.object?.type !== 'commit' || !/^[a-f0-9]{40}$/.test(ref.object.sha ?? '')) throw new Error('Official release tag did not resolve to a fixed commit');
  return { ...best, commit: ref.object.sha, sourceUrl: OFFICIAL };
}

export async function verifyPublishedTarget(target, fetcher = fetch) {
  parseTarget(target);
  const response = await fetcher(`${RELEASES}/tags/${encodeURIComponent(target.tag)}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DSH-Local-Source-Updater' }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Blocked(`Cannot verify published release (${response.status})`);
  const release = await response.json();
  if (release.draft || !release.published_at || release.tag_name !== target.tag) throw new Blocked('Target is not a published official release');
}

async function command(config, name, cwd, args, options = {}) {
  const tool = config.tools[name];
  if (!tool || !path.isAbsolute(tool.executable)) throw new Blocked(`Missing absolute ${name} executable configuration`);
  return run(tool.executable, [...(tool.args ?? []), ...args], { cwd, ...options });
}

/** Keep Windows package patching below legacy process.chdir limits without changing global policy. */
export function sourceBuildLayout(config, target, patchHash, platform = process.platform, activePluginFingerprint) {
  const cache = path.resolve(config.buildCacheDir ?? path.join(homedir(), 'Documents', 'DSHB'));
  if (config.buildCacheDir && !path.isAbsolute(config.buildCacheDir)) throw new Blocked('buildCacheDir must be an absolute local directory');
  if (path.dirname(cache) === cache) throw new Blocked('A volume root cannot be a source build cache');
  if (platform === 'win32' && (!/^[a-z]:[\\/]/i.test(cache) || cache.length > 64)) throw new Blocked(`Windows source build cache must be a local absolute path at most 64 characters; set buildCacheDir to a shorter Documents directory: ${cache}`);
  const overlaps = (first, second) => {
    const relative = path.relative(first, second);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  };
  for (const key of ['root', 'installDir', 'userDataDir', 'sharedDataDir']) {
    if (config[key] && (overlaps(cache, path.resolve(config[key])) || overlaps(path.resolve(config[key]), cache))) throw new Blocked(`Source build cache must be separate from ${key}: ${cache}`);
  }
  const pluginSelection = config.plugins?.map(plugin => ({ name: plugin.name, version: plugin.version, files: Object.fromEntries(Object.entries(plugin.files ?? {}).sort(([left], [right]) => left.localeCompare(right))) })).sort((left, right) => left.name.localeCompare(right.name));
  const identifier = digest(JSON.stringify({ commit: target.commit, tag: target.tag, patchHash, pluginSelection, activePluginFingerprint })).slice(0, 16);
  const buildRoot = assertWithin(cache, path.join(cache, identifier));
  const sourcePath = assertWithin(buildRoot, path.join(buildRoot, 's'));
  return { cache, buildRoot, sourcePath };
}

/** Refuse unfamiliar directories or cache ownership changes before fetching or moving anything. */
export async function ensureBuildCache(config, layout) {
  await assertUnlinkedAncestors(layout.cache);
  const existed = await exists(layout.cache);
  if (!existed) await fs.mkdir(layout.cache, { recursive: true });
  const physical = await fs.realpath(layout.cache);
  if (process.platform === 'win32' && physical.length > 64) throw new Blocked(`Source cache physical path exceeds 64 characters after redirection; choose a shorter buildCacheDir outside AppData: ${physical}`);
  if (path.resolve(physical).toLowerCase() !== path.resolve(layout.cache).toLowerCase()) throw new Blocked(`Source cache resolves to a different physical path: ${physical}`);
  if (process.platform === 'win32') {
    const ownership = JSON.parse(await run(config.tools.powershell.executable, ['-NoProfile', '-NonInteractive', '-File', path.join(path.dirname(SELF), 'inspect-build-cache.ps1'), '-CachePath', layout.cache], { timeoutMs: 30_000 }));
    if (ownership.ownedByCurrentUser !== true) throw new Blocked('Source build cache is not owned by the current Windows account');
  } else if ((await fs.stat(layout.cache)).uid !== process.getuid()) throw new Blocked('Source build cache is not owned by the current account');
  const markerPath = path.join(layout.cache, '.dsh-source-cache.json');
  const owner = digest(path.resolve(config.root).toLowerCase());
  if (await exists(markerPath)) {
    const marker = await json(markerPath);
    if (marker.schemaVersion !== 1 || marker.owner !== owner) throw new Blocked('Source build cache belongs to another updater configuration');
  } else {
    if ((await fs.readdir(layout.cache)).length !== 0) throw new Blocked(`Unfamiliar nonempty source build cache is retained without changes: ${layout.cache}`);
    await fs.writeFile(markerPath, `${JSON.stringify({ schemaVersion: 1, owner, updaterRoot: path.resolve(config.root), createdAt: new Date().toISOString() }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  }
  await assertUnlinkedAncestors(layout.buildRoot);
  return physical;
}

/** The frozen graph remains unchanged; only its disposable Windows package folder names are shortened. */
export function sourceInstallArguments(platform = process.platform) {
  return ['install', '--frozen-lockfile', ...(platform === 'win32' ? ['--config.virtual-store-dir-max-length=40'] : [])];
}

export function selectedPluginNames(plugins) {
  if (!Array.isArray(plugins) || plugins.length === 0) throw new Blocked('A nonempty explicitly qualified local plugin selection is required');
  const names = new Set();
  for (const plugin of plugins) {
    if (!plugin || typeof plugin.name !== 'string' || !/^@local\/[a-z0-9-]+$/.test(plugin.name) || names.has(plugin.name)) throw new Blocked(`Invalid or duplicate baseline plugin: ${plugin?.name}`);
    names.add(plugin.name);
  }
  return [...names];
}

export async function assertPlugins(config) {
  selectedPluginNames(config.plugins);
  for (const plugin of config.plugins) {
    let manifest;
    try { manifest = await json(path.join(plugin.path, 'package.json')); }
    catch (error) { throw new Blocked(`Plugin compatibility baseline unavailable: ${plugin.name}; ${error.message}`); }
    if (manifest.name !== plugin.name || manifest.version !== plugin.version) throw new Blocked(`Plugin changed: ${plugin.name}; expected ${plugin.version}, found ${manifest.version}`);
    if (!plugin.files || Object.keys(plugin.files).length === 0) throw new Blocked(`Plugin file hashes missing: ${plugin.name}`);
    for (const [relative, sha256] of Object.entries(plugin.files)) {
      let actual;
      try { actual = await hashFile(assertWithin(plugin.path, path.join(plugin.path, relative))); }
      catch (error) { throw new Blocked(`Plugin compatibility baseline file unavailable: ${plugin.name}/${relative}; ${error.message}`); }
      if (actual !== sha256) throw new Blocked(`Plugin compatibility baseline changed: ${plugin.name}/${relative}`);
    }
  }
}

/** The reserved Desktop plugin project contains external packages, not the built-in runtime graph. */
export async function assertPluginSelection(plugins, home) {
  const profile = path.join(home, 'profiles', 'desktop');
  let manifest;
  try { manifest = await json(path.join(profile, 'package.json')); }
  catch (error) { throw new Blocked(`Active Desktop plugin manifest unavailable; current installation retained: ${error.message}`); }
  const expected = new Set(selectedPluginNames(plugins));
  const declared = new Set();
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const entries = manifest[field];
    if (entries !== undefined && (!entries || typeof entries !== 'object' || Array.isArray(entries))) throw new Blocked(`Invalid Desktop plugin ${field}`);
    for (const name of Object.keys(entries ?? {})) {
      if (!expected.has(name)) throw new Blocked(`Plugin compatibility not established: ${name} is newly declared in ${field}; current installation retained`);
      declared.add(name);
    }
  }
  for (const name of expected) if (!declared.has(name)) throw new Blocked(`Active plugin not installed or removed from Desktop dependencies: ${name}; current installation retained`);
  const bundles = manifest.dsh?.profile?.bundles;
  if (bundles !== undefined) {
    if (!Array.isArray(bundles) || bundles.some(name => typeof name !== 'string')) throw new Blocked('Invalid Desktop profile bundle selection');
    for (const name of expected) if (!bundles.includes(name)) throw new Blocked(`Active plugin removed from Desktop bundles: ${name}; current installation retained`);
    for (const name of bundles) if (!expected.has(name) && !name.startsWith('@deepseek-ai/dsh-')) throw new Blocked(`Plugin compatibility not established: ${name} is newly selected in Desktop bundles; current installation retained`);
  }
  const localDirectory = path.join(profile, 'node_modules', '@local');
  for (const entry of await fs.readdir(localDirectory).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error))) {
    const name = `@local/${entry}`;
    if (!expected.has(name)) throw new Blocked(`Plugin compatibility not established: ${name} is newly installed; current installation retained`);
  }
  return manifest;
}

/** Refuse to overwrite a manually updated or edited active plugin with the frozen baseline. */
export async function assertActivePlugins(config, home, options = {}) {
  const profile = await assertPluginSelection(config.plugins, home);
  let approved;
  if (config.activePluginPins !== undefined) {
    if (typeof config.activePluginPins !== 'string' || !path.isAbsolute(config.activePluginPins)) throw new Blocked('activePluginPins must name an explicit absolute trusted manifest');
    try { approved = await json(config.activePluginPins); }
    catch (error) { throw new Blocked(`Trusted active plugin qualification is unavailable: ${error.message}`); }
    if (!Array.isArray(approved.plugins) || approved.plugins.length !== config.plugins.length || new Set(approved.plugins.map(plugin => plugin.name)).size !== config.plugins.length) throw new Blocked('Trusted active plugin qualification inventory differs from the baseline');
  }
  const fingerprints = [];
  for (const plugin of config.plugins) {
    const directory = path.join(home, 'profiles', 'desktop', 'node_modules', plugin.name);
    let active;
    try { active = await json(path.join(directory, 'package.json')); }
    catch (error) { throw new Blocked(`Active plugin not installed, removed or unreadable: ${plugin.name}; current installation retained. ${error.message}`); }
    const original = await json(path.join(plugin.path, 'package.json'));
    if (active.name !== plugin.name || typeof active.version !== 'string' || active.version.split('+')[0] !== plugin.version) throw new Blocked(`Active plugin changed: ${plugin.name}; expected baseline ${plugin.version}, found ${active.version}`);
    for (const field of ['main', 'exports', 'type', 'dependencies', 'optionalDependencies', 'dsh']) {
      if (JSON.stringify(active[field]) !== JSON.stringify(original[field])) throw new Blocked(`Active plugin configuration changed: ${plugin.name}/${field}; current installation retained`);
    }
    const files = {};
    let requiresTrustedQualification = JSON.stringify(active) !== JSON.stringify(original);
    for (const [relative, sha256] of Object.entries(plugin.files)) {
      let actual;
      try { actual = await hashFile(assertWithin(directory, path.join(directory, relative))); }
      catch (error) { throw new Blocked(`Active plugin file missing or unreadable: ${plugin.name}/${relative}; ${error.message}`); }
      files[relative] = actual;
      if (relative === 'package.json') continue;
      if (relative === 'cordis.patch.yml' && ['@local/dsh-adaptive-mode', '@local/dsh-code-video-mode'].includes(plugin.name)) {
        if (actual !== sha256) requiresTrustedQualification = true;
        continue;
      }
      if (actual !== sha256) throw new Blocked(`Active plugin file changed: ${plugin.name}/${relative}; current installation retained`);
    }
    if (requiresTrustedQualification) {
      const trusted = approved?.plugins.find(item => item.name === plugin.name);
      if (!trusted || trusted.version !== active.version || !trusted.files?.['package.json'] || (files['cordis.patch.yml'] && !trusted.files['cordis.patch.yml'])) throw new Blocked(`Active plugin manifest or preset differs from baseline: ${plugin.name}; explicit trusted activePluginPins qualification is required before it can be replaced`);
      for (const [relative, sha256] of Object.entries(trusted.files)) {
        if (await hashFile(assertWithin(directory, path.join(directory, relative))) !== sha256) throw new Blocked(`Trusted active plugin bytes changed: ${plugin.name}/${relative}; current installation retained`);
      }
    }
    const item = { name: plugin.name, manifest: active, files };
    const fingerprint = digest(JSON.stringify(item));
    if (options.capture) options.capture[plugin.name] = fingerprint;
    if (options.expected && options.expected[plugin.name] !== fingerprint) throw new Blocked(`Active plugin configuration or bytes changed since source preparation: ${plugin.name}; current installation retained`);
    fingerprints.push(item);
  }
  return digest(JSON.stringify({ profile, plugins: fingerprints }));
}

export async function validateInstallationRoots(config, request = {}) {
  const roots = [];
  for (const key of ['root', 'installDir', 'userDataDir', 'sharedDataDir']) {
    const value = request[key] ?? config[key];
    if (!value || !path.isAbsolute(value) || path.dirname(value) === value) throw new Blocked(`Invalid ${key}`);
    if (!config[key] || path.resolve(config[key]).toLowerCase() !== path.resolve(value).toLowerCase()) throw new Blocked(`${key} does not match the configured installation`);
    await assertUnlinkedAncestors(value);
    if (!(await fs.stat(value)).isDirectory()) throw new Blocked(`${key} must be an existing directory`);
    roots.push([key, path.resolve(value)]);
  }
  const contains = (parent, child) => { const relative = path.relative(parent, child); return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)); };
  for (const [name, filename] of roots) for (const [otherName, other] of roots) if (otherName !== name && contains(filename, other)) throw new Blocked('Helper, install and state snapshot roots must be disjoint');
  return roots.filter(([key]) => key !== 'root');
}

export async function assertCompatiblePlugins(config, plugins, target) {
  const expected = selectedPluginNames(config.plugins);
  let actual;
  try { actual = selectedPluginNames(plugins); } catch { throw new Blocked('Compatible plugin inventory differs from the frozen baseline'); }
  if (actual.length !== expected.length || actual.some(name => !expected.includes(name))) throw new Blocked('Compatible plugin inventory differs from the frozen baseline');
  for (const baseline of config.plugins) {
    const plugin = plugins.find(item => item.name === baseline.name);
    if (!plugin || plugin.version !== `${baseline.version}+dsh.${target.version}` || !plugin.files || !Object.keys(plugin.files).length) throw new Blocked(`Compatible plugin target or inventory mismatch: ${baseline.name}`);
    try {
      if (!plugin.archive || await hashFile(plugin.archive) !== plugin.archiveSha256) throw new Blocked(`Compatible plugin archive missing or changed: ${baseline.name}`);
      for (const [relative, sha256] of Object.entries(plugin.files)) if (await hashFile(assertWithin(plugin.path, path.join(plugin.path, relative))) !== sha256) throw new Blocked(`Compatible plugin bytes changed: ${baseline.name}/${relative}`);
    } catch (error) {
      if (error instanceof Blocked) throw error;
      throw new Blocked(`Compatible plugin unavailable: ${baseline.name}; ${error.message}`);
    }
  }
}

/** Read-only qualification while Host is still running; only its caller writes helper status. */
export async function validateReadyState(config, request, state) {
  const target = parseTarget(request.target ?? state.target);
  if (state.schemaVersion !== 1 || !state.target || state.target.commit !== target.commit || state.target.version !== target.version || state.target.tag !== target.tag || state.sourceBuild !== true || state.unsigned !== true || state.appId !== 'com.deepseek.dsh') throw new Blocked('No matching verified source build is ready');
  const currentVersion = request.currentVersion ?? config.currentVersion;
  if (typeof currentVersion !== 'string' || compareVersions(target.version, currentVersion) <= 0) throw new Blocked(`Target ${target.version} is not newer than current version ${currentVersion}`);
  await validateInstallationRoots(config, request);
  await assertPlugins(config);
  const fingerprint = await assertActivePlugins(config, config.sharedDataDir, { expected: state.activePluginInventory });
  if (!config.compatibilityPatch || await hashFile(config.compatibilityPatch) !== state.patchSha256) throw new Blocked('Ready source compatibility patch digest changed or is missing');
  if (!state.artifactPath || await hashFile(state.artifactPath) !== state.artifactSha256) throw new Blocked('Installer digest changed');
  if (!state.unpackedApp || !(await fs.stat(state.unpackedApp)).isFile()) throw new Blocked('Verified unpacked application is unavailable');
  if (typeof state.activePluginFingerprint !== 'string') throw new Blocked('Cached source build lacks a current plugin fingerprint; fresh compatibility qualification is required');
  if (fingerprint !== state.activePluginFingerprint) throw new Blocked('Active plugin selection, configuration or bytes changed since source preparation; current installation retained');
  await assertCompatiblePlugins(config, state.targetPlugins, target);
  return state;
}

function candidateKey(state) {
  const { version, tag, commit } = state.target;
  return digest(JSON.stringify({ target: { version, tag, commit }, patchSha256: state.patchSha256, activePluginFingerprint: state.activePluginFingerprint }));
}

async function assertCandidateAllowed(config, state, request, manualRetryAllowed = false) {
  const filename = path.join(config.root, 'rejected-candidates', `${candidateKey(state)}.json`);
  if (!await exists(filename)) return;
  const rejection = await json(filename);
  if (rejection.active !== true) return;
  if (manualRetryAllowed && request.manualRetry === true) {
    await atomicJson(filename, { ...rejection, active: false, manualRetryAt: new Date().toISOString() });
    return;
  }
  throw new Blocked(`Candidate ${state.target.version} is quarantined after ${rejection.phase}: ${rejection.reason}; use an explicit manual retry after inspection`);
}

export async function quarantineCandidate(config, state, phase, reason) {
  const filename = path.join(config.root, 'rejected-candidates', `${candidateKey(state)}.json`);
  await atomicJson(filename, { schemaVersion: 1, active: true, target: state.target, patchSha256: state.patchSha256, activePluginFingerprint: state.activePluginFingerprint, phase, reason, rejectedAt: new Date().toISOString() });
}

export async function preflight(config, request, state) {
  if (state.phase !== 'ready') throw new Blocked('No matching verified source build is ready');
  if (!Number.isSafeInteger(request.appPid) || request.appPid < 1) throw new Blocked('Original application PID is required');
  if (typeof request.currentVersion !== 'string') throw new Blocked('Current application version is required for preflight');
  for (const key of ['installDir', 'userDataDir', 'sharedDataDir']) if (!request[key]) throw new Blocked(`Preflight requires ${key}`);
  await validateReadyState(config, request, state);
  await assertCandidateAllowed(config, state, request);
  return state;
}

/** Build scripts that invoke `node` inherit the same explicitly configured toolchain. */
export function sourceBuildEnvironment(config, presetRoot, environment = process.env, platform = process.platform) {
  const env = { ...environment, DSH_PACKAGING_CONFIG_DIR: presetRoot, DSH_PACKAGING_PRESET: 'production' };
  const pathKeys = Object.keys(env).filter(key => platform === 'win32' ? key.toLowerCase() === 'path' : key === 'PATH');
  const inheritedPath = pathKeys.map(key => env[key]).filter(Boolean).join(path.delimiter);
  for (const key of pathKeys) delete env[key];
  env.PATH = [path.dirname(config.tools.node.executable), inheritedPath].filter(Boolean).join(path.delimiter);
  return env;
}

async function prepare(config, request, update) {
  const target = parseTarget(request.target);
  const currentVersion = request.currentVersion ?? config.currentVersion;
  if (compareVersions(target.version, currentVersion) <= 0) throw new Blocked(`Target ${target.version} is not newer than current version ${currentVersion}`);
  await verifyPublishedTarget(target);
  await assertPlugins(config);
  await validateInstallationRoots(config, request);
  const activePluginInventory = {};
  const activePluginFingerprint = await assertActivePlugins(config, config.sharedDataDir, { capture: activePluginInventory });
  if (!config.compatibilityPatch || !config.compatibilityProbe) throw new Blocked('A fixed source compatibility patch and plugin compatibility probe are required');
  const patchHash = await hashFile(config.compatibilityPatch);
  const buildIdentity = { target, patchSha256: patchHash, activePluginFingerprint, activePluginInventory };
  await assertCandidateAllowed(config, buildIdentity, request, true);
  const layout = sourceBuildLayout(config, target, patchHash, process.platform, activePluginFingerprint);
  await ensureBuildCache(config, layout);
  const { buildRoot, sourcePath: source } = layout;
  const completion = path.join(buildRoot, 'ready.json');
  if (await exists(completion)) {
    const ready = await json(completion);
    await validateReadyState(config, request, ready);
    await assertCandidateAllowed(config, ready, request, true);
    return update('ready', { ...ready, detail: 'Previously verified source build is ready' });
  }
  if (await exists(buildRoot)) await fs.rename(buildRoot, assertWithin(layout.cache, `${buildRoot}.failed-${randomUUID()}`));
  await fs.mkdir(buildRoot, { recursive: true });
  const log = createWriteStream(path.join(buildRoot, 'build.log'), { flags: 'ax' });
  const reportBuild = (buildStage, detail) => update('building', { ...buildIdentity, buildStage, detail, buildRoot, sourcePath: source, buildCacheDir: layout.cache });
  try {
    await reportBuild('source', 'Fetching and verifying the fixed published source tag');
    await fs.mkdir(source);
    await command(config, 'git', source, ['init'], { log });
    // Scoped to this disposable checkout; official archived notes can exceed MAX_PATH.
    if (process.platform === 'win32') await command(config, 'git', source, ['config', 'core.longpaths', 'true'], { log });
    await command(config, 'git', source, ['remote', 'add', 'origin', OFFICIAL], { log });
    await command(config, 'git', source, ['fetch', '--depth=1', 'origin', `refs/tags/${target.tag}:refs/tags/${target.tag}`], { log });
    const actualCommit = await command(config, 'git', source, ['rev-parse', `${target.tag}^{commit}`]);
    if (actualCommit !== target.commit) throw new Blocked(`Published tag moved: ${actualCommit}`);
    await command(config, 'git', source, ['checkout', '--detach', target.commit], { log });
    const upstream = await json(path.join(source, 'package.json'));
    if (upstream.version !== target.version || !/^pnpm@\d+\.\d+\.\d+$/.test(upstream.packageManager)) throw new Blocked('Source version or pinned pnpm declaration differs');
    try { await command(config, 'git', source, ['apply', '--check', config.compatibilityPatch], { log }); }
    catch (error) { throw new Blocked(`The fixed source updater compatibility patch no longer applies; current installation retained. ${error.message}`); }
    await command(config, 'git', source, ['apply', config.compatibilityPatch], { log });
    const presetRoot = path.join(buildRoot, 'packaging');
    await fs.mkdir(path.join(presetRoot, 'presets'), { recursive: true });
    await fs.writeFile(path.join(presetRoot, 'presets', 'production.env'), `DSH_DESKTOP_APP_ID=com.deepseek.dsh\nDSH_DESKTOP_AUTO_UPDATE_ENV=production\nDSH_DESKTOP_MANDATORY_UPDATE_PROD_ORIGIN=https://harness.deepseek.com\n`);
    const env = sourceBuildEnvironment(config, presetRoot);
    await reportBuild('dependencies', 'Installing the source release locked dependencies');
    const pnpmVersion = await command(config, 'pnpm', source, ['--version']);
    if (`pnpm@${pnpmVersion}` !== upstream.packageManager) throw new Blocked(`Pinned build tool required: ${upstream.packageManager}; available pnpm@${pnpmVersion}`);
    await command(config, 'pnpm', source, sourceInstallArguments(), { log, env });
    await reportBuild('preflight', 'Checking the Windows x64 packaging toolchain');
    await command(config, 'pnpm', source, ['run', 'package:desktop:win:x64:unsigned', '--check'], { log, env });
    await reportBuild('packaging', 'Building the complete local unsigned Windows x64 client');
    await command(config, 'pnpm', source, ['run', 'package:desktop:win:x64:unsigned'], { log, env, timeoutMs: 7_200_000 });
    await reportBuild('plugins', 'Checking and packaging the explicitly selected plugins');
    const probeConfig = path.join(buildRoot, 'plugin-probe-config.json');
    await atomicJson(probeConfig, { outputDir: path.join(buildRoot, 'plugins'), expectedCommit: target.commit, selectedPlugins: selectedPluginNames(config.plugins), ...(config.npmCli ? { npmCli: config.npmCli } : {}) });
    try { await run(config.tools.node.executable, [config.compatibilityProbe, '--source', source, '--config', probeConfig], { cwd: source, log, env, timeoutMs: 300_000 }); }
    catch (error) { throw new Blocked(`Pinned plugin compatibility check failed; current installation retained. ${error.message}`); }
    const compatible = await json(path.join(buildRoot, 'plugins', 'compatibility-manifest.json'));
    if (compatible.targetVersion !== target.version || compatible.targetCommit !== target.commit) throw new Blocked('Plugin compatibility manifest target mismatch');
    await assertCompatiblePlugins(config, compatible.plugins, target);
    const outputRoot = path.join(source, 'apps', 'desktop', '.desktop-build', 'targets', 'win-x64', 'unsigned-artifacts');
    const installerName = `deepseek-harness-${target.version}-win-x64-unsigned.exe`;
    const artifactPath = path.join(outputRoot, installerName);
    const unpackedApp = path.join(outputRoot, 'win-unpacked', 'DeepSeek Harness.exe');
    await reportBuild('verification', 'Verifying the installer, runtime and unchanged active plugin qualification');
    if (!await exists(artifactPath) || !await exists(unpackedApp)) throw new Blocked('Verified installer and unpacked application must both exist');
    if (await assertActivePlugins(config, config.sharedDataDir) !== activePluginFingerprint) throw new Blocked('Active plugins changed while the source was building; current installation retained');
    const ready = { schemaVersion: 1, target, targetPlugins: compatible.plugins, artifactPath, artifactSha256: await hashFile(artifactPath), unpackedApp, patchSha256: patchHash, activePluginFingerprint, activePluginInventory, builtAt: new Date().toISOString(), buildRoot, sourcePath: source, buildCacheDir: layout.cache, sourceBuild: true, unsigned: true, appId: 'com.deepseek.dsh' };
    await validateReadyState(config, request, ready);
    await assertCandidateAllowed(config, ready, request, true);
    await atomicJson(completion, ready);
    return update('ready', { ...ready, detail: 'Unsigned local source build and plugin checks passed' });
  } catch (error) {
    if (!error.retainLock) {
      try { await quarantineCandidate(config, buildIdentity, 'prepare-failed', error.message); }
      catch (recordError) {
        const failure = new Blocked(`Source preparation failed and its rejection could not be saved; inspect before retry: ${recordError.message}`, { cause: error });
        failure.retainLock = true;
        failure.recoveryRequired = true;
        throw failure;
      }
    }
    throw error;
  } finally { log.end(); }
}

async function waitForExit(pid, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (livePid(pid)) {
    if (Date.now() >= deadline) { const error = new Blocked(`Application PID ${pid} did not exit gracefully; installation deferred`); error.retainLock = true; throw error; }
    await sleep(250);
  }
}

class ActiveDataWriters extends Blocked {
  constructor(writers) {
    super(`Data writers still running: ${writers.map(item => `${item.name}:${item.pid}`).join(', ')}`);
    this.writers = writers;
  }
}

async function assertNoWriters(config, request) {
  // This fixed script reads CIM only. Never interpolate paths or shell commands into it.
  const inspectionPath = path.join(config.root, `.writer-inspection-${process.pid}.json`);
  await atomicJson(inspectionPath, { ...request, workerPid: process.pid });
  let result;
  try { result = await run(config.tools.powershell.executable, ['-NoProfile', '-NonInteractive', '-File', path.join(path.dirname(SELF), 'inspect-processes.ps1'), '-RequestPath', inspectionPath], { timeoutMs: 30_000 }); }
  finally { await fs.unlink(inspectionPath); }
  const writers = JSON.parse(result);
  if (!Array.isArray(writers)) throw new Blocked('Writer inspection did not return a process list');
  if (writers.length) throw new ActiveDataWriters(writers);
}

/** A confirmed competing writer prevents both installation and an automatic Host restart. */
async function deferActiveWriters(config, state, failure, update, tx, journalPath) {
  try {
    await quarantineCandidate(config, state, 'deferred-writer-present', failure.message);
    if (tx) {
      tx.stage = 'deferred-writer-present';
      tx.failure = { message: failure.message, at: new Date().toISOString() };
      await atomicJson(journalPath, tx);
    }
  }
  catch (recordError) {
    const blocked = new Blocked(`Original program and data retained, but writer rejection could not be saved; inspect before retrying: ${recordError.message}`, { cause: failure });
    blocked.retainLock = true;
    blocked.recoveryRequired = true;
    throw blocked;
  }
  return update('blocked', { ...state, phase: 'blocked', detail: `Original program and data retained; candidate stopped automatic retries. ${failure.message}. No client was restarted to avoid competing data writes. After the writers end, reopen the client and use an explicit update retry.` });
}

/** Transaction setup has not touched program or data; retain partial evidence and stop this candidate. */
async function deferTransactionInitialization(config, state, failure, update, transaction) {
  try { await quarantineCandidate(config, state, 'transaction-initialization-failed', failure.message); }
  catch (recordError) {
    const blocked = new Blocked(`Original program and data retained, but transaction initialization rejection could not be saved; inspect before retrying: ${recordError.message}`, { cause: failure });
    blocked.retainLock = true;
    blocked.recoveryRequired = true;
    throw blocked;
  }
  return update('blocked', { ...state, phase: 'blocked', transaction, detail: `Original program and data retained; candidate stopped automatic retries because transaction initialization failed: ${failure.message}. Any partial transaction directory is retained. Inspect the helper storage, then reopen the client and use an explicit update retry.` });
}

async function installationMetadata(config, transaction, action) {
  return JSON.parse(await run(config.tools.powershell.executable, ['-NoProfile', '-NonInteractive', '-File',
    path.join(path.dirname(SELF), 'installation-metadata.ps1'), '-Action', action, '-ConfigPath', config.configPath,
    '-Destination', path.join(transaction, 'system-metadata')], { timeoutMs: 60_000 }));
}

export function snapshotInventoryDigest(manifest, historyOnly = false) {
  const files = manifest.entries.filter(item => item.kind === 'file' && (!historyOnly
    || /^sessions\/.+\/session(?:\.v[1-9]\d*)?\.jsonl(?:\.zstd)?$/.test(item.relative.replaceAll('\\', '/'))))
    .map(item => [item.relative.replaceAll('\\', '/'), item.sha256]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return digest(JSON.stringify(files));
}

async function prepareHistoryBaseline(config, request, tx) {
  const programDigest = snapshotInventoryDigest(tx.snapshots.installDir);
  const inventoryDigest = snapshotInventoryDigest(tx.snapshots.sharedDataDir, true);
  const cachePath = assertWithin(config.root, path.join(config.root, 'history-baselines', `${programDigest}-${inventoryDigest}.json`));
  const baselinePath = path.join(tx.transaction, 'history-baseline.json');
  let baseline;
  if (await exists(cachePath)) {
    baseline = await json(cachePath);
    if (baseline.schemaVersion !== 1 || baseline.programDigest !== programDigest || baseline.inventoryDigest !== inventoryDigest) throw new Blocked('Cached old-runtime history baseline does not match the complete program and raw session inventory');
  } else {
    const home = path.join(tx.transaction, 'baseline', 'shared');
    await fs.mkdir(home, { recursive: true });
    await fs.cp(path.join(tx.snapshots.sharedDataDir.destination, 'sessions'), path.join(home, 'sessions'), { recursive: true, dereference: true });
    await run(path.join(request.installDir, 'DeepSeek Harness.exe'), [path.join(path.dirname(SELF), 'baseline-history.cjs'),
      '--install', request.installDir, '--home', home, '--output', baselinePath],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: home }, timeoutMs: 600_000 });
    baseline = { ...await json(baselinePath), programDigest, inventoryDigest };
    if (baseline.schemaVersion !== 1 || !Array.isArray(baseline.sessions)) throw new Blocked('Old-runtime history baseline was not measured');
    await atomicJson(cachePath, baseline);
  }
  await atomicJson(baselinePath, baseline);
  return { path: baselinePath, version: baseline.version, readable: baseline.readable, preexistingUnreadable: baseline.preexistingUnreadable, programDigest, inventoryDigest };
}

async function health(config, executable, request, state, phase) {
  const token = randomUUID();
  const receiptPath = path.join(state.transaction, `${phase}-health.json`);
  const releasePath = path.join(state.transaction, `${phase}-release.json`);
  const healthRequestPath = path.join(state.transaction, `${phase}-request.json`);
  const launch = { schemaVersion: 1, token, phase, receiptPath, releasePath, homePath: state.isolatedSharedDataDir, userDataPath: state.isolatedUserDataDir, version: state.target.version, commit: state.target.commit, appId: 'com.deepseek.dsh', plugins: state.targetPlugins.map(item => ({ name: item.name, version: item.version })), disableSchedules: true, blockAdmissions: true };
  await atomicJson(healthRequestPath, launch);
  const childEnvironment = { ...process.env, DSH_HOME: state.isolatedSharedDataDir, DSH_SOURCE_UPDATE_DISABLE_SCHEDULES: '1', DSH_SOURCE_UPDATER_CONFIG: config.configPath };
  delete childEnvironment.ELECTRON_RUN_AS_NODE;
  const diagnosticPath = path.join(state.transaction, `${phase}-health.log`);
  const diagnostic = await fs.open(diagnosticPath, 'ax');
  let child;
  try {
    child = spawn(executable, [`--source-update-health=${healthRequestPath}`, `--user-data-dir=${state.isolatedUserDataDir}`], { detached: true, windowsHide: true, stdio: ['ignore', diagnostic.fd, diagnostic.fd], env: childEnvironment });
  } finally { await diagnostic.close(); }
  let launchError;
  child.once('error', error => { launchError = error; });
  const childOutcome = observeChildExit(child);
  child.unref();
  const deadline = Date.now() + (config.healthTimeoutMs ?? 120_000);
  while (!await exists(receiptPath)) {
    if (launchError) throw new Error(`${phase} health launch failed: ${launchError.message}. Log: ${diagnosticPath}`);
    if (!livePid(child.pid)) throw new Error(`${phase} health process exited before receipt. Log: ${diagnosticPath}`);
    if (Date.now() > deadline) { const error = new Blocked(`${phase} health deadline expired; PID ${child.pid} retained with admissions blocked`); error.retainLock = true; throw error; }
    await sleep(250);
  }
  try {
    const receipt = await json(receiptPath);
    const expectedToken = Buffer.from(token); const actualToken = Buffer.from(String(receipt.token));
    if (expectedToken.length !== actualToken.length || !timingSafeEqual(expectedToken, actualToken)) throw new Blocked('Health receipt token mismatch');
    if (receipt.version !== state.target.version || receipt.commit !== state.target.commit || receipt.appId !== 'com.deepseek.dsh' || !receipt.profileLoaded || !receipt.schedulesDisabled || receipt.pluginsLoaded !== true) throw new Error(`${phase} health receipt failed required checks`);
    for (const plugin of state.targetPlugins) if (!receipt.pluginVersions || receipt.pluginVersions[plugin.name] !== plugin.version) throw new Error(`Plugin health check failed: ${plugin.name}`);
    return receipt;
  } finally {
    await atomicJson(releasePath, { schemaVersion: 1, token, action: 'exit' });
    await requireSuccessfulChildExit(child, childOutcome, phase);
  }
}

export function observeChildExit(child) {
  return new Promise(resolve => {
    child.once('close', (code, signal) => resolve({ code, signal }));
    child.once('error', error => resolve({ error }));
  });
}

export async function requireSuccessfulChildExit(child, childOutcome, phase) {
  await waitForExit(child.pid, 30_000);
  const outcome = await Promise.race([childOutcome, sleep(1000).then(() => null)]);
  if (!outcome) { const error = new Blocked(`${phase} health child exit status is unknown; automatic restoration deferred`); error.retainLock = true; throw error; }
  if (outcome.error || outcome.code !== 0 || outcome.signal) throw new Error(`${phase} health child did not exit successfully: ${outcome.error?.message ?? outcome.signal ?? outcome.code}`);
}

export function parseDataProbe(output) {
  let result;
  try { result = JSON.parse(output); }
  catch { throw new Blocked('History and attachment probe did not return valid JSON; installation deferred'); }
  if (!result || result.schemaVersion !== 1 || result.baselineReadabilityPreserved !== true || result.attachmentsReadable !== true || !Number.isSafeInteger(result.sessionsRead) || result.sessionsRead < 0 || !Number.isSafeInteger(result.preexistingUnreadable) || result.preexistingUnreadable < 0 || result.historyReadable !== (result.preexistingUnreadable === 0) || !Array.isArray(result.preservedFailures) || result.preservedFailures.length !== result.preexistingUnreadable) throw new Blocked('History and attachment probe did not return complete successful readability evidence; installation deferred');
  return result;
}

export function validateAdmission(admission) {
  if (!admission || !Number.isFinite(admission.idleMs) || admission.idleMs < 60_000 || admission.draftsSaved !== true || admission.drained !== true || admission.activeTasks !== 0 || admission.pendingApprovals !== 0 || admission.queuedMessages !== 0 || admission.backgroundJobs !== 0) throw new Blocked('Native admission check is missing or unsafe');
}

/** A failed recovery journal must never turn an unresolved program/data transaction into an unlocked retry. */
export async function requireManualRecovery(transaction, journalPath, message, cause) {
  const failure = new Blocked(`${message}. ${cause.message}. Journal: ${journalPath}`);
  failure.retainLock = true;
  failure.recoveryRequired = true;
  failure.transaction = transaction.transaction;
  transaction.stage = 'recovery-required';
  transaction.recoveryFailure = { message: cause.message, at: new Date().toISOString() };
  try { await atomicJson(journalPath, transaction); }
  catch (journalError) {
    failure.journalFailure = journalError.message;
    failure.message += `; recovery journal could not be written: ${journalError.message}`;
  }
  return failure;
}

export async function stageCompatiblePlugins(plugins, home) {
  const profile = path.join(home, 'profiles', 'desktop');
  const manifestPath = path.join(profile, 'package.json');
  const manifest = await json(manifestPath);
  if (!manifest.dependencies) throw new Blocked('Isolated plugin profile or target compatibility manifest missing');
  selectedPluginNames(plugins);
  await assertPluginSelection(plugins, home);
  for (const plugin of plugins) {
    if (!/^@local\/[a-z0-9-]+$/.test(plugin.name) || await hashFile(plugin.archive) !== plugin.archiveSha256) throw new Blocked(`Compatible plugin archive changed: ${plugin.name}`);
    for (const [relative, sha256] of Object.entries(plugin.files)) if (await hashFile(assertWithin(plugin.path, path.join(plugin.path, relative))) !== sha256) throw new Blocked(`Compatible plugin bytes changed: ${plugin.name}/${relative}`);
    const destination = assertWithin(profile, path.join(profile, 'node_modules', plugin.name));
    // Only the disposable materialized profile is changed here.
    await fs.rm(destination, { recursive: true, force: true });
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.cp(plugin.path, destination, { recursive: true, dereference: true, errorOnExist: true, force: false });
    const archivePath = path.join(home, 'local-plugins', 'releases', path.basename(plugin.archive));
    await fs.mkdir(path.dirname(archivePath), { recursive: true }); await fs.copyFile(plugin.archive, archivePath);
    manifest.dependencies[plugin.name] = `file:${archivePath.replaceAll('\\', '/')}`;
  }
  await atomicJson(manifestPath, manifest);
}

async function atomicBytes(filename, bytes) {
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
  await fs.rename(temporary, filename);
}

/** Only the CLI-resolved configuration and its explicit helper-local trust record can be advanced. */
export async function snapshotUpdaterQualification(config, configPath, transaction) {
  if (!path.isAbsolute(configPath ?? '')) throw new Blocked('The actual CLI configuration path is required for qualification');
  const files = {};
  const input = [['config', configPath], ...(config.activePluginPins ? [['pins', config.activePluginPins]] : [])];
  for (const [name, filename] of input) {
    if (typeof filename !== 'string' || !path.isAbsolute(filename)) throw new Blocked('Qualification files must be absolute helper-local paths');
    try { assertWithin(config.root, filename); } catch { throw new Blocked('Qualification files must remain inside the configured helper root'); }
    if (Object.values(files).some(file => path.resolve(file.filename).toLowerCase() === path.resolve(filename).toLowerCase())) throw new Blocked('The configuration and trusted plugin pins must be distinct files');
    await assertUnlinkedAncestors(filename);
    if (!(await fs.stat(filename)).isFile()) throw new Blocked(`Qualification input is not a regular file: ${filename}`);
    const bytes = await fs.readFile(filename);
    if (name === 'config') {
      const parsed = JSON.parse(bytes.toString('utf8'));
      const { configPath: ignored, ...loaded } = config;
      if (JSON.stringify(parsed) !== JSON.stringify(loaded)) throw new Blocked('Updater configuration changed after the CLI loaded it; qualification deferred');
    }
    const backupPath = assertWithin(transaction, path.join(transaction, 'backup', 'updater-qualification', `${name}.json`));
    await assertUnlinkedAncestors(backupPath);
    await fs.mkdir(path.dirname(backupPath), { recursive: true });
    await fs.writeFile(backupPath, bytes, { flag: 'wx', mode: 0o600 });
    const sha256 = digest(bytes);
    if (await hashFile(backupPath) !== sha256 || await hashFile(filename) !== sha256) throw new Blocked(`Qualification input changed during snapshot: ${name}`);
    files[name] = { filename, backupPath, sha256 };
  }
  return { schemaVersion: 1, files };
}

export async function verifyUpdaterQualification(qualification) {
  for (const [name, file] of Object.entries(qualification.files)) {
    await assertUnlinkedAncestors(file.filename);
    if (await hashFile(file.backupPath) !== file.sha256 || await hashFile(file.filename) !== file.sha256) throw new Blocked(`Updater qualification ${name} changed since its transaction snapshot`);
  }
}

/** Trust the verified candidate hashes only after their exact bytes reached the promoted profile. */
export async function planUpdaterQualification(config, state, home, qualification) {
  await verifyUpdaterQualification(qualification);
  await assertCompatiblePlugins(config, state.targetPlugins, state.target);
  await assertPluginSelection(state.targetPlugins, home);
  for (const plugin of state.targetPlugins) {
    const directory = path.join(home, 'profiles', 'desktop', 'node_modules', plugin.name);
    for (const [relative, sha256] of Object.entries(plugin.files)) {
      await assertUnlinkedAncestors(assertWithin(directory, path.join(directory, relative)));
      if (await hashFile(path.join(directory, relative)) !== sha256) throw new Blocked(`Promoted plugin differs from its verified candidate: ${plugin.name}/${relative}`);
    }
  }
  const original = JSON.parse(await fs.readFile(qualification.files.config.backupPath, 'utf8'));
  const planned = { config: { value: { ...original, currentVersion: state.target.version } } };
  if (qualification.files.pins) planned.pins = { value: { schemaVersion: 1, qualifiedAt: new Date().toISOString(), target: state.target, source: 'verified-source-update', plugins: state.targetPlugins.map(plugin => ({ name: plugin.name, version: plugin.version, files: { ...plugin.files } })) } };
  for (const item of Object.values(planned)) item.sha256 = digest(`${JSON.stringify(item.value, null, 2)}\n`);
  return planned;
}

/** Journal both intended values before writing either helper file; incomplete writes remain recoverable. */
export async function commitUpdaterQualification(tx, journalPath, planned) {
  await verifyUpdaterQualification(tx.qualification);
  tx.qualification.planned = planned;
  tx.stage = 'committing-updater-qualification';
  await atomicJson(journalPath, tx);
  for (const name of ['pins', 'config']) {
    const file = tx.qualification.files[name];
    if (!file) continue;
    await assertUnlinkedAncestors(file.filename);
    if (await hashFile(file.filename) !== file.sha256) throw new Blocked(`Updater qualification ${name} changed before commit; external edits retained`);
    await atomicJson(file.filename, planned[name].value);
    if (await hashFile(file.filename) !== planned[name].sha256) throw new Blocked(`Updater qualification ${name} did not match its planned commit`);
    file.committedSha256 = planned[name].sha256;
    await atomicJson(journalPath, tx);
  }
}

/** Match helper state to the old program and data, preserving unrelated external edits. */
export async function restoreUpdaterQualification(qualification) {
  for (const [name, file] of Object.entries(qualification.files)) {
    await assertUnlinkedAncestors(file.filename);
    const actual = await hashFile(file.filename);
    if (actual !== file.sha256 && actual !== qualification.planned?.[name]?.sha256) throw new Blocked(`Updater qualification ${name} changed externally; automatic restoration deferred`);
    if (await hashFile(file.backupPath) !== file.sha256) throw new Blocked(`Updater qualification ${name} backup changed; automatic restoration deferred`);
  }
  for (const [name, file] of Object.entries(qualification.files)) {
    await assertUnlinkedAncestors(file.filename);
    const current = await hashFile(file.filename);
    if (current !== file.sha256 && current !== qualification.planned?.[name]?.sha256) throw new Blocked(`Updater qualification ${name} changed externally during restoration; automatic restoration deferred`);
    await atomicBytes(file.filename, await fs.readFile(file.backupPath));
    if (await hashFile(file.filename) !== file.sha256) throw new Blocked('Restored updater qualification did not match its original snapshot');
  }
}

export async function remapProfilePaths(home, from, to) {
  const profile = path.join(home, 'profiles', 'desktop');
  for (const relative of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'node_modules/.pnpm/lock.yaml']) {
    const filename = path.join(profile, relative);
    if (!await exists(filename)) continue;
    let content = await fs.readFile(filename, 'utf8');
    for (const [oldValue, newValue] of [[from, to], [from.replaceAll('\\', '/'), to.replaceAll('\\', '/')], [JSON.stringify(from).slice(1, -1), JSON.stringify(to).slice(1, -1)]]) content = content.replaceAll(oldValue, newValue);
    await fs.writeFile(filename, content);
  }
}

/** Restore pointers in untouched dependency trees; the transaction never writes their external targets. */
export async function restorePreservedDependencyLinks(manifest, destination) {
  const completed = [];
  for (const entry of manifest.entries.filter(item => item.preservedDependency || item.dangling).sort((a, b) => a.relative.length - b.relative.length)) {
    if (completed.some(parent => entry.relative.startsWith(`${parent}${path.sep}`))) continue;
    const filename = assertWithin(destination, path.join(destination, entry.relative));
    if (entry.dangling && await exists(entry.resolved)) throw new Blocked(`Dangling link target appeared during migration: ${entry.resolved}`);
    await fs.rm(filename, { recursive: true, force: true });
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.symlink(entry.link, filename, entry.directory && process.platform === 'win32' ? 'junction' : entry.directory ? 'dir' : 'file');
    completed.push(entry.relative);
  }
}

async function apply(config, request, update, runtime) {
  const state = await json(path.join(config.root, 'status.json'));
  if (state.phase !== 'ready') throw new Blocked('No matching verified source build is ready');
  await validateReadyState(config, request, state);
  await assertCandidateAllowed(config, state, request);
  validateAdmission(request.admission);
  if (!Number.isSafeInteger(request.appPid) || request.appPid < 1) throw new Blocked('Original application PID is required');
  for (const key of ['installDir', 'userDataDir', 'sharedDataDir']) if (!request[key]) throw new Blocked(`Apply requires ${key}`);
  const roots = await validateInstallationRoots(config, request);
  if (request.handoffReceipt || request.handoffToken) {
    if (typeof request.handoffToken !== 'string' || !/^[a-f0-9-]{36}$/.test(request.handoffToken)
      || typeof request.handoffReceipt !== 'string') throw new Blocked('Invalid native handoff receipt');
    const receipt = assertWithin(config.root, request.handoffReceipt);
    await atomicJson(receipt, { schemaVersion: 1, token: request.handoffToken, accepted: true, workerPid: process.pid });
  }
  await waitForExit(request.appPid);
  try { await assertNoWriters(config, request); }
  catch (error) {
    if (!(error instanceof ActiveDataWriters)) throw error;
    return deferActiveWriters(config, state, error, update);
  }
  const transaction = path.join(config.root, 'transactions', `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID()}`);
  const journalPath = path.join(transaction, 'transaction.json');
  const tx = { schemaVersion: 1, target: state.target, transaction, stage: 'snapshotting', snapshots: {}, request, previousReady: state };
  try {
    await fs.mkdir(transaction, { recursive: true });
    await atomicJson(journalPath, tx);
  } catch (error) { return deferTransactionInitialization(config, state, error, update, transaction); }
  let installationStarted = false;
  let installerSettled = false;
  try {
  // Plugins can change during native shutdown; recheck before copying or staging their profile.
  await validateReadyState(config, request, state);
  tx.qualification = await snapshotUpdaterQualification(config, runtime.configPath, transaction);
  await atomicJson(journalPath, tx);
  await update('backing-up', { ...state, phase: 'backing-up', transaction, detail: 'All detected application writers stopped; taking consistent full snapshots' });
  tx.installationMetadata = await installationMetadata(config, transaction, 'Snapshot');
  await atomicJson(journalPath, tx);
  for (const [name, source] of roots) {
    tx.snapshots[name] = await snapshotTree(source, path.join(transaction, 'backup', name), {
      opaqueAsarRoots: [request.installDir], preserveDependencyLinks: name === 'sharedDataDir',
      linkInspectorExecutable: config.tools.powershell.executable,
    });
    await atomicJson(path.join(transaction, `${name}.manifest.json`), tx.snapshots[name]);
    await atomicJson(journalPath, tx);
  }
  await assertNoWriters(config, request);
  await verifyUpdaterQualification(tx.qualification);
  for (const snapshot of Object.values(tx.snapshots)) await verifySnapshotSource(snapshot);
  tx.historyBaseline = await prepareHistoryBaseline(config, request, tx);
  await atomicJson(journalPath, tx);
  const isolated = path.join(transaction, 'migration');
  await fs.mkdir(isolated);
  const isolatedSharedDataDir = path.join(isolated, 'shared'); const isolatedUserDataDir = path.join(isolated, 'electron');
  await fs.cp(tx.snapshots.sharedDataDir.destination, isolatedSharedDataDir, { recursive: true, dereference: true });
  await fs.cp(tx.snapshots.userDataDir.destination, isolatedUserDataDir, { recursive: true, dereference: true });
  await remapProfilePaths(isolatedSharedDataDir, request.sharedDataDir, isolatedSharedDataDir);
  await stageCompatiblePlugins(state.targetPlugins, isolatedSharedDataDir);
  const healthState = { ...state, transaction, isolatedSharedDataDir, isolatedUserDataDir };
  tx.stage = 'isolated-validation'; await atomicJson(journalPath, tx);
  await update('validating', { ...state, phase: 'validating', transaction, detail: 'Validating isolated profile with schedules and admissions disabled' });
  tx.isolatedHealth = await health(config, state.unpackedApp, request, healthState, 'isolated');
  if (!config.dataProbe) throw new Blocked('A history and attachment parser probe is required before installation');
  tx.dataProbe = await run(config.tools.node.executable, [config.dataProbe, '--source', state.sourcePath ?? path.join(state.buildRoot, 'source'), '--home', isolatedSharedDataDir, '--baseline', tx.historyBaseline.path, '--config', config.configPath], { timeoutMs: 600_000, env: { ...process.env, DSH_HOME: isolatedSharedDataDir } });
  const dataResult = parseDataProbe(tx.dataProbe);
  await assertNoWriters(config, request);
  await verifyUpdaterQualification(tx.qualification);
  for (const snapshot of Object.values(tx.snapshots)) await verifySnapshotSource(snapshot);
  tx.stage = 'install-started'; await atomicJson(journalPath, tx);
    installationStarted = true;
    await update('installing', { ...state, phase: 'installing', transaction, detail: 'Installing the verified unsigned source build in place' });
    try { await run(state.artifactPath, ['/S', `/D=${request.installDir}`], { timeoutMs: 300_000 }); }
    catch (error) { installerSettled = error.processExited === true; throw error; }
    installerSettled = true;
    await installationMetadata(config, transaction, 'RestoreShortcuts');
    tx.stage = 'installed-validation'; await atomicJson(journalPath, tx);
    const installedExecutable = path.join(request.installDir, path.basename(state.unpackedApp));
    // Validate installed bytes against the isolated migrated data before any real data is opened.
    tx.installedHealth = await health(config, installedExecutable, request, healthState, 'installed');
    await assertNoWriters(config, request);
    tx.stage = 'promoting-data'; await atomicJson(journalPath, tx);
    await remapProfilePaths(isolatedSharedDataDir, isolatedSharedDataDir, request.sharedDataDir);
    // Migrations are deterministic snapshots; promote only after both new runtimes passed.
    tx.promoted = {};
    for (const [name, migrated] of [['sharedDataDir', isolatedSharedDataDir], ['userDataDir', isolatedUserDataDir]]) {
      const original = request[name];
      const displaced = `${original}.dsh-pre-update-${randomUUID()}`;
      await fs.rename(original, displaced);
      tx.promoted[name] = { original, displaced }; await atomicJson(journalPath, tx);
      await fs.cp(migrated, original, { recursive: true, dereference: true, force: false, errorOnExist: true });
      await restorePreservedDependencyLinks(tx.snapshots[name], original);
    }
    tx.finalHealth = await health(config, installedExecutable, request, { ...healthState, isolatedSharedDataDir: request.sharedDataDir, isolatedUserDataDir: request.userDataDir }, 'installed-final');
    await assertNoWriters(config, request);
    const nextQualification = await planUpdaterQualification(config, state, request.sharedDataDir, tx.qualification);
    await commitUpdaterQualification(tx, journalPath, nextQualification);
    tx.stage = 'completed'; tx.completedAt = new Date().toISOString(); await atomicJson(journalPath, tx);
    const normalEnvironment = { ...process.env }; delete normalEnvironment.ELECTRON_RUN_AS_NODE; delete normalEnvironment.DSH_SOURCE_UPDATE_DISABLE_SCHEDULES;
    const child = spawn(installedExecutable, [], { detached: true, windowsHide: false, stdio: 'ignore', env: normalEnvironment }); child.unref();
    return update('installed', { ...state, phase: 'installed', transaction, installedAt: tx.completedAt, detail: `Installed build and migrated state passed health checks; ${dataResult.sessionsRead} sessions readable, ${dataResult.preexistingUnreadable ?? 0} previously unreadable records retained unchanged` });
  } catch (error) {
    tx.failure = { message: error.message, at: new Date().toISOString() };
    if (!installationStarted && !error.retainLock) {
      if (error instanceof ActiveDataWriters) return deferActiveWriters(config, { ...state, transaction }, error, update, tx, journalPath);
      try {
        await quarantineCandidate(config, state, 'deferred-before-install', error.message);
        tx.stage = 'deferred-before-install'; await atomicJson(journalPath, tx);
      } catch (diagnosticError) { throw await requireManualRecovery(tx, journalPath, 'Candidate rejection could not be saved; automatic retry deferred', diagnosticError); }
      try { await assertNoWriters(config, request); }
      catch (writerError) {
        if (!(writerError instanceof ActiveDataWriters)) throw writerError;
        return deferActiveWriters(config, { ...state, transaction }, writerError, update, tx, journalPath);
      }
      const oldEnvironment = { ...process.env }; delete oldEnvironment.ELECTRON_RUN_AS_NODE; delete oldEnvironment.DSH_SOURCE_UPDATE_DISABLE_SCHEDULES;
      const child = spawn(path.join(request.installDir, path.basename(state.unpackedApp)), [], { detached: true, windowsHide: false, stdio: 'ignore', env: oldEnvironment }); child.unref();
      return update('blocked', { ...state, phase: 'blocked', transaction, detail: `Original installation and data retained; client restarted: ${error.message}` });
    }
    if (!installerSettled || error.retainLock) {
      throw await requireManualRecovery(tx, journalPath, 'Installation outcome uncertain; automatic restoration deferred', error);
    }
    try {
      await assertNoWriters(config, request);
      tx.stage = 'rolling-back'; await atomicJson(journalPath, tx);
      tx.restored = {};
      for (const [name] of roots) {
        tx.restored[name] = await restoreTree(tx.snapshots[name]);
        await atomicJson(journalPath, tx);
      }
      await installationMetadata(config, transaction, 'Restore');
      await restoreUpdaterQualification(tx.qualification);
      await quarantineCandidate(config, state, 'rolled-back', error.message);
      tx.stage = 'rolled-back'; await atomicJson(journalPath, tx);
    } catch (restoreError) {
      throw await requireManualRecovery(tx, journalPath, 'Matched rollback could not finish; retained transaction lock', restoreError);
    }
    const oldExecutable = path.join(request.installDir, path.basename(state.unpackedApp));
    const oldEnvironment = { ...process.env }; delete oldEnvironment.ELECTRON_RUN_AS_NODE; delete oldEnvironment.DSH_SOURCE_UPDATE_DISABLE_SCHEDULES;
    const child = spawn(oldExecutable, [], { detached: true, windowsHide: false, stdio: 'ignore', env: oldEnvironment }); child.unref();
    return update('rolled-back', { ...state, phase: 'rolled-back', transaction, detail: `Restored matched old program and data: ${error.message}` });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const [action, ...args] = argv;
  const argument = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  const configPath = argument('--config');
  if (!configPath || !path.isAbsolute(configPath)) throw new Error('--config must name an absolute local JSON file');
  const config = { ...await json(configPath), configPath };
  if (config.schemaVersion !== 1 || !config.root || !path.isAbsolute(config.root)) throw new Error('Unsupported worker configuration');
  const statusPath = path.join(config.root, 'status.json');
  if (action === 'status') {
    const readStatus = () => json(statusPath).catch(error => error.code === 'ENOENT' ? { schemaVersion: 1, phase: 'idle' } : Promise.reject(error));
    let state = await readStatus();
    const lock = await readWorkerLock(path.join(config.root, 'worker.lock'));
    if (lock.kind === 'absent') state = await readStatus();
    else {
      if (lock.kind === 'owned' && livePid(lock.owner.pid)) state = { ...state, phase: 'busy', activePhase: state.phase, detail: 'Another update worker is running; observing the shared task' };
      else if (state.phase !== 'recovery-required') state = { ...state, phase: 'blocked', detail: 'Interrupted worker lock requires local inspection before retry' };
    }
    process.stdout.write(`${JSON.stringify(state)}\n`); return state;
  }
  if (!['check', 'prepare', 'preflight', 'apply'].includes(action)) throw new Error('Expected check, prepare, preflight, apply, or status');
  const requestPath = argument('--request-path');
  const request = requestPath ? { ...await json(requestPath), requestPath } : JSON.parse(argument('--request') ?? '{}');
  if (action !== 'check' && request.schemaVersion !== 1) throw new Error('Unsupported request schema');
  if (action !== 'check') parseTarget(request.target);
  let release;
  try { release = await acquireLock(config.root); }
  catch (error) {
    if (!(error instanceof Blocked)) throw error;
    const previous = await json(statusPath).catch(() => ({ schemaVersion: 1 }));
    const busy = error instanceof WorkerLockBlocked && error.lockState === 'busy';
    const state = { ...previous, phase: busy ? 'busy' : 'blocked', activePhase: previous.phase, detail: error.message };
    process.stdout.write(`${JSON.stringify(state)}\n`);
    process.exitCode = busy ? 0 : 3;
    return state;
  }
  const update = async (phase, data) => {
    const state = { ...data, schemaVersion: 1, phase, updatedAt: new Date().toISOString() };
    await atomicJson(statusPath, state);
    return state;
  };
  let retainLock = false;
  try {
    let result;
    if (action === 'check') {
      const previous = await json(statusPath).catch(() => ({}));
      const currentVersion = request.currentVersion ?? (previous.phase === 'installed' ? previous.target.version : config.currentVersion);
      const target = await latestPublished(currentVersion);
      if (target && previous.target?.commit === target.commit && previous.artifactPath) {
        await assertPlugins(config);
        const fingerprint = await assertActivePlugins(config, config.sharedDataDir);
        const changedQualification = previous.activePluginFingerprint !== fingerprint
          || previous.patchSha256 !== await hashFile(config.compatibilityPatch);
        if (changedQualification && request.manualRetry === true) {
          result = await update('available', { currentVersion, target, detail: 'Explicitly qualified inputs changed; the previous candidate is retained and a fresh source build is required' });
        } else {
          await validateReadyState(config, { ...request, currentVersion, target }, previous);
          await assertCandidateAllowed(config, previous, request, true);
          result = await update('ready', previous);
        }
      } else {
        // Even a new release must not silently reintroduce a removed or unsupported plugin.
        if (target) {
          await assertPlugins(config);
          const activePluginFingerprint = await assertActivePlugins(config, config.sharedDataDir);
          await assertCandidateAllowed(config, { target, activePluginFingerprint, patchSha256: await hashFile(config.compatibilityPatch) }, request, true);
        }
        result = await update(target ? 'available' : 'current', { currentVersion, ...(target ? { target } : {}), detail: target ? 'A newer published source version is available' : 'No newer published version' });
      }
    } else if (action === 'preflight') {
      const state = await preflight(config, request, await json(statusPath));
      result = await update('ready', { ...state, preflightAt: new Date().toISOString(), detail: 'Ready target, installer and current plugins passed read-only preflight' });
    } else result = await (action === 'prepare' ? prepare(config, request, update) : apply(config, request, update, { configPath }));
    process.stdout.write(`${JSON.stringify(result)}\n`); return result;
  } catch (error) {
    retainLock = error.retainLock === true;
    const previous = await json(statusPath).catch(() => ({}));
    const phase = error.recoveryRequired ? 'recovery-required' : action === 'check' && error instanceof ReleaseCheckUnavailable ? 'check-unavailable' : error instanceof Blocked ? 'blocked' : 'failed';
    const failureState = { ...previous, ...(request.target ? { target: request.target } : {}), detail: error.message, ...(error.transaction ? { transaction: error.transaction } : {}), ...(error.journalFailure ? { journalFailure: error.journalFailure } : {}) };
    let state;
    try { state = await update(phase, failureState); }
    catch (statusError) {
      // retainLock was set before either persistent diagnostic write, including disk-full failures.
      if (!retainLock) throw statusError;
      state = { ...failureState, schemaVersion: 1, phase, statusWriteFailure: statusError.message };
      process.stderr.write(`Recovery state could not be saved; transaction lock retained: ${statusError.message}\n`);
    }
    process.stdout.write(`${JSON.stringify(state)}\n`);
    process.exitCode = error instanceof Blocked ? 3 : 1;
    return state;
  } finally { if (!retainLock) await release(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SELF)) {
  // The application may close during a background build. Durable status remains authoritative after its pipe closes.
  process.stdout.on('error', error => { if (error.code !== 'EPIPE') throw error; });
  main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
}
