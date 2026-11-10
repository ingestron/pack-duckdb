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

When a table keeps its checks' results (see "Quality and cleansing"),
`run.sql` sets the run's id right after `BEGIN TRANSACTION;`, once for every
table: `SET VARIABLE ingestron_run_id = CAST(uuid() AS VARCHAR);`. Such a
table's own file starts with the same statement.

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

A table that cleanses, deduplicates or checks rows builds them as "Quality and
cleansing" says; any other table is built as above, whatever its layer's
`does`.

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
than parquet, csv or json, `append` reads a file its ingest replaces each run, a flow or transform writes
its own expectations in a layer whose `does` does not list `check` (DuckDB
checks rows only where it does: `DuckDB checks rows only in a layer whose does
lists check, so the expectation "<name>" would not be checked; add check to the
layer's does, or remove it`), a column whose type has a time zone (`TIMESTAMP
WITH TIME ZONE`, `TIMESTAMPTZ`) converts its zone (`the column "<name>" is
<type>, a moment in time with no wall-clock zone to convert; convert TIMESTAMP
columns only`), a `files` connection has no `path`, or a transform's SQL names
a table not in `inputs`.

## Intent

A standard can say what a table keeps and how its data is loaded as intent: a
vocabulary the definitions specification (section 11) defines for every
engine, such as `history: latest` or `load: files`. The pack declares what it
does with each value. The sources are in [references.md](references.md).

### Mapping

| Intent                                                            | DuckDB                                                                                             | Status    |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------- |
| `load.mode: full`                                                 | Every file the object names is read each run                                                       | used      |
| `load.mode: files`                                                | Each file read once: write `mode: append`                                                          | not yet   |
| `load.mode: incremental`, `changes`                               | A cursor; a change feed                                                                            | not yet   |
| `history: none`                                                   | The rows as they arrived (`replace` or `append`)                                                   | used      |
| `history: latest`                                                 | `INSERT OR REPLACE` of the last row per primary key (`upsert`), in a flow's or a transform's table | used      |
| `history: full`, `bitemporal`                                     | Versioned rows                                                                                     | not yet   |
| `sequence`                                                        | The column that orders a key's rows in `upsert` (`sequence_by`)                                    | used      |
| `audit: loaded_at`                                                | `now() AS "<as>"`, in every table the pack keeps                                                   | used      |
| `audit: source_file`                                              | The reader's `filename` column as `"<as>"`, in a flow's table                                      | used      |
| `audit: source_modified_at`, `row_hash`                           | A file's modified time; a hash column                                                              | not yet   |
| `audit: run_id`, `window_*`, `source_object`, `source_connection` | Added by the step that lands the files                                                             | elsewhere |
| `retention.landed_files`                                          | Kept by the landing pack                                                                           | elsewhere |
| `load.cursor`, `load.deletes.*`                                   | A cursor column; deletions                                                                         | not yet   |
| `rescued`, `storage.*`, `retention.*`                             | A rescued column; clustering; time travel and log                                                  | not yet   |
| `quality.rules` (every kind)                                      | A check in `run.sql`, in a layer whose `does` lists `check`                                        | used      |
| `quality.actions: warn`                                           | Rows are kept; the run prints how many fail, in a layer whose `does` lists `check`                 | used      |
| `quality.actions: drop`                                           | Failing rows are not inserted; the run prints how many, in a layer whose `does` lists `check`      | used      |
| `quality.actions: fail`                                           | `error()` before the insert: nothing is published, in a layer whose `does` lists `check`           | used      |
| `quality.table-checks`                                            | Counted after the table is built, in a layer whose `does` lists `check`                            | used      |
| `quality.quarantine`                                              | An insert of the rows a `drop` check leaves out, in a layer whose `does` lists `quarantine`        | used      |
| `quality.results`                                                 | Rows in `"<schema>"."_ingestron_checks"`, in the run's transaction                                 | used      |
| `cleanse.trim`, `empty`, `map`, `case`, `default`                 | `trim`, `nullif`, `CASE`, `upper` or `lower`, `coalesce`, in the table's `SELECT`                  | used      |
| `cleanse.timezone`                                                | `(<x> AT TIME ZONE '<from>') AT TIME ZONE '<to>'`, in the table's `SELECT`                         | used      |
| `deduplicate`                                                     | `QUALIFY row_number() … = 1`, in a table that is replaced each run                                 | used      |
| `operations.*`                                                    | DuckDB runs locally or as one job; it has no scheduler                                             | n/a       |

