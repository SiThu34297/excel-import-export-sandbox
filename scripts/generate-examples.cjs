const ExcelJS = require('exceljs');
const { join } = require('node:path');

const headers = [
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
];

function item(number, prefix) {
  return {
    CompanyCode: 1,
    DistributorCode: 'D01',
    ItemCode: `${prefix}-${String(number).padStart(5, '0')}`,
    ItemName: `Example item ${number}`,
    SupplierCode: 'S01',
    Category: number % 2 ? 'General' : 'Seasonal',
    BaseUOM: 'EA',
    SellingUOM: 'BOX',
    SellingUOMConversion: 12,
    TaxCode: 'VAT',
  };
}

async function save(name, rows, cases = []) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Item Bulk Import');
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(headers.map((header) => row[header]));
  if (cases.length) {
    const guide = workbook.addWorksheet('Invalid cases');
    guide.addRow(['Excel row', 'Expected issue']);
    for (const [index, label] of cases.entries())
      guide.addRow([index + 3, label]);
  }
  await workbook.xlsx.writeFile(join(__dirname, '..', 'examples', name));
}

async function main() {
  await save(
    'valid-5000.xlsx',
    Array.from({ length: 5000 }, (_, index) => item(index + 1, 'VALID')),
  );
  await save('upsert-demo.xlsx', [
    {
      ...item(1, 'SAMPLE'),
      ItemCode: 'SAMPLE-001',
      ItemName: 'Updated sample item',
      SellingUOMConversion: 24,
    },
    { ...item(2, 'SAMPLE'), ItemCode: 'SAMPLE-NEW-001' },
  ]);

  const cases = [
    ['Missing CompanyCode', { CompanyCode: '' }],
    ['CompanyCode must be positive', { CompanyCode: 0 }],
    ['CompanyCode must be numeric', { CompanyCode: 'ABC' }],
    ['Unknown CompanyCode', { CompanyCode: 999 }],
    ['Missing DistributorCode', { DistributorCode: '' }],
    ['Unknown DistributorCode', { DistributorCode: 'D99' }],
    ['Missing ItemCode', { ItemCode: '' }],
    ['Duplicate ItemCode', { ItemCode: 'INVALID-00001' }],
    ['Missing ItemName', { ItemName: '' }],
    ['ItemName over 200 characters', { ItemName: 'X'.repeat(201) }],
    [
      'Formula in ItemName is rejected',
      { ItemName: { formula: '1+1', result: 2 } },
    ],
    ['Missing SupplierCode', { SupplierCode: '' }],
    ['Unknown SupplierCode', { SupplierCode: 'S99' }],
    ['Missing Category', { Category: '' }],
    ['Unknown BaseUOM', { BaseUOM: 'INVALID' }],
    ['Unknown SellingUOM', { SellingUOM: 'INVALID' }],
    ['Zero conversion', { SellingUOMConversion: 0 }],
    ['Negative conversion', { SellingUOMConversion: -2 }],
    ['More than six decimal places', { SellingUOMConversion: 1.1234567 }],
    ['Unknown TaxCode', { TaxCode: 'BAD' }],
    ['Missing TaxCode', { TaxCode: '' }],
  ];
  const rows = [item(1, 'INVALID')];
  for (const [index, [, change]] of cases.entries())
    rows.push({ ...item(index + 2, 'INVALID'), ...change });
  await save('invalid-cases.xlsx', rows, cases);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
