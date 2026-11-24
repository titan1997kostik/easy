import test from 'node:test';
import assert from 'node:assert/strict';
import { convertBackup } from '../scripts/backup-to-ndjson.mjs';

test('converts records and strips credential-like fields recursively', () => {
  const backup = {
    version: 2,
    data: {
      sales_data: { sale_1: { id: 'sale_1', amount: 1200, updatedAt: 1700000000000 } },
      users_data: { user_1: { id: 'user_1', username: 'demo', password: 'dummy-only', role: 'seller' } },
      admins: [{ username: 'demo-admin', nested: { apiKey: 'dummy-only' } }],
    },
  };

  const result = convertBackup(backup);
  assert.equal(result.stats.collections, 3);
  assert.equal(result.stats.records, 3);
  assert.equal(result.stats.redactedRecords, 2);
  assert.doesNotMatch(result.ndjson, /dummy-only|"password"|"apiKey"/);
  assert.match(result.ndjson, /password_reset_required/);
});

test('rejects an invalid backup shape', () => {
  assert.throws(() => convertBackup({ version: 2 }), /объектом верхнего уровня/);
});
