import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { HEADERS, readWorkbook, validateLocal } from '../src/import-core';

test('reader keeps row numbers and validation rejects duplicate and invalid rows', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'excel-sandbox-'));
  try {
    const path = join(dir, 'input.xlsx');
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Items');
    sheet.addRow([...HEADERS]);
    sheet.addRow([
      1,
      'D01',
      'A',
      'Alpha',
      'S01',
      'General',
      'EA',
      'BOX',
      12,
      'VAT',
    ]);
    sheet.addRow([
      1,
      'D01',
      'A',
      'Again',
      'S01',
      'General',
      'EA',
      'BOX',
      0,
      'VAT',
    ]);
    await book.xlsx.writeFile(path);
    const parsed = await readWorkbook(path);
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.rows.length, 2);
    assert.equal(parsed.rows[1].rowNumber, 3);
    const validation = validateLocal(parsed.rows, parsed.errors);
    assert.equal(validation.isValid, false);
    assert.equal(validation.validRows, 1);
    assert.match(
      validation.rowErrors[0].errors.join(' '),
      /Duplicate ItemCode/,
    );
    assert.match(validation.rowErrors[0].errors.join(' '), /Conversion/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('missing header is reported', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'excel-sandbox-'));
  try {
    const path = join(dir, 'input.xlsx');
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Items');
    sheet.addRow(HEADERS.filter((h) => h !== 'TaxCode'));
    sheet.addRow([1, 'D01', 'B', 'Beta', 'S01', 'General', 'EA', 'BOX', 12]);
    await book.xlsx.writeFile(path);
    const parsed = await readWorkbook(path);
    assert.match(parsed.errors.join(' '), /TaxCode/);
    assert.equal(validateLocal(parsed.rows, parsed.errors).isValid, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
