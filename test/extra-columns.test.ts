// Columns the landed files carry beyond the contract (such as ADF's audit
// columns) are kept in the table and published, typed by their logicalType.
import { join } from "node:path";
import type { Pack } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { duckdb } from "../src/index.js";
import { execute, folder, generate, project, writeQuery } from "./project.js";

/** Lands files under the input folder; with `audit`, says they carry two audit columns. */
const lander = (input: string, audit: boolean): Pack => ({
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
      output: () => ({
        location: join(input, "orders/*.parquet"),
        format: "parquet",
        loads: "add",
        ...(audit && {
          columns: [
            { name: "_loaded_at", logicalType: "timestamp", nullable: false },
            { name: "_run_id", logicalType: "string", nullable: false },
          ],
        }),
      }),
    },
  },
  build: () => ({}),
});

const landed = (where: ReturnType<typeof folder>, audit: boolean, store = "{}") => {
  const files = project(where, store, {
    "standard.yaml": `apiVersion: ingestron.io/v1\nkind: Standard\nid: acme\npacks: [duckdb@1, lander@1]\nstore: { settings: { duckdb-table: ${store} } }\n`,
    "flow.yaml":
      "apiVersion: ingestron.io/v1\nkind: Flow\nid: shop\nsource: shop\ningest: { uses: land }\ntables:\n  orders: { object: orders, contract: orders }\n",
  });
  const { result, files: built } = generate(files, [duckdb, lander(where.input, audit)]);
  expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  return built["run.sql"]!;
};

describe("extra columns the landed files carry", () => {
  for (const store of ["{}", "{ mode: append }", "{ mode: upsert }"])
    it(`are kept typed and published (${store})`, async () => {
      const where = folder();
      await writeQuery(
        join(where.input, "orders/a.parquet"),
        "SELECT 1 AS id, 'a' AS name, 1 AS seq, '2026-11-02T03:43:39.1234567Z' AS _loaded_at, 'run-1' AS _run_id",
      );
      const sql = landed(where, true, store);
      const rows = await execute(
        join(where.root, "ingestron.duckdb"),
        sql,
        'SELECT typeof(_loaded_at) AS kind, CAST(_loaded_at AS VARCHAR) AS at, _run_id FROM "bronze"."orders"',
      );
      expect(rows).toEqual([
        { kind: "TIMESTAMP", at: "2026-11-02 03:43:39.123456", _run_id: "run-1" },
      ]);
      expect(sql).toContain('"_loaded_at", "_run_id" FROM "bronze"."orders") TO');
    });

  it("leave run.sql as it was when none are declared", () => {
    const where = folder();
    expect(landed(where, false)).not.toContain("_loaded_at");
  });
});
