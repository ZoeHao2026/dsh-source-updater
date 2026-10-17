/** Read isolated session history through the selected source build's real persistence backend. */
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { hashFile } from './upgrade-worker.mjs';
import { loadHistoryBaseline, matchPreexistingHistoryFailure } from './baseline-compatibility.mjs';

const args = process.argv.slice(2);
const value = flag => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
const source = path.resolve(value('--source') ?? '.');
const home = value('--home');
const baseline = value('--baseline') ? await loadHistoryBaseline(value('--baseline')) : undefined;
if (!home || !path.isAbsolute(home)) throw new Error('--home must name an absolute isolated Harness home');
if (path.resolve(process.env.DSH_HOME ?? '') !== path.resolve(home)) throw new Error('DSH_HOME must match the isolated --home path');
const packageDirectory = path.join(source, 'packages', 'session', 'session-persistence-jsonl');
const require = createRequire(path.join(packageDirectory, 'package.json'));
const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href);
const persistence = await import(pathToFileURL(path.join(packageDirectory, 'lib', 'index.js')).href);
const attachmentModule = await import(pathToFileURL(path.join(source, 'packages/attachment/attachment-local/lib/index.js')).href);
const seen = new Set(); const canonicalDirectories = new Set(); const encodings = new Set(); const references = new Map();
const preservedFailures = [];
let events = 0; let attachmentFiles = 0; let attachmentBytes = 0;
async function inventorySessions(directory) {
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Isolated session tree contains a live link: ${filename}`);
    if (entry.isDirectory()) await inventorySessions(filename);
    else if (/^session(?:\.v[1-9]\d*)?\.jsonl(?:\.zstd)?$/.test(entry.name)) { canonicalDirectories.add(directory); encodings.add(entry.name.endsWith('.zstd') ? 'zstd' : 'none'); }
  }
}
await inventorySessions(path.join(home, 'sessions'));
if (encodings.size > 1) throw new Error('Shared session root contains mixed physical encodings; migration cannot proceed safely');
function collectReferences(value) {
  if (!value || typeof value !== 'object') return;
  if (/^sha256:[a-f0-9]{64}$/.test(value.attachmentId ?? '') && Number.isSafeInteger(value.bytes)) {
    const kind = typeof value.mediaType === 'string' && Number.isSafeInteger(value.width) && Number.isSafeInteger(value.height) ? 'image' : 'file';
    references.set(`${kind}:${value.attachmentId}:${value.name ?? ''}`, { kind, ref: { ...value } });
  }
  for (const child of Object.values(value)) if (child && typeof child === 'object') collectReferences(child);
}
for (const compression of [encodings.values().next().value ?? 'zstd']) {
  const ctx = new Context();
  try {
    await ctx.plugin(persistence, { root: path.join(home, 'sessions'), compression, listConcurrency: 1 });
    for (const listed of await ctx.sessionPersistence.list()) {
      const id = listed.header.id;
      if (baseline && !baseline.has(id)) throw new Error(`Candidate returned a session outside the pinned baseline: ${id}`);
      let handle;
      try {
        handle = await ctx.sessionPersistence.open(id, 'read');
        const read = await handle.read();
        const key = `${id}:${compression}`;
        if (!seen.has(key)) { seen.add(key); events += read.events.length; collectReferences(read.events); }
      } catch (error) {
        preservedFailures.push(await matchPreexistingHistoryFailure(baseline, id, error, home));
        seen.add(`${id}:${compression}`);
      } finally { await handle?.close(); }
    }
  } finally { await ctx.fiber.dispose(); }
}
if (seen.size !== canonicalDirectories.size) throw new Error(`Target parser did not read every stored session: ${seen.size}/${canonicalDirectories.size}; a header may have been skipped`);
if (baseline && baseline.size !== canonicalDirectories.size) throw new Error('Pinned baseline and physical candidate session inventories differ');
const attachmentContext = new Context();
try {
  const store = new attachmentModule.LocalAttachmentStore(attachmentContext, { dshHome: home });
  for (const { kind, ref } of references.values()) {
    if (kind === 'image') await store.readImage(ref);
    else for await (const _chunk of store.readFileStream(ref)) { /* The target provider verifies the complete stream. */ }
  }
} finally { await attachmentContext.fiber.dispose(); }

async function visit(directory) {
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Isolated attachment tree contains a live link: ${filename}`);
    if (entry.isDirectory()) await visit(filename);
    else if (entry.isFile()) {
      const stat = await fs.stat(filename);
      const sha256 = await hashFile(filename);
      const parts = path.relative(path.join(home, 'attachments'), filename).split(path.sep);
      const contentHash = [...parts].reverse().find(part => /^[a-f0-9]{64}$/.test(part));
      // Request-image cache names can hash their transform request, so only durable objects are digest-addressed.
      if (contentHash && !parts.includes('request-images') && sha256 !== contentHash) throw new Error(`Attachment digest mismatch: ${filename}`);
      attachmentFiles++; attachmentBytes += stat.size;
    } else throw new Error(`Unsupported isolated attachment entry: ${filename}`);
  }
}
await visit(path.join(home, 'attachments'));
process.stdout.write(`${JSON.stringify({ schemaVersion: 1, historyReadable: preservedFailures.length === 0, baselineReadabilityPreserved: true, sessionsRead: seen.size - preservedFailures.length, preexistingUnreadable: preservedFailures.length, preservedFailures, eventsRead: events, attachmentsReadable: true, attachmentReferencesRead: references.size, attachmentFiles, attachmentBytes })}\n`);
