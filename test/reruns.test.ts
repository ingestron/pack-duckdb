// Running again changes nothing, whatever the files hold and however the contract changes.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  contract,
  execute,
  folder,
  generate,
  project,
  runSql,
  writeParquet,
  writeQuery,
} from "./project.js";

const ordered = "SELECT id, name FROM bronze.orders ORDER BY id, name";

describe("upsert", () => {
  it("keeps the same row for a key repeated across files on every run", async () => {
    const where = folder();
    await writeParquet(join(where.input, "orders/a.parquet"), "(1, 'x', 1)");
    await writeParquet(join(where.input, "orders/b.parquet"), "(1, 'y', 1)");
    const sql = runSql(project(where, "{ mode: upsert }"));
    const database = join(where.root, "ingestron.duckdb");
    const runs = [];
    for (let run = 0; run < 3; run++) runs.push(await execute(database, sql, ordered));
    expect(runs).toEqual([
      [{ id: "1", name: "y" }],
      [{ id: "1", name: "y" }],
      [{ id: "1", name: "y" }],
    ]);
  });
});

describe("append", () => {
  it("reads files that have a column named filename", async () => {
    const where = folder();
    await writeQuery(
      join(where.input, "orders/a.parquet"),
      "SELECT 1 AS id, 'a' AS name, 1 AS seq, 'x.csv' AS filename",
    );
    const sql = runSql(project(where, "{ mode: append }"));
    expect(await execute(join(where.root, "ingestron.duckdb"), sql, ordered)).toEqual([
      { id: "1", name: "a" },
    ]);
  });

  it("keeps working when the contract gains a column", async () => {
    const where = folder();
    await writeQuery(
      join(where.input, "orders/a.parquet"),
      "SELECT 1 AS id, 'a' AS name, 1 AS seq, 'red' AS colour",
    );
    const database = join(where.root, "ingestron.duckdb");
    await execute(database, runSql(project(where, "{ mode: append }")), ordered);
    const wider = contract().replace(
      "      - { name: seq, logicalType: integer }\n",
      "      - { name: seq, logicalType: integer }\n      - { name: colour, logicalType: string }\n",
    );
    await writeQuery(
      join(where.input, "orders/b.parquet"),
      "SELECT 2 AS id, 'b' AS name, 1 AS seq, 'blue' AS colour",
    );
    const sql = runSql(project(where, "{ mode: append }", { "orders.yaml": wider }));
    expect(
      await execute(database, sql, "SELECT id, colour FROM bronze.orders ORDER BY id"),
    ).toEqual([
      { id: "1", colour: null },
      { id: "2", colour: "blue" },
    ]);
  });

  it("publishes only the contract's columns", async () => {
    const where = folder();
    await writeParquet(join(where.input, "orders/a.parquet"), "(1, 'a', 1)");
    const sql = runSql(project(where, "{ mode: append }"));
    await execute(join(where.root, "ingestron.duckdb"), sql, "SELECT 1");
    const columns = await execute(
      ":memory:",
      "SELECT 1",
      `SELECT name FROM parquet_schema('${where.published}/bronze.orders.parquet') WHERE name <> 'duckdb_schema' ORDER BY name`,
    );
    expect(columns.map((row) => row.name)).toEqual(["id", "name", "seq"]);
  });
});

describe("problems found before running", () => {
  const messages = (files: Record<string, string>) =>
    generate(files).result.diagnostics.map(({ message }) => message);

  it("needs the files connection's path", () => {
    const where = folder();
    const files = project(where, "{}", {
      "shop.yaml":
        "apiVersion: ingestron.io/v1\nkind: Connection\nid: shop\nconnector: files\nconnectivity: public\nsettings: {}\n",
    });
    expect(messages(files)).toEqual([
      '"duckdb-files" for table "orders": the files connection needs a path, the folder its files are in.',
    ]);
  });

  it("refuses expectations a DuckDB table would not check", () => {
    const where = folder();
    const files = project(where, "{}", {
      "flow.yaml":
        "apiVersion: ingestron.io/v1\nkind: Flow\nid: shop\nsource: shop\ntables:\n  orders:\n    object: orders/*.parquet\n    contract: orders\n    expectations:\n      - { name: positive, check: id > 0, action: fail }\n",
    });
    expect(messages(files)).toEqual([
      '"duckdb-table" for table "orders": DuckDB tables check no rows yet, so the expectation "positive" would not be checked; remove it.',
    ]);
  });
});

describe("transforms", () => {
  it("run when their SQL ends with a comment", async () => {
    const where = folder();
    await writeParquet(join(where.input, "orders/a.parquet"), "(1, 'a', 1)");
    const transform = [
      "apiVersion: ingestron.io/v1",
      "kind: Transform",
      "id: all_orders",
      "inputs: [orders]",
      "code: |",
      "  SELECT id, name, seq FROM {{ tables.orders }} -- every order",
      "contract: orders",
      "",
    ].join("\n");
    const counts = contract().replace(
      "  - name: orders\n",
      "  - name: all_orders\n    logicalType: object\n    properties:\n      - { name: id, logicalType: integer }\n      - { name: name, logicalType: string }\n      - { name: seq, logicalType: integer }\n  - name: orders\n",
    );
    const sql = runSql(project(where, "{}", { "all.yaml": transform, "orders.yaml": counts }));
    expect(
      await execute(
        join(where.root, "ingestron.duckdb"),
        sql,
        "SELECT count(*) AS n FROM silver.all_orders",
      ),
    ).toEqual([{ n: "1" }]);
  });
});
