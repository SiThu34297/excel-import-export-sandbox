INSERT INTO items (
  company_code, distributor_code, item_code, item_name, supplier_code,
  category, base_uom, selling_uom, conversion, tax_code
)
SELECT 1, 'D01', 'DEMO-' || n, 'Demo item ' || n, 'S01',
       'General', 'EA', 'BOX', 12, 'VAT'
FROM generate_series(1, 100000) AS n
ON CONFLICT (item_code) DO NOTHING;
