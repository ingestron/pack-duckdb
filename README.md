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

`append` reads each file name once, so a file re-exported under the same name is
skipped, and its new rows are not loaded. Give a re-export a new name, or delete
`ingestron.duckdb` and run again to reload every file. In Azure each run starts
with an empty database, so every file is read.

A CSV without a header (`csv.header: false`) binds its columns in the table's
order, so the file's columns must be in that order. With a header, columns are
matched by name.

The pack writes `run.sql`, every table in order, and `tables/`, each table's
SQL alone. `ingestron apply` (2.0 or later) puts them in
`build/duckdb/<environment>/`, whatever other packs the standard lists. Run
`run.sql` from the project folder with the DuckDB command line, for example:

```sh
duckdb -bail ingestron.duckdb -c ".read build/duckdb/dev/run.sql"
```

Tables are built in one transaction and published after it commits; run with
`-bail`, as above, so a run that fails while building publishes nothing.
Running again is safe in every mode, and a table whose contract or source
metadata gains columns keeps loading: new columns are added to the table. A
changed primary key or column type needs the table built again: delete
`ingestron.duckdb` and run again, which reloads everything from the files. In
`upsert`, a key's row is the last by `sequence_by`, then by file name; set
`sequence_by` when one file can hold a key twice.

A transform's columns are cast to the contract's types, and a cast can change a
value: a timestamp with a time zone loses its offset when the contract says
`timestamp`, and a `timestamptz` shows the time in the session's time zone; a
decimal rounds when the contract says `integer`. Give the contract the type you
want to keep.

Expectations written in a flow are refused, since DuckDB tables check no rows
yet; the contract's quality rules are reported as not checked.

Columns the landed files carry beyond the table's columns, such as ADF's audit
columns, are kept after them, typed by their `logicalType`, and published with
them.

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
packs: [duckdb@2, adf@2]
ingest:
  settings:
    duckdb-landed: { landing: ./samples }
```

The tables' store and transforms must be DuckDB's in every environment, so the
local run is the cloud run with local paths. Failures inside ADF (connectors,
credentials, networking) only happen in ADF.

`duckdb-landed` reads Parquet files one folder down: `<landing>/<object>/*.parquet`.
Tables ADF lands in other ways find no files locally: Microsoft 365 data (JSON),
files `adf-files` copies as they are, and custom `path` layouts.

## Run in Azure

In an environment whose files are in Azure storage, `run.sql` reads and writes
`abfss://` paths, and an Azure Container Apps job runs it with the public image
`ghcr.io/ingestron/duckdb-runner:1`, which needs no registry or credentials.
Each run starts with an empty database, reads every landed file, rebuilds every
table and publishes it, signed in as the job's managed identity; nothing is
kept between runs, so running again is always safe. Your deploy step copies
`build/duckdb/<environment>/` to storage, and the job's `INGESTRON_SQL` names
the copied `run.sql`. ADF's `after_copy` can start the job after each load.
`ingestron request` lists the job and its storage access. The image is
described in [runner/README.md](runner/README.md).

## Example

```ts
import { loadDefinitions } from "@ingestron/definitions";
import { duckdb } from "@ingestron/pack-duckdb";

const result = loadDefinitions("definitions", { packs: [duckdb], environment: "local" });
if (result.model) console.log(duckdb.build(result.model)["run.sql"] ?? "");
```

## What changed in 2.2

The pack reads the standard's intent: what a table keeps and how its data is
loaded, such as `history: latest`, written once for every engine. A project
that declares no intent gets the same SQL as with 2.1.

- Two `duckdb-table` settings are now other names for intent. They still work
  and build the same SQL, but each is a `SETTING_MOVED` warning with the fix
  `Write as intent`: `mode: replace` is `history: none`, `mode: upsert` is
  `history: latest`, and `sequence_by` is `sequence`. `mode: append` stays a
  setting.
- New output appears only where the project declares it:
  - `audit: loaded_at` adds a load time column to every table the pack keeps,
    and `audit: source_file` adds the file each row came from to a flow's
    table;
  - `history: latest` on a transform's table with a primary key upserts the
    query's rows in place of replacing the table.
- The Platform has a `duckdb` section, which takes no fields.
- Needs `@ingestron/definitions` 1.14 or later.

## What changed in 2.0

- The pack is `duckdb@2`, like every pack ingestron 2.0 uses. There, a standard that names `duckdb@1` gets `PACK_VERSION`, with a fix that changes it to `duckdb@2`.
- ingestron 2.0 writes each environment's files in `build/duckdb/<environment>/`, so the generated README's commands name that folder. The SQL is unchanged.

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

Licensed under the [Apache License 2.0](LICENSE); see [NOTICE](NOTICE).