Every `used` feature is generally available on the page the pack checked on
2026-11-09, or for quality and cleansing on 2026-11-10 (references.md). Audit columns come after the contract's columns
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
  and the date checked), for every `used` row above. `quality.rules`,
  `quality.actions` and `quality.table-checks` are used only where the table's
  layer's `does` lists `check`, and `quality.quarantine` only where it lists
  `quarantine` (`onlyWhere`). In any other layer, including one that gives no
  `does`, the definitions package reports each rule, action, table check and
  quarantine as `NOT_APPLIED` with the hint "Add `check` to the layer's `does`
  to apply it here." (or `quarantine`), and the table's SQL is what it was
  before checks existed. `quality.results`, every `cleanse` path and
  `deduplicate` are used wherever the model gives them;
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
`history: none` and `duckdb-files` `load.mode: full`. A default is not declared,
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

Columns, types, physical names and primary keys are used. `required`,
`logicalTypeOptions`, `unique` and the object's and each column's `quality`
are used too: the definitions package makes them row checks and table checks,
which the pack runs in a layer whose `does` lists `check` (and reports as
`NOT_APPLIED` elsewhere, as "Coverage" says). Relationships and tags are not
used yet; the other facts are documentation.

## Quality and cleansing

The model says what each table checks, cleanses, deduplicates and quarantines
(definitions specification, sections 6 and 11.7). The pack writes it in the
table's statements, as plain DuckDB SQL. The sources are in
[references.md](references.md), under "Quality and cleansing".

The order is the design's: each column is cast to its type, then cleansed;
then the rows are deduplicated; then the row checks read them. Checks see
cleansed values.

### Cleansing

Each column in `cleanse.columns` is selected as an expression of the column,
cast to its type, each operation applied to the result of the one before, in
the model's order. `<x>` starts as `CAST(<file column> AS <type>)`:

| Operation  | Expression                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| `timezone` | `(<x> AT TIME ZONE '<from>') AT TIME ZONE '<to>'`                                                        |
| `trim`     | `trim(<x>)`                                                                                              |
| `empty`    | `nullif(<x>, '')`                                                                                        |
| `map`      | `CASE <x> WHEN <key> THEN <value> … ELSE <x> END`, the keys in the order written; a null value is `NULL` |
| `case`     | `upper(<x>)` or `lower(<x>)`                                                                             |
| `default`  | `coalesce(<x>, <value>)`                                                                                 |

A value is written for the column's `logicalType`: a number as it is for
`integer` and `number` (a `map` key, which is text, too, when it reads as a
number); `TRUE` or `FALSE` for `boolean`; `DATE '<text>'` for `date`;
`TIMESTAMP '<text>'` for `timestamp`; any other value as SQL text. The column
keeps its place and its name: `<expression> AS "<name>"`.

**Time zones.** `<x> AT TIME ZONE '<from>'` reads the column's wall-clock time
in the zone it was written in and gives a `TIMESTAMP WITH TIME ZONE`;
`AT TIME ZONE '<to>'` gives the wall-clock time in the target zone, a
`TIMESTAMP` again. Zones are the model's IANA names, such as `Europe/London`
and `UTC`. DuckDB's time zones come from its ICU extension, which DuckDB's
command line and client libraries include. Around a clock change, a wall time
that does not exist (the hour skipped in spring) is read in the zone's offset
before the change, and a wall time that happens twice (the hour repeated in
autumn) is read as the later one. For `Europe/London` in 2026:

| Wall time in London   | UTC                   |
| --------------------- | --------------------- |
| `2026-03-29 00:30:00` | `2026-03-29 00:30:00` |
| `2026-03-29 01:30:00` | `2026-03-29 01:30:00` |
| `2026-03-29 02:30:00` | `2026-03-29 01:30:00` |
| `2026-10-25 00:30:00` | `2026-10-24 23:30:00` |
| `2026-10-25 01:30:00` | `2026-10-25 01:30:00` |
| `2026-10-25 02:30:00` | `2026-10-25 02:30:00` |

