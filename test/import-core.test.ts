import assert from 'node:assert/strict';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import { HEADERS, readWorkbook, validateLocal } from '../src/import-core';

test('reader keeps row numbers and validation rejects duplicate and invalid rows', async () => {
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
  const parsed = await readWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[1].rowNumber, 3);
  const validation = validateLocal(parsed.rows, parsed.errors);
  assert.equal(validation.isValid, false);
  assert.equal(validation.validRows, 1);
  assert.match(validation.rowErrors[0].errors.join(' '), /Duplicate ItemCode/);
  assert.match(validation.rowErrors[0].errors.join(' '), /Conversion/);
});

test('missing header is reported', async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Items');
  sheet.addRow(HEADERS.filter((h) => h !== 'TaxCode'));
  sheet.addRow([1, 'D01', 'B', 'Beta', 'S01', 'General', 'EA', 'BOX', 12]);
  const parsed = await readWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
  assert.match(parsed.errors.join(' '), /TaxCode/);
  assert.equal(validateLocal(parsed.rows, parsed.errors).isValid, false);
});
