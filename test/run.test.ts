// run.sql: written for each table, and run with DuckDB, twice where a rerun must change nothing.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contract, execute, folder, generate, project, runSql, writeParquet } from "./project.js";

const ordered = "SELECT id, name FROM bronze.orders ORDER BY id, name";

describe("replace", () => {
  it("loads the files into the table and publishes it", async () => {
    const where = folder();
    await writeParquet(join(where.input, "orders/a.parquet"), "(1, 'a', 1), (2, 'b', 1)");
    const sql = runSql(project(where));
    expect(sql).toContain(
      `CREATE OR REPLACE TABLE "bronze"."orders" AS SELECT CAST("id" AS BIGINT) AS "id", CAST("name" AS VARCHAR) AS "name", CAST("seq" AS BIGINT) AS "seq" FROM read_parquet('${where.input}/orders/*.parquet');`,
    );
    expect(sql).toContain(
      `COPY (SELECT "id", "name", "seq" FROM "bronze"."orders") TO '${where.published}/bronze.orders.parquet' (FORMAT parquet);`,
    );
    const database = join(where.root, "ingestron.duckdb");
    expect(await execute(database, sql, ordered)).toEqual([
      { id: "1", name: "a" },
      { id: "2", name: "b" },
    ]);
    expect(
      await execute(
        ":memory:",
        "SELECT 1",
        `SELECT count(*) AS n FROM read_parquet('${where.published}/bronze.orders.parquet')`,
      ),
    ).toEqual([{ n: "2" }]);
  });
});

describe("append", () => {
  it("adds each file once, so running again changes nothing", async () => {
    const where = folder();
    await writeParquet(join(where.input, "orders/a.parquet"), "(1, 'a', 1)");
    await writeParquet(join(where.input, "orders/b.parquet"), "(2, 'b', 1)");
    const sql = runSql(project(where, "{ mode: append }"));
    const database = join(where.root, "ingestron.duckdb");
    const first = await execute(database, sql, ordered);
    expect(first).toEqual([
      { id: "1", name: "a" },
      { id: "2", name: "b" },
    ]);
    expect(await execute(database, sql, ordered)).toEqual(first);
  });
});

describe("upsert", () => {
  it("keeps the latest row per key, so running again changes nothing", async () => {
    const where = folder();
    await writeParquet(
      join(where.input, "orders/a.parquet"),
      "(1, 'old', 1), (1, 'new', 2), (2, 'b', 1)",
    );
    const sql = runSql(project(where, "{ mode: upsert, sequence_by: seq }"));
    const database = join(where.root, "ingestron.duckdb");
    const first = await execute(database, sql, ordered);
    expect(first).toEqual([
      { id: "1", name: "new" },
      { id: "2", name: "b" },
    ]);
    expect(await execute(database, sql, ordered)).toEqual(first);
  });

  it("needs the contract's primary key", () => {
    const where = folder();
    const files = project(where, "{ mode: upsert }", { "orders.yaml": contract("required: true") });
    expect(
      generate(files).result.diagnostics.map(({ code, message }) => ({ code, message })),
    ).toEqual([
      {
        code: "METHOD_CHECK",
        message: '"duckdb-table" for table "orders": upsert needs the contract\'s primaryKey.',
      },
    ]);
  });
});

describe("transforms", () => {
  it("rebuilds the transform's table from its inputs' tables", async () => {
    const where = folder();
    await writeParquet(
      join(where.input, "orders/a.parquet"),
      "(1, 'a', 1), (2, 'a', 1), (3, 'b', 1)",
    );
    const transform = [
      "apiVersion: ingestron.io/v1",
      "kind: Transform",
      "id: counts",
      "inputs: [orders]",
      'code: "SELECT name, count(*) AS n FROM {{ tables.orders }} GROUP BY name;"',
      "contract: counts",
      "",
    ].join("\n");
    const counts = [
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
    ].join("\n");
    const sql = runSql(
      project(where, "{}", { "counts.yaml": transform, "counts-contract.yaml": counts }),
    );
    expect(sql).toContain(
      'CREATE OR REPLACE TABLE "silver"."counts" AS SELECT CAST("name" AS VARCHAR) AS "name", CAST("n" AS BIGINT) AS "n" FROM (\nSELECT name, count(*) AS n FROM "bronze"."orders" GROUP BY name\n) AS "source";',
    );
    const database = join(where.root, "ingestron.duckdb");
    expect(await execute(database, sql, "SELECT name, n FROM silver.counts ORDER BY name")).toEqual(
      [
        { name: "a", n: "2" },
        { name: "b", n: "1" },
      ],
    );
  });
});

describe("environments", () => {
  it("write the same SQL apart from the paths their values give", () => {
    const one = folder();
    const two = folder();
    const files = project(one, "{}", {
      "project.yaml": `id: shop\nenvironments:\n  dev: {}\n  prod: { values: { input: "${two.input}", published: "${two.published}" } }\nvalues: { input: "${one.input}", published: "${one.published}" }\nimports: ['*.yaml']\n`,
      "platform.yaml":
        'apiVersion: ingestron.io/v1\nkind: Platform\nid: local\nsettings:\n  duckdb-table: { published: "${values.published}" }\n',
      "shop.yaml":
        'apiVersion: ingestron.io/v1\nkind: Connection\nid: shop\nconnector: files\nconnectivity: public\nsettings: { path: "${values.input}" }\n',
    });
    const sqlOf = (environment: string) =>
      generate(files, undefined, environment).files["run.sql"] ?? "";
    const normalised = (sql: string, where: typeof one) =>
      sql.replaceAll(where.input, "<in>").replaceAll(where.published, "<published>");
    const { result } = generate(files, undefined, "dev");
    expect(result.diagnostics).toEqual([]);
    const dev = sqlOf("dev");
    expect(dev).toContain(one.published);
    expect(normalised(sqlOf("prod"), two).replace("(prod)", "(dev)")).toBe(normalised(dev, one));
  });
});
