import ExcelJS from 'exceljs';
import type { Writable } from 'node:stream';
import { Db } from './db';

type ExportRow = {
  id: string;
  item_code: string;
  item_name: string;
  distributor_code: string;
  supplier_code: string;
  category: string;
  base_uom: string;
  selling_uom: string;
  conversion: string;
  tax_code: string;
};

const headers = [
  'ID',
  'ItemCode',
  'ItemName',
  'DistributorCode',
  'SupplierCode',
  'Category',
  'BaseUOM',
  'SellingUOM',
  'Conversion',
  'TaxCode',
];

function safeText(value: string): string {
  // Prevent spreadsheet apps from treating database text as a formula.
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export async function writeItemsWorkbook(
  db: Db,
  output: Writable,
  onProgress: (processedRows: number) => Promise<void>,
): Promise<number> {
  // Freeze the last ID so new rows do not make this export run forever.
  const highWater = await db.pool.query<{ max: string | null }>(
    'SELECT max(id)::text AS max FROM items',
  );
  const maxId = highWater.rows[0]?.max ?? '0';
  const writer = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: output,
    useStyles: false,
    useSharedStrings: false,
  });
  let sheet = writer.addWorksheet('Items 1');
  sheet.addRow(headers).commit();
  let cursor = '0';
  let processed = 0;
  let sheetNumber = 1;
  while (true) {
    if (output.destroyed) throw new Error('Download was cancelled');
    const page = await db.pool.query<ExportRow>(
      `SELECT id::text, item_code, item_name, distributor_code, supplier_code,
              category, base_uom, selling_uom, conversion::text, tax_code
       FROM items WHERE items.id > $1 AND items.id <= $2 ORDER BY items.id LIMIT 1000`,
      [cursor, maxId],
    );
    if (!page.rows.length) break;
    for (const row of page.rows) {
      if (processed > 0 && processed % 1_048_575 === 0) {
        sheet.commit();
        sheet = writer.addWorksheet(`Items ${++sheetNumber}`);
        sheet.addRow(headers).commit();
      }
      sheet
        .addRow([
          row.id,
          safeText(row.item_code),
          safeText(row.item_name),
          safeText(row.distributor_code),
          safeText(row.supplier_code),
          safeText(row.category),
          safeText(row.base_uom),
          safeText(row.selling_uom),
          Number(row.conversion),
          safeText(row.tax_code),
        ])
        .commit();
      processed++;
    }
    cursor = page.rows[page.rows.length - 1].id;
    await onProgress(processed);
  }
  sheet.commit();
  await writer.commit();
  return processed;
}
