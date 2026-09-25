# NestJS Excel import and export sandbox

A small teaching project for two flows:

- **Import:** preview validation → review create/update counts → commit the same XLSX with a validation token → revalidate and upsert in one PostgreSQL transaction.
- **Export:** create a job ID → open its download immediately → watch row progress while ExcelJS streams XLSX bytes directly to the HTTP response. Redis stores status only; no export file is saved.

## Process diagrams

### Import

![Excel import workflow](docs/diagrams/import-workflow.svg)

[Open the interactive import diagram](docs/diagrams/import-workflow.html) · [Diagram source](docs/diagrams/import-workflow.json)

### Export

![Excel export workflow](docs/diagrams/export-workflow.svg)

[Open the interactive export diagram](docs/diagrams/export-workflow.html) · [Diagram source](docs/diagrams/export-workflow.json)

The HTML diagrams support search, focus, theme switching, and export. The SVG files are static previews with a solid light background, so they stay readable in light and dark Markdown themes.

## Start the sandbox

Requirements: Node 22.12+ and Docker Compose. Run these commands from this project directory:

```sh
docker compose up -d --wait
npm ci
npm run build
npm start
```

Open [the sandbox UI](http://localhost:3000/api/ui). The default ports are API `3000`, PostgreSQL `5433`, and Redis `6380`. Override them with `PORT`, `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_DB`, and `IMPORT_TOKEN_SECRET`.

`sql/schema.sql` initializes PostgreSQL only when its Docker volume is empty. To clear imported and seeded items while keeping reference codes:

```sh
docker compose exec -T postgres psql -U sandbox -d sandbox \
  -c 'TRUNCATE TABLE items RESTART IDENTITY;'
```

## How import works

1. `POST /api/imports/validate` uploads an XLSX into a bounded memory buffer. The parser checks its ten template columns, row values, duplicate `ItemCode` values **within the workbook**, and database reference codes. It counts valid rows as `createRows` or `updateRows` by looking up current `ItemCode` values. A fully valid file receives a signed `validationToken` containing a checksum of those bytes.
2. The UI displays errors and the create/update preview. It keeps the selected file and token until Commit. Changing the file or demo user clears the preview.
3. `POST /api/imports/commit` uploads the **same file bytes and token**. The server checks the token signature, expiry, demo user, and buffer checksum. It then parses the buffer again and revalidates against the current database inside a transaction. If anything fails, it writes no rows.
4. PostgreSQL inserts new `ItemCode` values and updates existing ones with `ON CONFLICT (item_code) DO UPDATE`. Updates replace all supplied item columns while preserving the item ID and `created_at`.

There is no `import_sessions` table or upload directory. `@UseInterceptors(XlsxUpload)` still parses the multipart form and populates `@UploadedFile()`. Its Multer `memoryStorage()` puts the XLSX bytes in `file.buffer` and enforces the 10 MB file limit; it does not write to disk. The server retains neither upload between Validate and Commit. The browser sends the selected file again at Commit. Tokens expire after 24 hours. Set a stable `IMPORT_TOKEN_SECRET` if tokens must survive an API restart or work across multiple API processes; otherwise the sandbox generates a random secret at startup. The `x-demo-user` header is a teaching placeholder, **not authentication**.

### Test import in the UI

For predictable counts, clear `items` with the command above, then use the UI:

| File and action | Expected result |
| --- | --- |
| Validate `examples/sample.xlsx` | Valid; **1 create, 0 update**. |
| Commit that file | `1 row created or updated`. |
| Validate `examples/upsert-demo.xlsx` | Valid; **1 create, 1 update**. It updates `SAMPLE-001` and creates `SAMPLE-NEW-001`. |
| Commit, then validate `upsert-demo.xlsx` again | Valid; **0 create, 2 update**. |
| Validate `examples/invalid-cases.xlsx` | **21 row errors**; no token and Commit stays disabled. The second worksheet labels each case. |
| Validate `examples/valid-5000.xlsx` after a reset | Valid; **5,000 create, 0 update**. |

Regenerate the larger example workbooks with `npm run examples:generate`. `examples/invalid.xlsx` is a one-row invalid example.

### Test import with curl

```sh
curl -o template.xlsx http://localhost:3000/api/imports/template
curl -F file=@examples/sample.xlsx http://localhost:3000/api/imports/validate
```

Copy `validationToken` from a response with `isValid: true`, then send it with the same file:

```sh
curl -X POST -F file=@examples/sample.xlsx -F validationToken=TOKEN \
  http://localhost:3000/api/imports/commit
```

Commit without a token, with a changed file, or with a different `x-demo-user` value is rejected. Commit validates again because reference codes and other item data may change after the preview. The preview counts describe the database **at validation time**; Commit returns `importedRows` as the total processed, not an insert/update breakdown.

## How export works

1. `POST /api/exports` creates a Redis status record and returns a `jobId` with `PENDING` status. It does not start work yet.
2. Open `GET /api/exports/:id/download` **immediately**. That request starts the export and stays open while the API reads PostgreSQL items in **1,000-row keyset pages**. ExcelJS writes each XLSX row to the HTTP response. No XLSX file or whole-workbook buffer is kept on the server.
3. After each page, the API records `processedRows` in Redis. While the download is open, the UI polls `GET /api/exports/:id` and shows status and rows processed. The count is **not a percentage**.
4. The stream ends when the workbook is complete. The writer starts another worksheet at Excel's row limit. Status records expire after 24 hours. A job ID permits **one download attempt**; create another job to export again.

There is no `exportDir`, export worker, or server-side XLSX file. The `jobId` is a handle for progress, not a pointer to a saved workbook. The download endpoint sets the XLSX content type and attachment filename, then returns the binary stream to the client. The states mean:

| Status | Meaning |
| --- | --- |
| `PENDING` | Job ID exists; no download has started. |
| `ACTIVE` | The download request is open and rows are being written. |
| `COMPLETED` | The XLSX response finished successfully. |
| `FAILED` | Generation or the download stream failed; create a new job to retry. |

The download request must remain connected. Disconnecting cancels the export; a server restart also interrupts it. For durable background exports or resumable downloads, a saved file in object storage is necessary. The backoffice has direct buffer-return exports as well as queued exports that save a file; this sandbox demonstrates direct response streaming so large server-side buffers are avoided.

### Test export progress and download

The small import examples may export too quickly to see progress. Seed 100,000 items:

```sh
docker compose exec -T postgres psql -U sandbox -d sandbox < sql/seed-large.sql
```

For a longer run and a second Excel worksheet, seed **1,100,000 items** instead:

```sh
docker compose exec -T postgres psql -U sandbox -d sandbox < sql/seed-very-large.sql
docker compose exec -T postgres psql -U sandbox -d sandbox \
  -c 'SELECT count(*) FROM items;'
```

Both scripts use the same `DEMO-` item codes and skip existing rows, so running them again will not add duplicates. The larger run needs more database space and time. Click **Export and download** in the UI to watch `processedRows` rise while the browser receives the file. The UI uses `response.blob()`, so for very large downloads prefer `curl`, which writes bytes to the client disk as they arrive.

The same flow through the API, in two terminals:

```sh
# Terminal A: create the job, copy jobId, then begin the download immediately.
curl -X POST http://localhost:3000/api/exports
curl -f -o items.xlsx http://localhost:3000/api/exports/JOB_ID/download
```

```sh
# Terminal B: poll while Terminal A is still downloading.
curl http://localhost:3000/api/exports/JOB_ID
```

Use the returned `jobId` in both URLs. Do not wait for `COMPLETED` before opening the download: the download request performs the work. The `x-demo-user` header, if supplied, must use the same value for create, status, and download.

## Where to read the code

| File | Responsibility |
| --- | --- |
| `src/imports.controller.ts` | Template, Validate, and Commit HTTP routes; bounded in-memory uploads. |
| `src/imports.service.ts` | Database-backed validation, create/update preview, token check, transaction, upsert. |
| `src/import-core.ts` and `src/import-token.ts` | Workbook parsing and row rules; signed file receipt. |
| `src/exports.controller.ts` | Start, status, and download HTTP routes. |
| `src/exports.service.ts` | Redis job status, one-shot download, and progress updates. |
| `src/export-workbook.ts` | Paged PostgreSQL reads and ExcelJS streaming to the HTTP response. |
| `public/index.html` | UI for both flows. |
| `sql/schema.sql` | Sandbox tables and reference codes. |

## Checks and limits

```sh
npm run format:check
npm test
npm run build
```

Import limits are 10 MB uploaded XLSX, 30 MB expanded workbook, and 10,000 data rows. The XLSX bytes and parsed rows are held in memory only during each request. For imports beyond that size, use a proven streaming reader and batch staging. The example reference codes are company `1`, distributor `D01`, supplier `S01`, UOMs `EA` and `BOX`, and tax `VAT`.

This sandbox omits the backoffice's Keycloak permissions, audit fields, distributor scoping, and full item relations. Add those controls before adapting the flow to production. Redis is used only for status; PostgreSQL could hold these small records if Redis is unavailable. See the [ExcelJS streaming writer documentation](https://github.com/exceljs/exceljs#streaming-xlsx).
