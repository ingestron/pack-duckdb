// `history: latest` on a transform's table: rows are upserted by key, and rows the query no
// longer returns stay (spec/behaviour.md, "Intent").
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { execute, folder, generate, project, runSql, writeQuery } from "./project.js";

const transform = (extra: string) =>
  [
    "apiVersion: ingestron.io/v1",
    "kind: Transform",
    "id: latest",
    "inputs: [orders]",
    `code: "SELECT id, name, seq FROM {{ tables.orders }};"`,
    "contract: latest",
    extra,
    "",
  ].join("\n");

const contractOf = (key: string) =>
  [
    "apiVersion: v3.1.0",
    "kind: DataContract",
    "id: latest",
    "version: 1.0.0",
    "status: active",
    "schema:",
    "  - name: latest",
    "    logicalType: object",
    "    properties:",
    `      - { name: id, logicalType: integer, ${key} }`,
    "      - { name: name, logicalType: string }",
    "      - { name: seq, logicalType: integer }",
    "",
  ].join("\n");

const files = (where: ReturnType<typeof folder>, extra: string, key = "primaryKey: true") =>
  project(where, "{}", {
    "latest.yaml": transform(extra),
    "latest-contract.yaml": contractOf(key),
  });

describe("history: latest on a transform", () => {
  it("creates the table with its key, then upserts the query's rows", () => {
    const sql = runSql(files(folder(), "history: latest"));
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS "silver"."latest" ("id" BIGINT, "name" VARCHAR, "seq" BIGINT, PRIMARY KEY ("id"));',
    );
    expect(sql).toContain(
      'INSERT OR REPLACE INTO "silver"."latest" BY NAME SELECT CAST("id" AS BIGINT) AS "id", CAST("name" AS VARCHAR) AS "name", CAST("seq" AS BIGINT) AS "seq" FROM (\nSELECT id, name, seq FROM "bronze"."orders"\n) AS "source";',
    );
    expect(sql).not.toContain('CREATE OR REPLACE TABLE "silver"."latest"');
  });

  it("orders a key's rows by `sequence`", () => {
    const sql = runSql(files(folder(), "history: latest\nsequence: seq"));
    expect(sql).toContain(
      'AS "source" QUALIFY row_number() OVER (PARTITION BY "id" ORDER BY "seq" DESC) = 1;',
    );
  });

  it("keeps rows the query no longer returns, and takes the latest by sequence", async () => {
    const where = folder();
    const database = join(where.root, "ingestron.duckdb");
    const sql = runSql(files(where, "history: latest\nsequence: seq"));
    const rows = "SELECT id, name, seq FROM silver.latest ORDER BY id";
    await writeQuery(
      join(where.input, "orders/a.parquet"),
      "SELECT * FROM (VALUES (1, 'old', 1), (1, 'new', 2), (2, 'b', 1)) t(id, name, seq)",
    );
    expect(await execute(database, sql, rows)).toEqual([
      { id: "1", name: "new", seq: "2" },
      { id: "2", name: "b", seq: "1" },
    ]);
    await writeQuery(
      join(where.input, "orders/a.parquet"),
      "SELECT * FROM (VALUES (1, 'newer', 3)) t(id, name, seq)",
    );
    expect(await execute(database, sql, rows)).toEqual([
      { id: "1", name: "newer", seq: "3" },
      { id: "2", name: "b", seq: "1" },
    ]);
  });

  it("is refused without a primary key, as for upsert", () => {
    const { result } = generate(files(folder(), "history: latest", "required: true"));
    expect(
      result.diagnostics.filter((item) => item.severity === "error").map((item) => item.message),
    ).toEqual(['"duckdb-table" for table "latest": upsert needs the contract\'s primaryKey.']);
  });

  it("leaves a transform without history as it was", () => {
    const sql = runSql(files(folder(), ""));
    expect(sql).toContain('CREATE OR REPLACE TABLE "silver"."latest" AS SELECT');
  });
});
