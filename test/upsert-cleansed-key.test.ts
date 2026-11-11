// An upsert whose key is cleansed (spec/behaviour.md, "Each table"): rows that cleansing gives
// one key are made unique on the cleansed key before INSERT OR REPLACE, so the insert never
// holds a key twice and every run keeps the same row; run with DuckDB.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { execute, folder, project, runSql, writeQuery } from "./project.js";

/** The orders contract keyed by its text column `name`. */
const byName = [
  "apiVersion: v3.1.0",
  "kind: DataContract",
  "id: orders",
  "version: 1.0.0",
  "status: active",
  "schema:",
  "  - name: orders",
  "    logicalType: object",
  "    properties:",
  "      - { name: id, logicalType: integer }",
  "      - { name: name, logicalType: string, primaryKey: true }",
  "      - { name: seq, logicalType: integer }",
  "",
].join("\n");

const trimmed = "cleanse: { columns: { name: { trim: true } } }";

const rows = "SELECT id, name FROM silver.latest ORDER BY name";

const transform = (extra: string) =>
  [
    "apiVersion: ingestron.io/v1",
    "kind: Transform",
    "id: latest",
    "inputs: [orders]",
    `code: "SELECT id, name, seq FROM {{ tables.orders }}"`,
    "contract: orders",
    "history: latest",
    extra,
    "",
  ].join("\n");

describe("an upsert whose key is cleansed", () => {
  it("keeps one row per cleansed key in a flow's table: the last by file, then every column", async () => {
    const where = folder();
    await writeQuery(
      join(where.input, "orders/a.parquet"),
      "SELECT * FROM (VALUES (1, ' a', 1), (2, 'a', 1), (3, 'b', 1)) t(id, name, seq)",
    );
    const files = project(where, "{ mode: upsert }", {
      "orders.yaml": byName,
      "flow.yaml": `apiVersion: ingestron.io/v1\nkind: Flow\nid: shop\nsource: shop\ntables:\n  orders: { object: orders/*.parquet, contract: orders, ${trimmed} }\n`,
    });
    const sql = runSql(files);
    expect(sql).toContain(
      'AS "rows" QUALIFY row_number() OVER (PARTITION BY "name" ORDER BY "_ingestron_file" DESC, "id" DESC, "name" DESC, "seq" DESC) = 1',
    );
    const database = join(where.root, "ingestron.duckdb");
    const kept = "SELECT id, name FROM bronze.orders ORDER BY name";
    expect(await execute(database, sql, kept)).toEqual([
      { id: "2", name: "a" },
      { id: "3", name: "b" },
    ]);
    // Running again keeps the same rows.
    expect(await execute(database, sql, kept)).toEqual([
      { id: "2", name: "a" },
      { id: "3", name: "b" },
    ]);
  });

  it("keeps one row per cleansed key in a transform's table, the last by sequence", async () => {
    const where = folder();
    await writeQuery(
      join(where.input, "orders/a.parquet"),
      "SELECT * FROM (VALUES (1, ' a', 2), (2, 'a', 1), (3, 'b', 1)) t(id, name, seq)",
    );
    const files = project(where, "{}", {
      "orders.yaml": byName
        .replace("id: orders", "id: orders")
        .replace(
          "      - { name: name, logicalType: string, primaryKey: true }",
          "      - { name: name, logicalType: string }",
        ),
      "latest.yaml": transform(`sequence: seq\n${trimmed}`),
      "latest-contract.yaml": byName
        .replace("id: orders", "id: latest")
        .replace("  - name: orders", "  - name: latest"),
    });
    files["latest.yaml"] = files["latest.yaml"]!.replace("contract: orders", "contract: latest");
    const sql = runSql(files);
    expect(sql).toContain(
      'AS "rows" QUALIFY row_number() OVER (PARTITION BY "name" ORDER BY "seq" DESC, "id" DESC, "name" DESC, "seq" DESC) = 1',
    );
    const database = join(where.root, "ingestron.duckdb");
    expect(await execute(database, sql, rows)).toEqual([
      { id: "1", name: "a" },
      { id: "3", name: "b" },
    ]);
  });

  it("keeps one row for two UTC times that are one London time in the hour the clocks go back", async () => {
    const where = folder();
    await writeQuery(
      join(where.input, "orders/a.parquet"),
      "SELECT * FROM (VALUES (1, TIMESTAMP '2026-10-25 00:30:00'), (2, TIMESTAMP '2026-10-25 01:30:00'), (3, TIMESTAMP '2026-10-25 03:00:00')) t(id, seen)",
    );
    const byTime = byName
      .replace("      - { name: name, logicalType: string, primaryKey: true }\n", "")
      .replace(
        "      - { name: seq, logicalType: integer }",
        "      - { name: seen, logicalType: timestamp, primaryKey: true }",
      );
    const files = project(where, "{ mode: upsert }", {
      "orders.yaml": byTime,
      "flow.yaml":
        "apiVersion: ingestron.io/v1\nkind: Flow\nid: shop\nsource: shop\ntables:\n  orders: { object: orders/*.parquet, contract: orders, cleanse: { columns: { seen: { timezone: { from: UTC, to: Europe/London } } } } }\n",
    });
    const sql = runSql(files);
    expect(sql).toContain('AS "rows" QUALIFY row_number() OVER (PARTITION BY "seen" ORDER BY');
    const database = join(where.root, "ingestron.duckdb");
    expect(
      await execute(
        database,
        sql,
        "SELECT id, strftime(seen, '%Y-%m-%d %H:%M') AS seen FROM bronze.orders ORDER BY seen",
      ),
    ).toEqual([
      { id: "2", seen: "2026-10-25 01:30" },
      { id: "3", seen: "2026-10-25 03:00" },
    ]);
  });

  it("leaves an upsert whose key is not cleansed as it was", () => {
    const sql = runSql(project(folder(), "{ mode: upsert }"));
    expect(sql).not.toContain('AS "rows" QUALIFY');
  });
});
