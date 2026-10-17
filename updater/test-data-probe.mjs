/** Integration checks use the actual target persistence implementation; no user profiles are read. */
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const source = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../deepseek-harness'));
const packageDirectory = path.join(source, 'packages/session/session-persistence-jsonl');
const require = createRequire(path.join(packageDirectory, 'package.json'));
const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href);
const persistence = await import(pathToFileURL(path.join(packageDirectory, 'lib/index.js')).href);
const { SESSION_FORMAT_VERSION } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session')).href);
const attachmentDirectory = path.join(source, 'packages/attachment/attachment-local');
const { LocalAttachmentStore } = await import(pathToFileURL(path.join(attachmentDirectory, 'lib/index.js')).href);
const attachmentRequire = createRequire(path.join(attachmentDirectory, 'package.json'));
const sharp = attachmentRequire('sharp');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-data-probe-test-'));
const probe = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data-probe.mjs');
const outcomes = [];
try {
  for (const compression of ['none', 'zstd']) {
    const home = path.join(root, compression); await fs.mkdir(home);
    const bytes = Buffer.from('durable attachment bytes'); const digest = createHash('sha256').update(bytes).digest('hex');
    const ctx = new Context();
    try {
      const store = new LocalAttachmentStore(ctx, { dshHome: home });
      const fileRef = await store.saveFile({ data: bytes, name: 'note.txt' });
      const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ee2211' } }).png().toBuffer();
      const imageRef = await store.saveImage({ data: png, mediaType: 'image/png', name: 'image.png' });
      await ctx.plugin(persistence, { root: path.join(home, 'sessions'), compression, listConcurrency: 1 });
      const handle = await ctx.sessionPersistence.create({ version: SESSION_FORMAT_VERSION, id: 'probe-session', createdAt: 1000, isSeeded: false });
      try { await handle.append([{ type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
        { type: 'user/message', seq: 1, time: 2, surfaceOp: 'append', data: { id: 'human', role: 'user', source: { kind: 'user' }, content: [{ type: 'image', attachment: imageRef }, { type: 'file', attachment: fileRef }] } },
        { type: 'turn/end', seq: 2, time: 3, data: { turn: 1, reason: { kind: 'completed' } } }]); }
      finally { await handle.close(); }
    } finally { await ctx.fiber.dispose(); }
    const attachment = path.join(home, 'attachments', 'v1', 'file-objects', digest.slice(0, 2), digest);
    const run = () => JSON.parse(execFileSync(process.execPath, [probe, '--source', source, '--home', home], { env: { ...process.env, DSH_HOME: home }, encoding: 'utf8', windowsHide: true }));
    const result = run(); assert.equal(result.sessionsRead, 1); assert.equal(result.eventsRead, 3); assert.equal(result.attachmentFiles, 3); assert.equal(result.attachmentReferencesRead, 2);
    outcomes.push({ compression, scenario: 'read-history-and-referenced-named-image-and-file', pass: true });
    await fs.chmod(attachment, 0o600);
    await fs.writeFile(attachment, 'corrupt attachment');
    assert.throws(run, /integrity verification|Attachment digest mismatch/); outcomes.push({ compression, scenario: 'reject-corrupt-referenced-attachment', pass: true });
    await fs.writeFile(attachment, bytes);
    const projectDirectories = await fs.readdir(path.join(home, 'sessions'));
    const project = projectDirectories[0];
    await fs.mkdir(path.join(home, 'sessions', project, 'broken-session'));
    const raw = Buffer.from('{"type":"session","version":999,"id":"unreadable"}\n');
    const { zstdCompressSync } = await import('node:zlib');
    await fs.writeFile(path.join(home, 'sessions', project, 'broken-session', `session.v999.jsonl${compression === 'zstd' ? '.zstd' : ''}`), compression === 'zstd' ? zstdCompressSync(raw) : raw);
    assert.throws(run, /did not read every stored session/); outcomes.push({ compression, scenario: 'reject-skipped-unreadable-history', pass: true });
  }
  process.stdout.write(`${JSON.stringify({ passed: outcomes.length, outcomes }, null, 2)}\n`);
} finally { await fs.rm(root, { recursive: true, force: true }); }