The DuckDB pages do not say how `AT TIME ZONE` resolves these hours; the
pack's tests run them. A column typed with a time zone is a method check
problem (section "Checks"). The pack declares `cleanse.timezone` as used, so
a converted table's zone is the target zone.

### Deduplicate

A table that is replaced each run (`replace`, and a transform's table that is
not kept as `history: latest`) keeps one row per primary key: its rows are
selected in a `SELECT` of their own, so that the window reads the columns as
cast and cleansed, then
`QUALIFY row_number() OVER (PARTITION BY <primary key> ORDER BY <c> DESC, …) = 1`,
each `order_by` column in the order written. A flow's table also orders by the
file each row came from, last first, so every run keeps the same row:

```sql
SELECT * EXCLUDE ("_ingestron_file") FROM (SELECT <columns>, "_ingestron_file" FROM <reader, with filename>) AS "rows" QUALIFY row_number() OVER (PARTITION BY "id" ORDER BY "updated_at" DESC, "_ingestron_file" DESC) = 1
```

A transform's table reads `SELECT * FROM (SELECT <columns> FROM (<code>) AS "source") AS "rows" QUALIFY …`.
An `upsert` table, or a transform's table kept as `history: latest`, writes
nothing for `deduplicate`: it already keeps one row per key, and the
definitions package has reported `DEDUPLICATE_MODE` as redundant. `append` is
the definitions package's `DEDUPLICATE_MODE` error.

### Row checks

A table in a layer whose `does` lists `check` runs its expectations. A table
in any other layer runs none, and its SQL is what it was before checks
existed. With `<c>` the column in double quotes and `<v>` a value (a number as
it is, any other value as SQL text), the condition a row passes is written
from the expectation's `rule`:

| `kind`       | Condition                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------- |
| `notNull`    | `<c> IS NOT NULL`                                                                             |
| `in`         | `<c> IS NULL OR <c> IN (<v>, …)`; `<c> IS NOT NULL AND <c> IN (<v>, …)` without `allowNull`   |
| `notIn`      | as `in`, with `NOT IN`                                                                        |
| `pattern`    | `<c> IS NULL OR regexp_matches(<c>, <v>)`                                                     |
| `length`     | `<c> IS NULL OR length(<c>) >= <min>`, and `length(<c>) <= <max>`                             |
| `range`      | `<c> IS NULL OR <c> >= <min>`, and `<c> <= <max>`; `>` and `<` when `exclusive`               |
| `multipleOf` | `<c> IS NULL OR <c> % <value> = 0`                                                            |
| `items`      | `<c> IS NULL OR len(<c>) >= <min>`, `len(<c>) <= <max>`, `len(list_distinct(<c>)) = len(<c>)` |

A rule with more than one limit joins them with `AND` after `<c> IS NULL OR`.
These are the Databricks pack's conditions in DuckDB's SQL: null fails
`notNull`, passes `in` and `notIn` only with `allowNull`, and passes every
other kind. `regexp_matches` finds the pattern anywhere in the text, as
`RLIKE` does. `list_distinct` leaves nulls out, so a list that holds a null
fails `unique`. An expectation with no `rule` (one a flow or transform writes)
uses its `check` text, which is DuckDB SQL there.

A row passes a check only when its condition is true: a condition that is null
fails, `coalesce(<condition>, FALSE)`.

The table's rows are first kept in a temporary table, `"temp"."ingestron_rows"`
(`CREATE OR REPLACE TEMP TABLE "ingestron_rows" AS <rows>;`): the rows the
table would otherwise be built from, cast, cleansed and deduplicated. Then, in
the table's order:

1. **Count.** `"temp"."ingestron_checked"` holds one row per expectation:
   ```sql
   CREATE OR REPLACE TEMP TABLE "ingestron_checked" AS SELECT *, "failing_rows" = 0 AS "passed" FROM (VALUES
     ('<schema>.<table>', '<name>', '<action>', (SELECT count(*) FROM "temp"."ingestron_rows" WHERE NOT coalesce(<condition>, FALSE))),
     …
   ) AS "checks"("table", "check", "action", "failing_rows");
   ```
