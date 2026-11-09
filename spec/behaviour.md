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

`run.sql` is a header comment, then `BEGIN TRANSACTION;`, each table's build
statements in the model's order, `COMMIT;`, and then every table's `COPY`. Run
with `-bail` (as its header says) or by the runner, a run that fails while
building publishes nothing; DuckDB's command line without `-bail` carries on
after an error and commits what it built; `tables/<schema>.<table>.sql` holds each
table's SQL alone, build then publish; `README.md` says
how to run it. A model with no `duckdb-table` table gets no files. The SQL
differs between environments only in the paths their values give.

The README follows the environment's paths. When every path is in Azure, it
leads with the Container Apps job, says `run.sql` has no Azure sign-in of its
own, and omits the laptop `duckdb` command. When some paths are local and some
in Azure, it says local paths cannot run in Azure, keeps the laptop command and
omits the job paragraph; the laptop text says each table is published to its
path when `published` is in Azure, and to the `published` folder, which must
exist, when it is local. When every path is local, it has the laptop command
only. Its commands name `build/duckdb/<environment>/`, the folder ingestron 2.0
writes the environment's files in, whatever other packs the standard lists.

The pack is version 2 (`duckdb@2`) from 2.0.0: the README's folder is the only
change from version 1, and the SQL is the same.

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
- A transform's table: `CREATE OR REPLACE TABLE … AS SELECT <contract columns,
each cast to its type> FROM (<code>) AS "source"`, the code on its own lines;
  with `history: latest` and a primary key, an upsert instead (see "Intent").

Each column is `CAST(<file column> AS <type>) AS <name>`. The file column is the
`physicalName` when the ingest did not rename; the type is the resolved one when
the standard lists `duckdb@` first, else from the `logicalType` (`string`
`VARCHAR`, `integer` `BIGINT`, `number` `DOUBLE`, `boolean` `BOOLEAN`, `date`
`DATE`, `timestamp` `TIMESTAMP`, `time` `TIME`). Readers: `read_parquet`,
`read_csv` (with `header` and `delim`, and `names` in contract order when
`header` is false) and `read_json_auto`. A folder's trailing `/` or `\` is
dropped. Names are in double
quotes with `"` doubled; text in single quotes with `'` doubled.

## Checks

A method check problem when `upsert` has no primary key, `sequence_by` is not a
contract column, an audit column has the name of a column of the table (or of
`_ingestron_file` when the mode is not `replace`), a table's files have no recorded location or a format other
than parquet, csv or json, `append` reads a file its ingest replaces each run, a flow writes expectations (DuckDB tables check no rows
yet), a `files` connection has no `path`, or a transform's SQL names a table
not in `inputs`.

## Intent

A standard can say what a table keeps and how its data is loaded as intent: a
vocabulary the definitions specification (section 11) defines for every
engine, such as `history: latest` or `load: files`. The pack declares what it
does with each value. The sources are in [references.md](references.md).

### Mapping

| Intent                                  | DuckDB                                                                                             | Status    |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- | --------- |
| `load.mode: full`, `files`              | Chosen by the ingest method; every file in the object is read each run                             | used      |
| `load.mode: incremental`, `changes`     | A cursor; a change feed                                                                            | not yet   |
| `history: none`                         | The rows as they arrived (`replace` or `append`)                                                   | used      |
| `history: latest`                       | `INSERT OR REPLACE` of the last row per primary key (`upsert`), in a flow's or a transform's table | used      |
| `history: full`, `bitemporal`           | Versioned rows                                                                                     | not yet   |
| `sequence`                              | The column that orders a key's rows in `upsert` (`sequence_by`)                                    | used      |
| `audit: loaded_at`                      | `now() AS "<as>"`, in every table the pack keeps                                                   | used      |
| `audit: source_file`                    | The reader's `filename` column as `"<as>"`, in a flow's table                                      | used      |
| `audit: source_modified_at`, `row_hash` | A file's modified time; a hash column                                                              | not yet   |
| `audit: run_id`, `window_*`, `source_*` | Added by the step that lands the files                                                             | elsewhere |
| `retention.landed_files`                | Kept by the landing pack                                                                           | elsewhere |
| `load.cursor`, `load.deletes.*`         | A cursor column; deletions                                                                         | not yet   |
| `rescued`, `storage.*`, `retention.*`   | A rescued column; clustering; time travel and log                                                  | not yet   |
| `quality.results`                       | A table of check results                                                                           | not yet   |
| `operations.*`                          | DuckDB runs locally or as one job; it has no scheduler                                             | n/a       |

