import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Db } from '../src/db';
import { ImportsService } from '../src/imports.service';

test('commit requires a matching validation token and revalidates before upserting', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'excel-import-check-'));
  const file = join(dir, 'sample.xlsx');
  const statements: string[] = [];
  const existingCodes = new Set<string>();
  let referencesAvailable = true;
  const query = async (sql: string) => {
    statements.push(sql);
    if (sql.includes('FROM items WHERE item_code'))
      return {
        rows: [...existingCodes].map((item_code) => ({ item_code })),
      };
    if (sql.includes("SELECT 'company'"))
      return {
        rows: referencesAvailable
          ? [
              { kind: 'company', code: '1' },
              { kind: 'distributor', code: 'D01' },
              { kind: 'supplier', code: 'S01' },
              { kind: 'uom', code: 'EA' },
              { kind: 'uom', code: 'BOX' },
              { kind: 'tax', code: 'VAT' },
            ]
          : [],
      };
    return { rows: [] };
  };
  const db = {
    pool: { query, connect: async () => ({ query, release() {} }) },
  } as unknown as Db;
  try {
    await copyFile(join(process.cwd(), 'examples/sample.xlsx'), file);
    const service = new ImportsService(db);
    const result = await service.validateUpload(file, 'alice');
    assert.equal(result.isValid, true);
    assert.ok(result.validationToken);
    assert.equal(result.createRows, 1);
    assert.equal(result.updateRows, 0);
    existingCodes.add('SAMPLE-001');
    const updatePreview = await service.validateUpload(file, 'alice');
    assert.equal(updatePreview.createRows, 0);
    assert.equal(updatePreview.updateRows, 1);
    const mixedPreview = await service.validateUpload(
      join(process.cwd(), 'examples/upsert-demo.xlsx'),
      'alice',
    );
    assert.equal(mixedPreview.createRows, 1);
    assert.equal(mixedPreview.updateRows, 1);
    await assert.rejects(service.commit(file, '', 'alice'));
    await assert.rejects(service.commit(file, result.validationToken, 'bob'));
    await writeFile(file, 'changed');
    await assert.rejects(service.commit(file, result.validationToken, 'alice'));
    assert.equal(
      statements.some((sql) => sql.includes('INSERT INTO items')),
      false,
    );
    await copyFile(join(process.cwd(), 'examples/sample.xlsx'), file);
    referencesAvailable = false;
    await assert.rejects(service.commit(file, result.validationToken, 'alice'));
    assert.ok(statements.includes('ROLLBACK'));
    assert.equal(
      statements.some((sql) => sql.includes('INSERT INTO items')),
      false,
    );
    referencesAvailable = true;
    assert.deepEqual(
      await service.commit(file, result.validationToken, 'alice'),
      {
        importedRows: result.totalRows,
      },
    );
    assert.ok(statements.includes('BEGIN'));
    assert.ok(
      statements.some((sql) =>
        sql.includes('ON CONFLICT (item_code) DO UPDATE'),
      ),
    );
    assert.ok(statements.includes('COMMIT'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
