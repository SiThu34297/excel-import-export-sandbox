import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from '../src/db';
import { ImportsService } from '../src/imports.service';

test('larger example workbooks have the expected valid and invalid rows', async () => {
  const references = [
    ['company', '1'],
    ['distributor', 'D01'],
    ['supplier', 'S01'],
    ['uom', 'EA'],
    ['uom', 'BOX'],
    ['tax', 'VAT'],
  ].map(([kind, code]) => ({ kind, code }));
  const db = {
    pool: {
      query: async (sql: string) => ({
        rows: sql.includes("SELECT 'company'") ? references : [],
      }),
    },
  } as unknown as Db;
  const service = new ImportsService(db);
  const valid = await service.validateUpload(
    await readFile(join(process.cwd(), 'examples/valid-5000.xlsx')),
    'demo',
  );
  assert.equal(valid.totalRows, 5000);
  assert.equal(valid.validRows, 5000);
  assert.equal(valid.isValid, true);
  assert.equal(valid.createRows, 5000);
  assert.equal(valid.updateRows, 0);
  assert.ok(valid.validationToken);

  const invalid = await service.validateUpload(
    await readFile(join(process.cwd(), 'examples/invalid-cases.xlsx')),
    'demo',
  );
  assert.equal(invalid.totalRows, 22);
  assert.equal(invalid.rowErrors.length, 21);
  assert.deepEqual(
    invalid.rowErrors.map((error) => error.rowNumber),
    Array.from({ length: 21 }, (_, index) => index + 3),
  );
  assert.equal(invalid.isValid, false);
  assert.equal(invalid.validationToken, null);
});
