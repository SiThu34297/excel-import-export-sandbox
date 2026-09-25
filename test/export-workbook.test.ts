import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import type { Db } from '../src/db';
import { writeItemsWorkbook } from '../src/export-workbook';

test('streams PostgreSQL rows as XLSX bytes and reports progress', async () => {
  const item = {
    id: '1',
    item_code: '=SUM(1,1)',
    item_name: 'Sample',
    distributor_code: 'D01',
    supplier_code: 'S01',
    category: 'General',
    base_uom: 'EA',
    selling_uom: 'BOX',
    conversion: '12',
    tax_code: 'VAT',
  };
  const db = {
    pool: {
      query: async (sql: string, params?: string[]) =>
        sql.includes('SELECT max(id)')
          ? { rows: [{ max: '1' }] }
          : { rows: params?.[0] === '0' ? [item] : [] },
    },
  } as unknown as Db;
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (chunk: Buffer) => chunks.push(chunk));
  const progress: number[] = [];

  const count = await writeItemsWorkbook(db, output, async (rows) => {
    progress.push(rows);
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.concat(chunks));
  const sheet = workbook.getWorksheet('Items 1');

  assert.equal(count, 1);
  assert.deepEqual(progress, [1]);
  assert.equal(sheet?.getRow(2).getCell(2).value, "'=SUM(1,1)");
  assert.equal(sheet?.getRow(2).getCell(9).value, 12);
});
