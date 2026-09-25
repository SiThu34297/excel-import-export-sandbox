import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { Db } from './db';
import {
  ItemRow,
  readWorkbook,
  RowError,
  validateLocal,
  Validation,
} from './import-core';
import { issueImportToken, verifyImportToken } from './import-token';

type ImportValidation = Validation & { createRows: number; updateRows: number };

@Injectable()
export class ImportsService {
  constructor(private readonly db: Db) {}

  private async validate(
    rows: ItemRow[],
    errors: string[] = [],
    client?: PoolClient,
  ): Promise<ImportValidation> {
    const result: ImportValidation = {
      ...validateLocal(rows, errors),
      createRows: 0,
      updateRows: 0,
    };
    if (!rows.length) return result;
    const query = client ?? this.db.pool;
    const codes = [...new Set(rows.map((row) => row.ItemCode).filter(Boolean))];
    const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
    const [existingResult, refsResult] = await Promise.all([
      query.query<{ item_code: string }>(
        'SELECT item_code FROM items WHERE item_code = ANY($1)',
        [codes],
      ),
      query.query<{ kind: string; code: string }>(
        `
        SELECT 'company' AS kind, code::text FROM companies WHERE code = ANY($1::integer[])
        UNION ALL SELECT 'distributor', code FROM distributors WHERE code = ANY($2::text[])
        UNION ALL SELECT 'supplier', code FROM suppliers WHERE code = ANY($3::text[])
        UNION ALL SELECT 'uom', code FROM uoms WHERE code = ANY($4::text[])
        UNION ALL SELECT 'tax', code FROM tax_codes WHERE code = ANY($5::text[])`,
        [
          [
            ...new Set(
              rows
                .map((row) => row.CompanyCode)
                .filter(
                  (code) =>
                    /^[1-9]\d*$/.test(code) && Number(code) <= 2_147_483_647,
                )
                .map(Number),
            ),
          ],
          unique(rows.map((row) => row.DistributorCode)),
          unique(rows.map((row) => row.SupplierCode)),
          unique(rows.flatMap((row) => [row.BaseUOM, row.SellingUOM])),
          unique(rows.map((row) => row.TaxCode)),
        ],
      ),
    ]);
    const existing = new Set(existingResult.rows.map((row) => row.item_code));
    const refs = new Set(
      refsResult.rows.map((row) => `${row.kind}:${row.code}`),
    );
    const byNumber = new Map(
      result.rowErrors.map((entry) => [entry.rowNumber, entry]),
    );
    for (const row of rows) {
      const problems: string[] = [];
      if (row.CompanyCode && !refs.has(`company:${Number(row.CompanyCode)}`))
        problems.push('CompanyCode does not exist');
      for (const [field, kind] of [
        ['DistributorCode', 'distributor'],
        ['SupplierCode', 'supplier'],
        ['BaseUOM', 'uom'],
        ['SellingUOM', 'uom'],
        ['TaxCode', 'tax'],
      ] as const) {
        if (row[field] && !refs.has(`${kind}:${row[field]}`))
          problems.push(`${field} does not exist`);
      }
      if (problems.length) {
        const entry: RowError = byNumber.get(row.rowNumber) ?? {
          rowNumber: row.rowNumber,
          itemCode: row.ItemCode,
          errors: [],
        };
        entry.errors.push(...problems);
        byNumber.set(row.rowNumber, entry);
      }
    }
    result.rowErrors = [...byNumber.values()].sort(
      (a, b) => a.rowNumber - b.rowNumber,
    );
    result.validRows = rows.length - result.rowErrors.length;
    result.isValid =
      result.errors.length === 0 && result.rowErrors.length === 0;
    for (const row of rows) {
      if (byNumber.has(row.rowNumber)) continue;
      if (existing.has(row.ItemCode)) result.updateRows++;
      else result.createRows++;
    }
    return result;
  }

  private async parse(buffer: Buffer) {
    try {
      return await readWorkbook(buffer);
    } catch {
      throw new BadRequestException(
        'Unreadable XLSX file or import exceeds 10,000 rows',
      );
    }
  }

  private digest(buffer: Buffer) {
    return createHash('sha256').update(buffer).digest('hex');
  }

  async validateUpload(buffer: Buffer, owner: string) {
    const parsed = await this.parse(buffer);
    const validation = await this.validate(parsed.rows, parsed.errors);
    return {
      ...validation,
      validationToken: validation.isValid
        ? issueImportToken(this.digest(buffer), owner)
        : null,
    };
  }

  async commit(buffer: Buffer, token: string, owner: string) {
    const expectedDigest = verifyImportToken(token, owner);
    if (!expectedDigest)
      throw new BadRequestException('Invalid or expired validation token');
    if (this.digest(buffer) !== expectedDigest)
      throw new ConflictException('Workbook differs from the validated file');
    const parsed = await this.parse(buffer);
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'");
      const validation = await this.validate(
        parsed.rows,
        parsed.errors,
        client,
      );
      if (!validation.isValid)
        throw new ConflictException({
          message: 'Import validation failed; nothing was committed',
          ...validation,
        });
      await client.query(
        `
        INSERT INTO items (company_code, distributor_code, item_code, item_name, supplier_code,
                           category, base_uom, selling_uom, conversion, tax_code)
        SELECT r."CompanyCode"::integer, r."DistributorCode", r."ItemCode", r."ItemName",
               r."SupplierCode", r."Category", r."BaseUOM", r."SellingUOM",
               r."SellingUOMConversion"::numeric, r."TaxCode"
        FROM jsonb_to_recordset($1::jsonb) AS r(
          "CompanyCode" text, "DistributorCode" text, "ItemCode" text, "ItemName" text,
          "SupplierCode" text, "Category" text, "BaseUOM" text, "SellingUOM" text,
          "SellingUOMConversion" text, "TaxCode" text
        )
        WHERE true
        ON CONFLICT (item_code) DO UPDATE SET
          company_code = EXCLUDED.company_code,
          distributor_code = EXCLUDED.distributor_code,
          item_name = EXCLUDED.item_name,
          supplier_code = EXCLUDED.supplier_code,
          category = EXCLUDED.category,
          base_uom = EXCLUDED.base_uom,
          selling_uom = EXCLUDED.selling_uom,
          conversion = EXCLUDED.conversion,
          tax_code = EXCLUDED.tax_code`,
        [JSON.stringify(parsed.rows)],
      );
      await client.query('COMMIT');
      return { importedRows: parsed.rows.length };
    } catch (error) {
      await client.query('ROLLBACK');
      if (['23505', '23503'].includes((error as { code?: string }).code ?? ''))
        throw new ConflictException(
          'Item or reference changed during commit; nothing was committed',
        );
      throw error;
    } finally {
      client.release();
    }
  }
}
