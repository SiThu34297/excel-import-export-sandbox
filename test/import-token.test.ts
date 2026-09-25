import assert from 'node:assert/strict';
import { test } from 'node:test';
import { issueImportToken, verifyImportToken } from '../src/import-token';

test('validation token binds file checksum, owner, and expiry', () => {
  const digest = 'a'.repeat(64);
  const token = issueImportToken(digest, 'alice', 1_000);
  assert.equal(verifyImportToken(token, 'alice', 1_001), digest);
  assert.equal(verifyImportToken(token, 'bob', 1_001), null);
  assert.equal(verifyImportToken(token + 'x', 'alice', 1_001), null);
  assert.equal(
    verifyImportToken(token, 'alice', 1_000 + 24 * 60 * 60 * 1000),
    null,
  );
});
