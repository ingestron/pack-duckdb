# References

DuckDB syntax used by this pack, accessed 2026-11-01:

- [Reading and writing Parquet files](https://duckdb.org/docs/2.0/data/parquet/overview):
  `read_parquet`, its `filename` option (a column naming each row's file), and
  `COPY … TO '…' (FORMAT parquet)`.
- [Reading multiple files](https://duckdb.org/docs/2.0/data/multiple_files/overview):
  glob patterns and the `filename` column.
- [Importing data](https://duckdb.org/docs/2.0/data/overview): `read_csv` with
  `header` and `delim`, and `read_json_auto`.
- [CSV import](https://duckdb.org/docs/2.0/data/csv/overview) (accessed
  2026-11-01): `names` sets the column names of a file without a header.
- [Transactions](https://duckdb.org/docs/2.0/sql/statements/transactions)
  (accessed 2026-11-01): `BEGIN TRANSACTION` and `COMMIT`. Some errors, such as
  a binder error, leave the transaction open, so a run must stop at the first
  error for a failed build to publish nothing.
- [Command line](https://duckdb.org/docs/2.0/clients/cli/overview) (accessed
  2026-11-01): `-c` runs a command, `.read` a file, and `-bail` stops at the
  first error; `.bail` is off by default.
- [Azure extension](https://duckdb.org/docs/2.0/core_extensions/azure.html)
  (accessed 2026-11-01): the `abfss://`, `abfs://`, `az://` and `azure://`
  prefixes, `COPY … TO` Azure storage, and secrets with `credential_chain` or
  `managed_identity`.

Intent, accessed 2026-11-09:

- [Timestamp with time zone functions](https://duckdb.org/docs/2.0/sql/functions/timestamptz):
  `now()`, the current timestamp (`TIMESTAMP WITH TIME ZONE`) of the transaction,
  which is the `loaded_at` audit column.
- [Reading and writing Parquet files](https://duckdb.org/docs/2.0/data/parquet/overview)
  and [Reading multiple files](https://duckdb.org/docs/2.0/data/multiple_files/overview):
  the readers' `filename` option, a column naming each row's file, which is the
  `source_file` audit column.
- [INSERT](https://duckdb.org/docs/2.0/sql/statements/insert): `INSERT OR
REPLACE`, for `history: latest`.
- [Window functions](https://duckdb.org/docs/2.0/sql/functions/window_functions):
  `row_number() OVER (PARTITION BY … ORDER BY …)` with `QUALIFY`, which keeps a
  key's last row by `sequence`.

Quality and cleansing, accessed 2026-11-10:

- [Timestamp with time zone functions](https://duckdb.org/docs/2.0/sql/functions/timestamptz):
  `AT TIME ZONE`, sugar for `timezone(text, …)`: a `TIMESTAMP` read in the
  given zone gives a `TIMESTAMP WITH TIME ZONE`, and a `TIMESTAMP WITH TIME
ZONE` gives the wall-clock `TIMESTAMP` in the given zone; "Time zone support
  is provided by the built-in ICU extension"; `now()` is the start of the
  current transaction, which is `checked_at`. The page does not say how a
  skipped or repeated wall time is read; the pack's tests run both clock
  changes of 2026 in `Europe/London` (behaviour.md, "Cleansing").
- [ICU extension](https://duckdb.org/docs/2.0/core_extensions/icu): time
  zones for timestamp types and functions. DuckDB's command line (2.0.0) and
  `@duckdb/node-api` (1.5.6) link it statically (`duckdb_extensions()` says
  `STATICALLY_LINKED`); a custom build may not, and then loads it on first use.
- [Text functions](https://duckdb.org/docs/2.0/sql/functions/text): `trim`,
  `upper`, `lower`, `length` (characters) and `format` (the fmt syntax, `{}`),
  which writes the messages of `error`.
- [Utility functions](https://duckdb.org/docs/2.0/sql/functions/utility):
  `coalesce`, `nullif`, `error(message)` ("Throws the given error message"),
  `uuid()` and `getvariable(name)`.
- [CASE expression](https://duckdb.org/docs/2.0/sql/expressions/case): the
  simple form `CASE <x> WHEN <value> THEN <result> … ELSE <x> END`, for `map`.
- [Regular expressions](https://duckdb.org/docs/2.0/sql/functions/regular_expressions):
  `regexp_matches` is true when the text contains the pattern anywhere, as
  `RLIKE` does; patterns are RE2's.
- [List functions](https://duckdb.org/docs/2.0/sql/functions/list): `len`,
  `list_distinct` (removes duplicates and nulls) and `list_filter` with a
  `lambda x: …` function, which builds `_failed_checks`.
- [Aggregate functions](https://duckdb.org/docs/2.0/sql/functions/aggregates):
  `countif` and `count(DISTINCT …)`, for table checks.
- [QUALIFY clause](https://duckdb.org/docs/2.0/sql/query_syntax/qualify):
  filters on a window function, `row_number() OVER (PARTITION BY … ORDER BY …)`,
  for `deduplicate`.
- [CREATE TABLE](https://duckdb.org/docs/2.0/sql/statements/create_table):
  `CREATE OR REPLACE TABLE`, `IF NOT EXISTS`, and temporary tables
  (`CREATE TEMP TABLE`), which live in `temp.main`, belong to the connection
  that made them and stay in memory, for `ingestron_rows` and
  `ingestron_checked`.
- [SET VARIABLE](https://duckdb.org/docs/2.0/sql/statements/set_variable):
  `SET VARIABLE <name> = <value>`, a session variable read with `getvariable`,
  for the run's id.
- [Star expression](https://duckdb.org/docs/2.0/sql/expressions/star):
  `* EXCLUDE (…)`, which leaves `_ingestron_file` out of a deduplicated flow
  table.
- [INSERT](https://duckdb.org/docs/2.0/sql/statements/insert) and
  [Transactions](https://duckdb.org/docs/2.0/sql/statements/transactions):
  as above; checks, results and quarantine are written inside the run's one
  transaction, so an error rolls them back with the tables.
- [Command line](https://duckdb.org/docs/2.0/clients/cli/overview): "Results
  will be displayed in a table in the terminal", which is how a run shows its
  checks' counts.

The pack's tests run the SQL it writes with DuckDB (`@duckdb/node-api`), so the
statements are checked against the engine as well as these pages.
