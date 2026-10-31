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

`CREATE SCHEMA IF NOT EXISTS`, then by mode, then `COPY … TO
'<published>/<schema>.<table>.parquet' (FORMAT parquet)`:

- `replace`: `CREATE OR REPLACE TABLE … AS SELECT <columns> FROM <reader>`.
- `append`: the table is created, empty, with a `_ingestron_file` column; then
  each file's rows are inserted unless its name is already there.
- `upsert`: the table is created with the contract's columns and primary key;
  then `INSERT OR REPLACE`, keeping a key's last row by `sequence_by` when set.
- A transform's table: `CREATE OR REPLACE TABLE … AS SELECT <contract columns>
FROM (<code>) AS "source"`.

Each column is `CAST(<file column> AS <type>) AS <name>`. The file column is the
`physicalName` when the ingest did not rename; the type is the resolved one when
the standard lists `duckdb@` first, else from the `logicalType` (`string`
`VARCHAR`, `integer` `BIGINT`, `number` `DOUBLE`, `boolean` `BOOLEAN`, `date`
`DATE`, `timestamp` `TIMESTAMP`, `time` `TIME`). Readers: `read_parquet`,
`read_csv` (with `header` and `delim`) and `read_json_auto`. Names are in double
quotes with `"` doubled; text in single quotes with `'` doubled.

## Checks

A method check problem when `upsert` has no primary key, or a table's files have
no recorded location; when a transform's SQL names a table not in `inputs`.

## Contracts

Columns, types, physical names and primary keys are used; quality,
relationships and tags are not used yet; the other facts are documentation.
