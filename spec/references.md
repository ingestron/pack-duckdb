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
  (accessed 2026-11-01): `BEGIN TRANSACTION` and `COMMIT`; a failed statement
  leaves nothing of the transaction.
- [Command line](https://duckdb.org/docs/2.0/clients/cli/overview) (accessed
  2026-11-01): `-c` runs a command, `.read` a file, and `-bail` stops at the
  first error.
- [Azure extension](https://duckdb.org/docs/2.0/core_extensions/azure.html)
  (accessed 2026-11-01): the `abfss://`, `abfs://`, `az://` and `azure://`
  prefixes, `COPY … TO` Azure storage, and secrets with `credential_chain` or
  `managed_identity`.

The pack's tests run the SQL it writes with DuckDB (`@duckdb/node-api`), so the
statements are checked against the engine as well as these pages.
