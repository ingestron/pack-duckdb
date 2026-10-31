# @ingestron/pack-duckdb

The DuckDB pack: loads files into tables, runs transforms and publishes each
table as Parquet, with SQL that DuckDB runs on a laptop or wherever DuckDB
runs. With `runs-on: duckdb`, an environment runs a project's tables locally
from the files another pack lands.

## Methods

| Method          | Action    | Does                                                                                           |
| --------------- | --------- | ---------------------------------------------------------------------------------------------- |
| `duckdb-files`  | ingest    | Reads files where they are: the connection's `path` and the table's object, a file or pattern  |
| `duckdb-landed` | ingest    | Reads the files another pack lands, from a local folder, in an environment that runs on DuckDB |
| `duckdb-table`  | store     | Keeps the table in the DuckDB database and publishes it as Parquet                             |
| `duckdb-sql`    | transform | Runs the transform's SQL in DuckDB, over its inputs' tables                                    |

`duckdb-table` loads a table's files by `mode`: `replace` (the table is the
files' rows), `append` (each file's rows once) or `upsert` (rows replace those
with the same primary key; `sequence_by` picks the latest). Running again is
safe in every mode. Each table is published to the `published` folder as
`<schema>.<table>.parquet`; the folder must exist.

The pack writes `run.sql`, every table in order, and `tables/`, each table's
SQL alone. Run it from the project folder with the DuckDB command line:

```sh
duckdb ingestron.duckdb < build/dev/run.sql
```

## Run a cloud project locally

An environment that names `runs-on: duckdb` runs a project's tables locally:
each file-landing ingest from another pack, such as ADF, is replaced by
`duckdb-landed`, which reads `<landing>/<object>/*.parquet`. Put a load's files
there, for example downloaded from the landing storage:

```yaml
# project.yaml
environments:
  local:
    runs-on: duckdb
  prod: {}
```

```yaml
# standard.yaml
packs: [duckdb@1, adf@1]
ingest:
  settings:
    duckdb-landed: { landing: ./samples }
```

The tables' store and transforms must be DuckDB's in every environment, so the
local run is the cloud run with local paths. Failures inside ADF (connectors,
credentials, networking) only happen in ADF.

## Example

```ts
import { loadDefinitions } from "@ingestron/definitions";
import { duckdb } from "@ingestron/pack-duckdb";

const result = loadDefinitions("definitions", { packs: [duckdb], environment: "local" });
if (result.model) console.log(duckdb.build(result.model)["duckdb/run.sql"] ?? "");
```

## Documentation

User documentation: https://docs.ingestron.io.

## Working on this pack

```sh
pnpm install
pnpm validate   # format, licences, lint, types, tests, README code and API report
```

Requires Node 22.13 or later and pnpm 10. How code is written here:
[CONTRIBUTING.md](CONTRIBUTING.md). Security: [SECURITY.md](SECURITY.md).

## Contact

Questions and feedback: hello@ingestron.io. Security reports: security@ingestron.io
(see [SECURITY.md](SECURITY.md)).

## Licence

Licensed under the [Apache License 2.0](LICENSE); see [NOTICE](NOTICE). Made by
[IntentLabs](https://intentlabs.dev).
