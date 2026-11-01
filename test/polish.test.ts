// A run that fails publishes nothing; transforms and header-less CSV get the
// contract's types and names; settings DuckDB cannot honour are refused.
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Pack } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { duckdb } from "../src/index.js";
import { execute, folder, generate, project, runSql, writeParquet } from "./project.js";

const counts = (code: string) => ({
  "counts.yaml": [
    "apiVersion: ingestron.io/v1",
    "kind: Transform",
    "id: counts",
    "inputs: [orders]",
    `code: "${code}"`,
    "contract: counts",
    "",
  ].join("\n"),
  "counts-contract.yaml": [
    "apiVersion: v3.1.0",
    "kind: DataContract",
    "id: counts",
    "version: 1.0.0",
    "status: active",
    "schema:",
    "  - name: counts",
    "    logicalType: object",
    "    properties:",
    "      - { name: name, logicalType: string }",
    "      - { name: n, logicalType: integer }",
    "",
  ].join("\n"),
});

/** A pack that lands files somewhere, in a format and way of its choosing. */
const lander = (format: string, loads: "add" | "replace"): Pack => ({
  ...duckdb,
  id: "lander",
  rules: { ingest: { default: "land" } },
  methods: {
    land: {
      action: "ingest",
      description: "Lands files.",
      connectors: ["files"],
      produces: "files",
      settings: { type: "object" },
      output: () => ({ location: "/landed/orders/*", format: format as "parquet", loads }),
    },
  },
  build: () => ({}),
});

const landed = (store: string) =>
  project(folder(), store, {
    "standard.yaml": `apiVersion: ingestron.io/v1\nkind: Standard\nid: acme\npacks: [duckdb@1, lander@1]\nstore: { settings: { duckdb-table: ${store} } }\n`,
    "flow.yaml":
      "apiVersion: ingestron.io/v1\nkind: Flow\nid: shop\nsource: shop\ningest: { uses: land }\ntables:\n  orders: { object: orders, contract: orders }\n",
  });
const messages = (files: Record<string, string>, packs: Pack[] = [duckdb]) =>
  generate(files, packs).result.diagnostics.map(({ message }) => message);

describe("a run", () => {
  it("builds every table in one transaction and publishes only after it commits", () => {
    const sql = runSql(
      project(
        folder(),
        "{}",
        counts("SELECT name, count(*) AS n FROM {{ tables.orders }} GROUP BY name"),
      ),
    );
    const begin = sql.indexOf("BEGIN TRANSACTION;");
    const commit = sql.indexOf("COMMIT;");
    expect(begin).toBeGreaterThan(-1);
    expect(begin).toBeLessThan(sql.indexOf("CREATE OR REPLACE TABLE"));
    expect(commit).toBeLessThan(sql.indexOf("COPY ("));
    expect(sql.lastIndexOf("CREATE OR REPLACE TABLE")).toBeLessThan(commit);
  });

  it("publishes nothing when a table fails", async () => {
    const where = folder();
    await writeParquet(join(where.input, "orders/a.parquet"), "(1, 'a', 1)");
    const sql = runSql(
      project(where, "{}", counts("SELECT nonexistent AS name, 1 AS n FROM {{ tables.orders }}")),
    );
    await expect(execute(join(where.root, "ingestron.duckdb"), sql, "SELECT 1")).rejects.toThrow();
    expect(readdirSync(where.published)).toEqual([]);
  });
});

describe("types and names", () => {
  it("casts a transform's columns to the contract's types", () => {
    const sql = runSql(
      project(
        folder(),
        "{}",
        counts("SELECT name, count(*) AS n FROM {{ tables.orders }} GROUP BY name"),
      ),
    );
    expect(sql).toContain(
      'CREATE OR REPLACE TABLE "silver"."counts" AS SELECT CAST("name" AS VARCHAR) AS "name", CAST("n" AS BIGINT) AS "n" FROM (',
    );
  });

  it("reads CSV files without a header by the contract's column names", async () => {
    const where = folder();
    writeFileSync(join(where.input, "orders/a.csv"), "1,a,1\n2,b,1\n");
    const files = project(where, "{}", {
      "standard.yaml": `apiVersion: ingestron.io/v1\nkind: Standard\nid: acme\npacks: [duckdb@1]\ningest: { settings: { duckdb-files: { format: csv, csv: { header: false, delimiter: "," } } } }\n`,
      "flow.yaml":
        "apiVersion: ingestron.io/v1\nkind: Flow\nid: shop\nsource: shop\ntables:\n  orders: { object: orders/*.csv, contract: orders }\n",
    });
    const sql = runSql(files);
    expect(sql).toContain("header = false, delim = ',', names = ['id', 'name', 'seq']");
    expect(
      await execute(
        join(where.root, "ingestron.duckdb"),
        sql,
        "SELECT id, name FROM bronze.orders ORDER BY id",
      ),
    ).toEqual([
      { id: "1", name: "a" },
      { id: "2", name: "b" },
    ]);
  });

  it("drops a trailing backslash from a Windows folder", () => {
    const where = folder();
    const files = project(where, "{}", {
      "shop.yaml": `apiVersion: ingestron.io/v1\nkind: Connection\nid: shop\nconnector: files\nconnectivity: public\nsettings: { path: 'C:\\data\\' }\n`,
    });
    expect(runSql(files)).toContain("read_parquet('C:\\data/orders/*.parquet')");
  });
});

describe("settings DuckDB cannot honour", () => {
  it("refuses sequence_by that is not a contract column", () => {
    expect(messages(project(folder(), "{ mode: upsert, sequence_by: updated }"))).toContain(
      '"duckdb-table" for table "orders": sequence_by "updated" is not a column of the contract; use one of id, name, seq.',
    );
  });

  it("refuses append over a file replaced each run", () => {
    expect(messages(landed("{ mode: append }"), [duckdb, lander("parquet", "replace")])).toContain(
      '"duckdb-table" for table "orders": append reads each file once, but "land" replaces its file each run, so later loads would be missed; use replace or upsert.',
    );
  });

  it("refuses files in a format DuckDB does not read", () => {
    expect(messages(landed("{}"), [duckdb, lander("delta", "add")])).toContain(
      '"duckdb-table" for table "orders": "land" lands delta files; DuckDB reads parquet, csv and json.',
    );
  });
});

describe("the generated README", () => {
  it("runs run.sql with .read, and stops at the first error", () => {
    const { files } = generate(project(folder()));
    expect(files["README.md"]).toContain(
      'duckdb -bail ingestron.duckdb -c ".read build/dev/run.sql"',
    );
  });

  it("names the job when the files are in Azure", () => {
    const { files } = generate(
      project({
        input: "abfss://landing@acct.dfs.core.windows.net/erp",
        published: "abfss://published@acct.dfs.core.windows.net",
      }),
    );
    expect(files["README.md"]).toContain("ghcr.io/ingestron/duckdb-runner:1");
  });
});
