-- Optional export stress test: 1,100,000 rows, enough to create two worksheets.
-- Uses the same DEMO codes as seed-large.sql, so running both is safe.
INSERT INTO items (
  company_code, distributor_code, item_code, item_name, supplier_code,
  category, base_uom, selling_uom, conversion, tax_code
)
SELECT 1, 'D01', 'DEMO-' || n, 'Demo item ' || n, 'S01',
       'General', 'EA', 'BOX', 12, 'VAT'
FROM generate_series(1, 1100000) AS n
ON CONFLICT (item_code) DO NOTHING;
