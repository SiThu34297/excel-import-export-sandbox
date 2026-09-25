import ExcelJS from 'exceljs';
import unzipper from 'unzipper';

export const HEADERS = [
  'CompanyCode',
  'DistributorCode',
  'ItemCode',
  'ItemName',
  'SupplierCode',
  'Category',
  'BaseUOM',
  'SellingUOM',
  'SellingUOMConversion',
  'TaxCode',
] as const;

export type ItemRow = {
  rowNumber: number;
  CompanyCode: string;
  DistributorCode: string;
  ItemCode: string;
  ItemName: string;
  SupplierCode: string;
  Category: string;
  BaseUOM: string;
  SellingUOM: string;
  SellingUOMConversion: string;
  TaxCode: string;
};
export type RowError = {
  rowNumber: number;
  itemCode: string;
  errors: string[];
};
export type Validation = {
  isValid: boolean;
  totalRows: number;
  validRows: number;
  errors: string[];
  rowErrors: RowError[];
};

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number')
    return String(value).trim();
  // Formulas, rich text, dates, and hyperlinks are not accepted as input values.
  return '';
}

export async function readWorkbook(
  buffer: Buffer,
): Promise<{ rows: ItemRow[]; errors: string[] }> {
  const rows: ItemRow[] = [];
  const errors: string[] = [];
  // ponytail: capped in-memory import; move staging into a streaming parser when files exceed 10k rows.
  const zip = await unzipper.Open.buffer(buffer);
  if (
    zip.files.length > 100 ||
    zip.files.some((file) => !Number.isFinite(file.uncompressedSize)) ||
    zip.files.reduce((sum, file) => sum + file.uncompressedSize, 0) >
      30 * 1024 * 1024
  )
    throw new Error('Uncompressed workbook is too large');
  const workbook = new ExcelJS.Workbook();
  // ExcelJS's type declares ArrayBuffer, but its runtime accepts Node buffers.
  await workbook.xlsx.load(
    buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  const sheet = workbook.worksheets[0];
  if (!sheet) errors.push('Workbook has no worksheet');
  else {
    const header = sheet.getRow(1);
    const names = (header.values as ExcelJS.CellValue[]).slice(1).map(cellText);
    const columns = new Map(names.map((name, index) => [name, index + 1]));
    const missing = HEADERS.filter((name) => !columns.has(name));
    if (missing.length)
      errors.push(`Missing required columns: ${missing.join(', ')}`);
    if (columns.size !== names.filter(Boolean).length)
      errors.push('Duplicate or blank headers');
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const values = HEADERS.map((name) =>
        columns.has(name)
          ? cellText(row.getCell(columns.get(name)!).value)
          : '',
      );
      if (values.every((v) => v === '')) return;
      if (rows.length >= 10_000)
        throw new Error('Import is limited to 10,000 rows');
      rows.push(
        Object.fromEntries([
          ['rowNumber', rowNumber],
          ...HEADERS.map((name, index) => [name, values[index]]),
        ]) as ItemRow,
      );
    });
  }
  if (!rows.length) errors.push('Workbook has no item rows');
  return { rows, errors };
}

export function validateLocal(
  rows: ItemRow[],
  errors: string[] = [],
): Validation {
  const rowErrors: RowError[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const problems: string[] = [];
    for (const header of HEADERS) {
      if (!row[header]) problems.push(`${header} is required`);
      if (row[header].length > 200)
        problems.push(`${header} exceeds 200 characters`);
    }
    if (
      !/^[1-9]\d*$/.test(row.CompanyCode) ||
      Number(row.CompanyCode) > 2_147_483_647
    )
      problems.push('CompanyCode must be a positive whole number');
    const conversion = Number(row.SellingUOMConversion);
    if (
      !/^\d+(\.\d{1,6})?$/.test(row.SellingUOMConversion) ||
      !Number.isFinite(conversion) ||
      conversion <= 0 ||
      conversion > 999_999_999_999
    )
      problems.push(
        'SellingUOMConversion must be positive with at most 6 decimal places',
      );
    if (row.ItemCode) {
      if (seen.has(row.ItemCode))
        problems.push('Duplicate ItemCode in workbook');
      seen.add(row.ItemCode);
    }
    if (problems.length)
      rowErrors.push({
        rowNumber: row.rowNumber,
        itemCode: row.ItemCode,
        errors: problems,
      });
  }
  return {
    isValid: errors.length === 0 && rowErrors.length === 0,
    totalRows: rows.length,
    validRows: rows.length - rowErrors.length,
    errors,
    rowErrors,
  };
}