2. **Print.** `SELECT "table", "check", "action", "failing_rows", "passed" FROM "temp"."ingestron_checked";`
   DuckDB's command line prints the result, so the run shows every check's
   failing rows: for `warn` the rows kept, for `drop` the rows left out.
3. **Stop.** `SELECT error(format('The check "{}" failed for {} rows of {}, so nothing is published.', "check", "failing_rows", "table")) FROM "temp"."ingestron_checked" WHERE "action" = 'fail' AND NOT "passed";`
   A `fail` check that a row fails raises the error before any row is
   inserted: `-bail` stops the run, the transaction rolls back, and nothing is
   published.
4. **Results**, when the table keeps them (below).
5. **Insert.** The table is built from `"temp"."ingestron_rows"` as its mode
   builds it, keeping only the rows that pass every `drop` check,
   `WHERE coalesce(<condition>, FALSE)`, or `WHERE coalesce((<condition>) AND …, FALSE)`
   for more than one. With no `drop` check, every row:
   - `replace`: `CREATE OR REPLACE TABLE <table> AS SELECT * FROM "temp"."ingestron_rows"[ WHERE …];`
   - `append`: the table is created and its columns added as before, then
     `INSERT INTO <table> BY NAME SELECT * FROM "temp"."ingestron_rows"[ WHERE …];`.
     `"temp"."ingestron_rows"` holds the rows of the files not yet loaded, with
     their `_ingestron_file`.
   - `upsert`, and `history: latest`: the table is created and its columns
     added as before, then `INSERT OR REPLACE INTO <table> BY NAME SELECT * FROM "temp"."ingestron_rows"[ WHERE …];`.
6. **Quarantine**, when the table has it (below).
7. `DROP TABLE "temp"."ingestron_rows";`

`warn` keeps the row, `drop` leaves it out, `fail` stops the run. A table with
no expectations runs none of these steps.

### Table checks

A table in a layer whose `does` lists `check` runs its contract's table checks
after it is built, over all its rows. The pack declares no `checks`
capability: it counts them in its own run, with nothing shared to turn on or
grant, so the definitions package gives a DuckDB table its table checks (and
`unique`) whatever the Platform's `manage.checks` says (definitions
specification, section 7.1). The pack counts them as the Databricks pack does,
in DuckDB's SQL (`count(*)` for `rowCount`, `count(*) - count(DISTINCT <c>)` for
`duplicateValues` of one column, `count(DISTINCT (<c>, …))` of several, and
`count(DISTINCT "rows")` over `(SELECT <contract columns> FROM <table>) AS "rows"`
for the whole row, `countif(<c> IS NULL)` for `nullValues`, and so on, with
`regexp_matches` for a pattern; a `sql` check's query with `${object}` replaced
by the table's name). Each gives `"counted"` and `"total"`, all rows; with
`unit: percent` the rule compares `CASE WHEN "total" = 0 THEN 0 ELSE "counted" * 100.0 / "total" END`,
else `coalesce("counted", 0)`, by the operator: `=`, `<>`, `>`, `>=`, `<`, `<=`,
`BETWEEN <low> AND <high>` and `NOT BETWEEN`:

```sql
CREATE OR REPLACE TEMP TABLE "ingestron_checked" AS
  SELECT '<schema>.<table>' AS "table", '<name>' AS "check", '<action>' AS "action", CAST(coalesce("counted", 0) AS BIGINT) AS "failing_rows", <comparison> AS "passed" FROM (SELECT <count> AS "counted", count(*) AS "total" FROM <table>)
  UNION ALL …;
```

Then they are printed and kept as results as row checks are, and a `fail`
table check that does not pass raises
`error(format('The table check "{}" failed on {}, so nothing is published.', "check", "table"))`.
`"failing_rows"` is the rows the rule counted; for `rowCount`, every row.

