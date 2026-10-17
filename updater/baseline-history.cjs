/** Measure old runtime readability on an isolated, unscheduled copy before a source update. */
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { createRequire } = require('node:module');

(async () => {
  const args = process.argv.slice(2);
  const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  const install = option('--install'); const home = option('--home'); const output = option('--output');
  if (![install, home, output].every(value => value && path.isAbsolute(value))) throw new Error('Absolute isolated baseline paths are required');
  if (path.resolve(home).toLowerCase() === path.resolve(path.join(process.env.USERPROFILE, '.dsh')).toLowerCase()) throw new Error('Baseline must never open the live Harness home');
  const root = path.join(home, 'sessions');
  const inventory = new Map();
  const encodings = new Set();
  const hash = async filename => { const digest = createHash('sha256'); for await (const chunk of createReadStream(filename)) digest.update(chunk); return digest.digest('hex'); };
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Baseline copy contains a link');
      if (entry.isDirectory()) await visit(filename);
      else if (/^session(?:\.v[1-9]\d*)?\.jsonl(?:\.zstd)?$/.test(entry.name)) {
        encodings.add(entry.name.endsWith('.zstd') ? 'zstd' : 'none');
        const id = path.basename(directory);
        const row = inventory.get(id) ?? { directory, files: [] };
        if (row.directory !== directory) throw new Error(`Duplicate baseline session directory: ${id}`);
        row.files.push({ relative: path.relative(home, filename), sha256: await hash(filename) });
        inventory.set(id, row);
      }
    }
  }
  await visit(root);
  if (encodings.size > 1) throw new Error('Mixed baseline physical encodings are not supported');
  const runtimeRequire = createRequire(path.join(install, 'resources', 'app.asar', 'dsh', 'package.json'));
  const { Context } = runtimeRequire('@deepseek-ai/cordis');
  const persistence = runtimeRequire('@deepseek-ai/dsh-session-persistence-jsonl');
  const version = runtimeRequire(path.join(install, 'resources', 'app.asar', 'package.json')).version;
  const ctx = new Context(); const sessions = [];
  try {
    await ctx.plugin(persistence.default ?? persistence, { root, compression: encodings.values().next().value ?? 'zstd', listConcurrency: 1 });
    for (const listed of await ctx.sessionPersistence.list()) {
      const id = listed.header.id;
      const physical = inventory.get(id);
      if (!physical) throw new Error(`Baseline reader returned an unknown session: ${id}`);
      let handle;
      try {
        handle = await ctx.sessionPersistence.open(id, 'read');
        const read = await handle.read();
        sessions.push({ id, readable: true, events: read.events.length });
      } catch (error) {
        sessions.push({ id, readable: false, errorName: error.name, reason: String(error.message).replaceAll(home, '<isolated>'), sourceFiles: physical.files });
      } finally { await handle?.close(); }
    }
  } finally { await ctx.fiber.dispose(); }
  if (sessions.length !== inventory.size || new Set(sessions.map(item => item.id)).size !== inventory.size) throw new Error(`Baseline reader skipped physical sessions: ${sessions.length}/${inventory.size}`);
  const result = { schemaVersion: 1, version, sessions, readable: sessions.filter(item => item.readable).length, preexistingUnreadable: sessions.filter(item => !item.readable).length };
  await fs.writeFile(output, JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ schemaVersion: 1, version, sessions: sessions.length, readable: result.readable, preexistingUnreadable: result.preexistingUnreadable, output }));
})().catch(error => { console.error(error); process.exitCode = 1; });
