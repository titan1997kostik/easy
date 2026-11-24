#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const SENSITIVE_KEY = /(password|passwd|secret|token|api[_-]?key|authorization|private[_-]?key|credential)/i;
const USER_COLLECTIONS = new Set(['users_data', 'admins']);

function sanitize(value, state) {
  if (Array.isArray(value)) return value.map((item) => sanitize(item, state));
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) {
      state.redacted = true;
      continue;
    }
    result[key] = sanitize(child, state);
  }
  return result;
}

function recordsForCollection(value) {
  if (Array.isArray(value)) return value.map((payload, index) => [String(index), payload]);
  if (value && typeof value === 'object') return Object.entries(value);
  return [['__root__', value]];
}

function findUpdatedAt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  for (const key of ['updatedAt', 'updated_at', 'timestamp', 'createdAt']) {
    const candidate = Number(value[key]);
    if (Number.isFinite(candidate) && candidate >= 0) return Math.trunc(candidate);
  }
  return null;
}

export function convertBackup(backup) {
  if (!backup || typeof backup !== 'object' || !backup.data || typeof backup.data !== 'object') {
    throw new Error('Ожидается экспорт Firebase с объектом верхнего уровня "data".');
  }
  const lines = [];
  const stats = { collections: 0, records: 0, redactedRecords: 0 };
  for (const [collection, value] of Object.entries(backup.data)) {
    stats.collections += 1;
    for (const [recordId, originalPayload] of recordsForCollection(value)) {
      const state = { redacted: false };
      const payload = sanitize(originalPayload, state);
      if (state.redacted) stats.redactedRecords += 1;
      const userRecord = USER_COLLECTIONS.has(collection);
      if (userRecord && payload && typeof payload === 'object' && !Array.isArray(payload)) {
        payload._passwordResetRequired = true;
      }
      lines.push(JSON.stringify({
        collection,
        record_id: recordId,
        payload,
        source_updated_at: findUpdatedAt(originalPayload),
        ...(userRecord ? { security: { password_reset_required: true } } : {}),
      }));
      stats.records += 1;
    }
  }
  return { ndjson: lines.length ? `${lines.join('\n')}\n` : '', stats };
}

function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error('Использование: node backup-to-ndjson.mjs <firebase-export.json> <output.ndjson>');
    process.exitCode = 2;
    return;
  }
  const destination = path.resolve(output);
  const backup = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
  const { ndjson, stats } = convertBackup(backup);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, ndjson, { mode: 0o600 });
  console.log(JSON.stringify({ output: destination, ...stats }, null, 2));
  console.warn('Пароли и секреты не переносятся. Пользователям потребуется безопасный сброс пароля.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main();