`count(DISTINCT …)` takes one argument in DuckDB, so several columns, or the
whole row, are counted as one row value. A row value with a null part is a
value like any other: rows that hold the same values, nulls included, count
as duplicates, and a row with a null part counts as distinct. Spark's
`count(DISTINCT a, b)` leaves out a row with a null part, so on the same rows
the Databricks pack can count more duplicates. One column leaves nulls out on
both. The whole row is the contract's columns, so the audit columns and an
`append` table's `_ingestron_file` do not make rows differ.

### Results

A table that resolves `quality.results: true` and runs any check also keeps
each check's outcome in `"<schema>"."_ingestron_checks"`, in the table's own
schema, which every table of that schema shares. It is not a schema of its
own: the database is often `ingestron.duckdb`, whose catalog DuckDB names
`ingestron`, and a schema `ingestron` would then be an ambiguous name.

```sql
CREATE TABLE IF NOT EXISTS "<schema>"."_ingestron_checks" ("run_id" VARCHAR, "checked_at" TIMESTAMP WITH TIME ZONE, "table" VARCHAR, "check" VARCHAR, "action" VARCHAR, "failing_rows" BIGINT, "passed" BOOLEAN);
INSERT INTO "<schema>"."_ingestron_checks" ("run_id", "checked_at", "table", "check", "action", "failing_rows", "passed") SELECT getvariable('ingestron_run_id'), now(), "table", "check", "action", "failing_rows", "passed" FROM "temp"."ingestron_checked";
```

`"table"` is `<schema>.<table>`; `"failing_rows"` is the rows that failed a row
check, or the rows a table check counted; `"passed"` says whether the check
passed. The `CREATE TABLE` comes right after the table's `CREATE SCHEMA`; the insert after the stop of its row checks, and again after
the stop of its table checks. `run_id` is the run's id (section "Files"), the
same for every table of one run; `checked_at` is `now()`, the start of the
run's transaction. The rows are written in the run's transaction, so a run that
stops leaves none. A table that runs no check writes none, and a model where no
table writes results gets none of these statements, nor the run's id.

### Quarantine

A table in a layer whose `does` lists `check` and `quarantine`, with
`quarantine` in the model and at least one `drop` check, also keeps the rows
its `drop` checks leave out in `quarantine.fullName`,
`"<schema>"."<table>_quarantine"`, with a column `"_failed_checks"`: the names
of the `drop` checks the row failed, in the table's order, as a list of text:

```sql
list_filter([CASE WHEN coalesce(<condition>, FALSE) THEN NULL ELSE '<name>' END, …], lambda name: name IS NOT NULL)
```

A condition that is null counts as failed, so every row the table leaves out
is in its quarantine with at least one name. The quarantine follows the
table's mode:

- `replace`, `upsert` and `history: latest` read every row each run, so the
  quarantine is rebuilt each run:
  `CREATE OR REPLACE TABLE <quarantine> AS SELECT *, <failed> AS "_failed_checks" FROM "temp"."ingestron_rows" WHERE NOT <keep>;`
- `append` adds each file once, so the quarantine is created (empty, from the
  table) and gains the contract's new columns as the table does, then gains
  the rows: `INSERT INTO <quarantine> BY NAME SELECT *, <failed> AS "_failed_checks" FROM "temp"."ingestron_rows" WHERE NOT <keep>;`.
  It keeps `_ingestron_file`, and the files already loaded are those in the
  table or in its quarantine, so a file whose every row failed is not read
  again.

The quarantine is not published; it stays in the database.

### Where results appear

The generated README says, when a table runs checks, that the run prints each
check's failing rows (in Azure, that the job's log shows them), that a `fail`
check stops the run (in Azure, with its message in the job's log), and, when a
table keeps results or quarantines rows, where they are (in Azure, that they
last only for that run, since the job starts with an empty database); and,
when a table converts time zones, that DuckDB's ICU extension does it. Without
checks or conversions the README is what it was.

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
1 failed or local paths, 2 no `INGESTRON_SQL`. It runs `run.sql` one
statement at a time (`extract_statements`), as DuckDB's command line does with
`-bail`: the first error stops the run, and the transaction it leaves open
commits nothing. It logs each query's rows, one line per row as
`<column>=<value>` pairs joined by `, `, so each check's counts reach the job's
log, and a `fail` check's message is in the error it logs. The results and
quarantine tables last only for that run's database. Its README says so.
