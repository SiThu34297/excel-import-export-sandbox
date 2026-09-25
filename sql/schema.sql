CREATE TABLE companies (code INTEGER PRIMARY KEY);
CREATE TABLE distributors (code TEXT PRIMARY KEY);
CREATE TABLE suppliers (code TEXT PRIMARY KEY);
CREATE TABLE uoms (code TEXT PRIMARY KEY);
CREATE TABLE tax_codes (code TEXT PRIMARY KEY);

INSERT INTO companies VALUES (1);
INSERT INTO distributors VALUES ('D01');
INSERT INTO suppliers VALUES ('S01');
INSERT INTO uoms VALUES ('EA'), ('BOX');
INSERT INTO tax_codes VALUES ('VAT');

CREATE TABLE items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_code INTEGER NOT NULL REFERENCES companies(code),
  distributor_code TEXT NOT NULL REFERENCES distributors(code),
  item_code TEXT NOT NULL UNIQUE,
  item_name TEXT NOT NULL,
  supplier_code TEXT NOT NULL REFERENCES suppliers(code),
  category TEXT NOT NULL,
  base_uom TEXT NOT NULL REFERENCES uoms(code),
  selling_uom TEXT NOT NULL REFERENCES uoms(code),
  conversion NUMERIC(18, 6) NOT NULL CHECK (conversion > 0),
  tax_code TEXT NOT NULL REFERENCES tax_codes(code),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
