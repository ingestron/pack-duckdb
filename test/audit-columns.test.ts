// The audit columns the pack adds (spec/behaviour.md, "Intent"), run against DuckDB.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { execute, folder, generate, project, runSql, writeQuery } from "./project.js";

const standard = (lines: string[], store = "{}") =>
  [
    "apiVersion: ingestron.io/v1",
    "kind: Standard",
    "id: acme",
    "packs: [duckdb@2]",
    `store: { settings: { duckdb-table: ${store} } }`,
    ...lines,
    "",
  ].join("\n");

const bronzeAudit = (audit: string) =>
  standard([`layers: [{ name: bronze, audit: ${audit} }, silver, gold]`]);

const counts = {
  "counts.yaml": [
    "apiVersion: ingestron.io/v1",
    "kind: Transform",
    "id: counts",
    "inputs: [orders]",
    'code: "SELECT name, count(*) AS n FROM {{ tables.orders }} GROUP BY name;"',
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
};

describe("audit columns", () => {
  it("publishes the audit columns after the contract's, as the table holds them", async () => {
    const where = folder();
    await writeQuery(
      join(where.input, "orders/a.parquet"),
      "SELECT 1 AS id, 'a' AS name, 1 AS seq",
    );
    const sql = runSql(
      project(where, "{}", {
        "standard.yaml": bronzeAudit("[loaded_at, { value: source_file, as: file_name }]"),
      }),
    );
    const database = join(where.root, "ingestron.duckdb");
    const read = `SELECT typeof(_loaded_at) AS kind, file_name FROM read_parquet('${where.published}/bronze.orders.parquet')`;
    const rows = await execute(database, sql, read);
    expect(rows).toEqual([
      { kind: "TIMESTAMP WITH TIME ZONE", file_name: join(where.input, "orders/a.parquet") },
    ]);
    const columns = await execute(
      database,
      "",
      `SELECT string_agg(column_name, ',') AS names FROM (DESCRIBE SELECT * FROM read_parquet('${where.published}/bronze.orders.parquet'))`,
    );
    expect(columns).toEqual([{ names: "id,name,seq,_loaded_at,file_name" }]);
  });

  for (const store of ["{}", "{ mode: append }", "{ mode: upsert }"])
    it(`adds loaded_at and source_file to the rows of ${store}`, async () => {
      const where = folder();
      await writeQuery(
        join(where.input, "orders/a.parquet"),
        "SELECT 1 AS id, 'a' AS name, 1 AS seq",
      );
      const sql = runSql(
        project(where, store, {
          "standard.yaml": bronzeAudit("[loaded_at, source_file]").replace(
            "store: { settings: { duckdb-table: {} } }",
            `store: { settings: { duckdb-table: ${store} } }`,
          ),
        }),
      );
      const rows = await execute(
        join(where.root, "ingestron.duckdb"),
        sql,
        'SELECT "_source_file" AS file, "_loaded_at" IS NOT NULL AS loaded FROM "bronze"."orders"',
      );
      expect(rows).toEqual([{ file: join(where.input, "orders/a.parquet"), loaded: true }]);
    });

  it("adds audit columns to a table that already exists", async () => {
    const where = folder();
    await writeQuery(
      join(where.input, "orders/a.parquet"),
      "SELECT 1 AS id, 'a' AS name, 1 AS seq",
    );
    const database = join(where.root, "ingestron.duckdb");
    await execute(database, runSql(project(where, "{ mode: append }")), "SELECT 1");
    const sql = runSql(
      project(where, "{ mode: append }", {
        "standard.yaml": bronzeAudit("[loaded_at]").replace(
          "duckdb-table: {}",
          "duckdb-table: { mode: append }",
        ),
      }),
    );
    await writeQuery(
      join(where.input, "orders/b.parquet"),
      "SELECT 2 AS id, 'b' AS name, 1 AS seq",
    );
    const rows = await execute(
      database,
      sql,
      'SELECT id, "_loaded_at" IS NULL AS missing FROM "bronze"."orders" ORDER BY id',
    );
    expect(rows).toEqual([
      { id: "1", missing: true },
      { id: "2", missing: false },
    ]);
  });

  it("adds loaded_at to a transform's table, but source_file only to a flow's", () => {
    const where = folder();
    const files = project(where, "{}", {
      ...counts,
      "standard.yaml": standard(["audit: [loaded_at, source_file]"]),
    });
    const { result, files: built } = generate(files);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const transform = built["tables/silver.counts.sql"]!;
    expect(transform).toContain('now() AS "_loaded_at" FROM (\n');
    expect(transform).not.toContain("_source_file");
    expect(transform).toContain('"n", "_loaded_at" FROM "silver"."counts"');
    expect(built["tables/bronze.orders.sql"]).toContain('"_ingestron_file" AS "_source_file"');
  });

  it("keeps the append mode's _ingestron_file apart from the audit columns", () => {
    const where = folder();
    const sql = runSql(
      project(where, "{ mode: append }", {
        "standard.yaml": standard(["audit: [source_file]"], "{ mode: append }"),
      }),
    );
    expect(sql).toContain('"_ingestron_file" AS "_source_file", "_ingestron_file" FROM');
    expect(sql).not.toMatch(/COPY \(SELECT[^)]*_ingestron_file/);
  });

  it("refuses an audit column named like a column of the table", () => {
    const where = folder();
    const { result } = generate(
      project(where, "{}", {
        "standard.yaml": bronzeAudit("[{ value: loaded_at, as: name }]"),
      }),
    );
    expect(
      result.diagnostics.filter((item) => item.severity === "error").map((item) => item.message),
    ).toEqual([
      '"duckdb-table" for table "orders": the audit column "name" is already a column of the table.',
    ]);
  });

  it("leaves a table without audit intent as it was", () => {
    const where = folder();
    expect(runSql(project(where))).not.toContain("now()");
  });
});
