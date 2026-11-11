// A table with no contract, whose columns and key come from source metadata, builds as a
// table with a contract does (specification section 12.4).
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { execute, folder, generate, project, runSql, writeParquet } from "./project.js";

/** A `SourceMetadata` document of the shop's one table, with a key unless `key` is false. */
function metadata(key = true) {
  const id = `{ name: id, sourceType: int, logicalType: integer${key ? ", primaryKeyPosition: 1" : ""}, required: true }`;
  return [
    "apiVersion: ingestron.io/v1",
    "kind: SourceMetadata",
    "id: shop",
    "connection: shop",
    "tables:",
    "  - object: orders/*.parquet",
    "    captured: { at: 2026-11-12T09:30:00Z, from: catalog, file: shop.csv }",
    "    columns:",
    `      - ${id}`,
    "      - { name: name, sourceType: text, logicalType: string, required: false }",
    "      - { name: seq, sourceType: int, logicalType: integer, required: false }",
    "",
  ].join("\n");
}

/** The project with its table naming no contract, and the metadata in its place. */
function withoutContract(where: ReturnType<typeof folder>, store = "{}", key = true) {
  const files = project(where, store, { "shop.metadata.yaml": metadata(key) });
  delete files["orders.yaml"];
  files["flow.yaml"] = files["flow.yaml"]!.replace(", contract: orders", "");
  return files;
}

describe("a table with no contract", () => {
  it("loads the files typed by the metadata's columns, and publishes them", async () => {
    const where = folder();
    await writeParquet(join(where.input, "orders/a.parquet"), "(1, 'a', 1), (2, 'b', 1)");
    const files = withoutContract(where);
    expect(generate(files).result.diagnostics).toEqual([]);
    const sql = runSql(files);
    expect(sql).toContain(
      `CREATE OR REPLACE TABLE "bronze"."orders" AS SELECT CAST("id" AS BIGINT) AS "id", CAST("name" AS VARCHAR) AS "name", CAST("seq" AS BIGINT) AS "seq" FROM read_parquet('${where.input}/orders/*.parquet');`,
    );
    expect(sql).toContain(
      `COPY (SELECT "id", "name", "seq" FROM "bronze"."orders") TO '${where.published}/bronze.orders.parquet' (FORMAT parquet);`,
    );
    const database = join(where.root, "ingestron.duckdb");
    expect(await execute(database, sql, "SELECT id, name FROM bronze.orders ORDER BY id")).toEqual([
      { id: "1", name: "a" },
      { id: "2", name: "b" },
    ]);
  });

  it("upserts on the key the metadata gives", () => {
    const files = withoutContract(folder(), "{ mode: upsert, sequence_by: seq }");
    const { result, files: built } = generate(files);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(built["run.sql"]).toContain('"id"');
  });

  it("refuses upsert when neither the contract nor the metadata has a key", () => {
    const files = withoutContract(folder(), "{ mode: upsert, sequence_by: seq }", false);
    expect(generate(files).result.diagnostics.map((item) => item.message)).toContain(
      '"duckdb-table" for table "orders": upsert needs the primaryKey in the contract or the source metadata.',
    );
  });

  it("refuses a sequence column that neither the contract nor the metadata has", () => {
    const files = withoutContract(folder(), "{ mode: upsert, sequence_by: updated }");
    expect(generate(files).result.diagnostics.map((item) => item.message)).toContain(
      '"duckdb-table" for table "orders": sequence_by "updated" is not a column of the contract or the source metadata; use one of id, name, seq.',
    );
  });
});
