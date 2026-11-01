# DuckDB runner

The container image `ghcr.io/ingestron/duckdb-runner` runs a project's
generated DuckDB SQL in Azure: an Azure Container Apps job runs it after each
load, for example started by ADF's `after_copy`. The image is public, so the
job pulls it with no registry or credentials.

Each run starts with an empty database, reads the deployed `run.sql`, signs in
to Azure storage as the job's managed identity, rebuilds every table from the
landed files and publishes each one as Parquet. Nothing is kept between runs,
so running again is always safe.

| Variable                | Meaning                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `INGESTRON_SQL`         | Where `run.sql` is, such as `abfss://deploy@<account>.dfs.core.windows.net/sales/dev/run.sql`. Required. |
| `AZURE_CLIENT_ID`       | The client ID of a user-assigned managed identity. Without it, the job's own identity is used.           |
| `INGESTRON_ALLOW_LOCAL` | `1` lets `run.sql` read and write local paths, for tests only.                                           |

Exit codes: `0` built, `1` the run failed or `run.sql` uses local paths, `2`
`INGESTRON_SQL` is missing. The image holds no secrets: it signs in with the
job's managed identity.

It is Python 3.12 with DuckDB 1.5.6, the engine the pack's tests use, and the
`azure` extension installed at build time. The `runner` workflow tests it and,
for a tag `runner-v<version>`, publishes `ghcr.io/ingestron/duckdb-runner:<version>`
and `:1`.