Every `used` feature is generally available on the page the pack checked on
2026-11-09 (references.md). Audit columns come after the contract's columns
(and after any columns the landed files carry), are typed `TIMESTAMP WITH TIME
ZONE` (`loaded_at`) and `VARCHAR` (`source_file`), and are kept in the table and
in the published Parquet; they are not contract columns. `source_file` is
generated only for a flow's table, since a transform's table reads no files.
The `append` mode's `_ingestron_file` column is not an audit column: it stays
in the table, is not published, and is how files already loaded are skipped.

### Coverage

The pack's `intent` covers every intent path and value, and a test fails when
one is missing. An entry is one of:

- `used`, with what it does and the feature's release status (level, the page
  and the date checked), for every `used` row above;
- `elsewhere`, for `retention.landed_files` and the audit values `run_id`,
  `window_start`, `window_end`, `source_object` and `source_connection`: the
  step that lands the files keeps or adds them. `duckdb-files` reads the files
  where they are, so nothing lands them: they are `not-yet` for that method;
- `not-applicable` ("DuckDB runs locally or as one job; it has no scheduler."),
  for `operations`;
- `not-yet` with the reason "Planned.", for every other path and value: the
  table above is the target, not what the pack builds today.

### Aliases and defaults

The `mode` and `sequence_by` settings of `duckdb-table` are other names for
intent:

| Setting         | Intent            |
| --------------- | ----------------- |
| `mode: replace` | `history: none`   |
| `mode: upsert`  | `history: latest` |
| `sequence_by`   | `sequence`        |

`mode: append` is a setting only: appending needs files that are added to, which
`history: none` does not say, so writing it is not reported as moved. `load.mode`
is not an alias: the ingest method decides it. A table built from the intent gives
the SQL a table built from the setting gives. The methods fill in intent that
nothing declares, which is what they did before intent existed: `duckdb-table`
`history: none` and `duckdb-files` `load.mode: files`. A default is not declared,
so it never changes `mode`; a table that declares `history: none` is built as
`replace`, as it was.

`history: latest` on a transform's table (with the contract's primary key)
creates the table with the contract's columns and key, as an `upsert` flow
table, then runs `INSERT OR REPLACE INTO … BY NAME SELECT <contract columns,
cast> FROM (<code>) AS "source"`, keeping a key's last row by `sequence` when it
is set. Rows the query no longer returns stay. Without a primary key it is the
method check problem for `upsert`.

### The Platform's section

DuckDB has no Platform fields of its own, so the pack's section allows none.

## Contracts

Columns, types, physical names and primary keys are used; quality,
relationships and tags are not used yet; the other facts are documentation.

## Running in Azure

`request` returns a section titled `DuckDB job` when any `duckdb-table` table
reads or publishes Azure storage paths (`abfss://`, `abfs://`, `az://`,
`azure://`), and nothing otherwise; when the same environment also uses local
paths, the section says a job in Azure cannot run it. It names
the job with the public image `ghcr.io/ingestron/duckdb-runner:1` and
`INGESTRON_SQL`, the storage roots (`abfss://<file system>@<account host>`) the
job reads and writes, and something that starts it after each load.

The generated README follows the rule in "Files" above.

The runner (`runner/`) runs `INGESTRON_SQL` in a fresh database at
`/tmp/ingestron.duckdb`, signed in with the job's managed identity
(`AZURE_CLIENT_ID` for a user-assigned one). It refuses a `run.sql` that reads
or writes paths outside Azure storage (any reader, a list of files, a file read
as a table, or COPY's target; comments and text in quotes are not paths) unless
`INGESTRON_ALLOW_LOCAL=1`. Exit codes: 0 built,
1 failed or local paths, 2 no `INGESTRON_SQL`.
