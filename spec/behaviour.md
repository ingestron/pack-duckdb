# DuckDB

## Methods

- `duckdb-files` (ingest; connector `files`): output `<path>/<object>`, the
  connection's `path` and the table's object as written (a file or a pattern),
  in the `format` set (`parquet` by default, `csv`, `json`), loads `add`.
- `duckdb-landed` (ingest; `reads: landed`): output
  `<landing>/<object>/*.parquet`, loads `add`. The core chooses it in an
  environment that runs on DuckDB.
- `duckdb-table` (store; accepts `files`, `query`): keeps the table as
  `"<schema>"."<table>"` in the database the SQL runs in, and publishes it to
  `<published>/<schema>.<table>.parquet` (its output, loads `replace`).
- `duckdb-sql` (transform): the transform's SQL; each `{{ tables.<input> }}`
  becomes `"<schema>"."<table>"`; a trailing `;` is dropped.

## Files

`run.sql` is a header comment, then each table's SQL in the model's order;
`tables/<schema>.<table>.sql` holds each table's SQL alone; `README.md` says
how to run it. A model with no `duckdb-table` table gets no files. The SQL
differs between environments only in the paths their values give.

## Each table

`CREATE SCHEMA IF NOT EXISTS`, then by mode, then `COPY (SELECT <contract
columns> FROM …) TO '<published>/<schema>.<table>.parquet' (FORMAT parquet)`:

- `replace`: `CREATE OR REPLACE TABLE … AS SELECT <columns> FROM <reader>`.
- `append`: the table is created, empty, with a `_ingestron_file` column (the
  reader's `filename` option names it, so a file's own `filename` column is
  kept apart); then each file's rows are inserted `BY NAME` unless its name is
  already there.
- `upsert`: the table is created with the contract's columns and primary key;
  then `INSERT OR REPLACE … BY NAME`, keeping a key's last row by `sequence_by`
  when set, then by file name.
- In both, each contract column is added when missing (`ALTER TABLE … ADD
COLUMN IF NOT EXISTS`), so a contract that gains columns keeps loading.
- A transform's table: `CREATE OR REPLACE TABLE … AS SELECT <contract columns>
FROM (<code>) AS "source"`, the code on its own lines.

Each column is `CAST(<file column> AS <type>) AS <name>`. The file column is the
`physicalName` when the ingest did not rename; the type is the resolved one when
the standard lists `duckdb@` first, else from the `logicalType` (`string`
`VARCHAR`, `integer` `BIGINT`, `number` `DOUBLE`, `boolean` `BOOLEAN`, `date`
`DATE`, `timestamp` `TIMESTAMP`, `time` `TIME`). Readers: `read_parquet`,
`read_csv` (with `header` and `delim`) and `read_json_auto`. Names are in double
quotes with `"` doubled; text in single quotes with `'` doubled.

## Checks

A method check problem when `upsert` has no primary key, a table's files have
no recorded location, a flow writes expectations (DuckDB tables check no rows
yet), a `files` connection has no `path`, or a transform's SQL names a table
not in `inputs`.

## Contracts

Columns, types, physical names and primary keys are used; quality,
relationships and tags are not used yet; the other facts are documentation.

## Running in Azure

`request` returns a section titled `DuckDB job` when any `duckdb-table` table
reads or publishes `abfss://` or `az://` paths, and nothing otherwise. It names
the job with the public image `ghcr.io/ingestron/duckdb-runner:1` and
`INGESTRON_SQL`, the storage roots (`abfss://<file system>@<account host>`) the
job reads and writes, and something that starts it after each load.

The runner (`runner/`) runs `INGESTRON_SQL` in a fresh database at
`/tmp/ingestron.duckdb`, signed in with the job's managed identity
(`AZURE_CLIENT_ID` for a user-assigned one). It refuses a `run.sql` that reads
or writes local paths unless `INGESTRON_ALLOW_LOCAL=1`. Exit codes: 0 built,
1 failed or local paths, 2 no `INGESTRON_SQL`.
