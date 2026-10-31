# @ingestron/pack-duckdb

The DuckDB pack: loads files into tables, runs transforms and publishes each
table as Parquet, with SQL that DuckDB runs on a laptop or wherever DuckDB
runs. With `runs-on: duckdb`, an environment runs a project's tables locally
from the files another pack lands.

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
