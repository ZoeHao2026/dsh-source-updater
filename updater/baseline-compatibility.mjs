import * as fs from 'node:fs/promises';
import path from 'node:path';
import { assertWithin, hashFile } from './upgrade-worker.mjs';

export async function loadHistoryBaseline(filename) {
  const value = JSON.parse(await fs.readFile(filename, 'utf8'));
  if (value.schemaVersion !== 1 || typeof value.version !== 'string' || !Array.isArray(value.sessions)) throw new Error('Invalid history readability baseline');
  const sessions = new Map();
  for (const item of value.sessions) {
    if (typeof item.id !== 'string' || !item.id || typeof item.readable !== 'boolean' || sessions.has(item.id)) throw new Error('Invalid baseline session identity');
    if (!item.readable && (typeof item.errorName !== 'string' || typeof item.reason !== 'string' || !Array.isArray(item.sourceFiles) || !item.sourceFiles.length)) throw new Error('Unreadable baseline lacks exact failure and byte evidence');
    for (const file of item.sourceFiles ?? []) if (typeof file.relative !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Invalid baseline source digest');
    sessions.set(item.id, item);
  }
  return sessions;
}

/** Only byte-identical, already-unreadable records with the exact same error may remain unreadable. */
export async function matchPreexistingHistoryFailure(baseline, id, error, home) {
  const previous = baseline?.get(id);
  if (!previous || previous.readable) throw error;
  const reason = String(error.message).replaceAll(home, '<isolated>');
  if (error.name !== previous.errorName || reason !== previous.reason) throw new Error(`History failure changed for ${id}; baseline readability was not preserved: ${reason}`);
  for (const file of previous.sourceFiles) {
    if (await hashFile(assertWithin(home, path.join(home, file.relative))) !== file.sha256) throw new Error(`Previously unreadable raw history changed: ${id}/${file.relative}`);
  }
  return { id, reason };
}
