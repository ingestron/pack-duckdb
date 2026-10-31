# References

DuckDB syntax used by this pack, accessed 2026-11-01:

- [Reading and writing Parquet files](https://duckdb.org/docs/2.0/data/parquet/overview):
  `read_parquet`, its `filename` option (a column naming each row's file), and
  `COPY … TO '…' (FORMAT parquet)`.
- [Reading multiple files](https://duckdb.org/docs/2.0/data/multiple_files/overview):
  glob patterns and the `filename` column.
- [Importing data](https://duckdb.org/docs/2.0/data/overview): `read_csv` with
  `header` and `delim`, and `read_json_auto`.

The pack's tests run the SQL it writes with DuckDB (`@duckdb/node-api`), so the
statements are checked against the engine as well as these pages.
