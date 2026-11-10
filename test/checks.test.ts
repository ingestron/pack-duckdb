// Checks by layer (spec/behaviour.md, "Quality and cleansing"): none where the layer's `does`
// does not list check, and the SQL is as before; row checks, table checks and quarantine
// where it does, run with DuckDB.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  contract,
  execute,
  folder,
  generate,
  project,
  runPrinting,
  runSql,
  writeParquet,
} from "./project.js";

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

/** The orders contract with a required name, a table check and a unique id. */
const checked = (tableCheck = "{ type: library, metric: rowCount, mustBeGreaterThan: 0 }") =>
  contract()
    .replace(
      "{ name: name, logicalType: string }",
      "{ name: name, logicalType: string, required: true }",
    )
    .replace("    properties:\n", `    quality:\n      - ${tableCheck}\n    properties:\n`);

const flowWith = (table: string) =>
  `apiVersion: ingestron.io/v1\nkind: Flow\nid: shop\nsource: shop\ntables:\n  orders: { object: orders/*.parquet, contract: orders${table} }\n`;

const ordered = "SELECT id, name FROM bronze.orders ORDER BY id";

describe("a layer whose does does not list check", () => {
  it("builds the table as before, and reports each check as not applied", () => {
    const where = folder();
    const plain = generate(project(where));
    const files = project(where, "{}", { "orders.yaml": checked() });
    const { result, files: built } = generate(files);
    expect(built["run.sql"]).toBe(plain.files["run.sql"]);
    expect(result.diagnostics.map(({ code, message, hint }) => ({ code, message, hint }))).toEqual([
      {
        code: "NOT_APPLIED",
        message:
          "The notNull rule isn't applied on duckdb: it is applied only in a layer whose does lists check.",
        hint: "Add `check` to the layer's `does` to apply it here.",
      },
      {
        code: "NOT_APPLIED",
        message:
          "The table check isn't applied on duckdb: it is applied only in a layer whose does lists check.",
        hint: "Add `check` to the layer's `does` to apply it here.",
      },
    ]);
  });

  it("refuses a flow's own expectations, which would not be checked", () => {
    const where = folder();
    const files = project(where, "{}", {
      "flow.yaml": flowWith(", expectations: [{ name: positive, check: id > 0, action: fail }]"),
    });
    expect(generate(files).result.diagnostics.map(({ message }) => message)).toContain(
      '"duckdb-table" for table "orders": DuckDB checks rows only in a layer whose does lists check, so the expectation "positive" would not be checked; add check to the layer\'s does, or remove it.',
    );
  });
});

describe("a layer whose does lists check", () => {
  const checking = (store = "{}", lines: string[] = [], does = "[check]") =>
    standard([`layers: [{ name: bronze, does: ${does} }, silver, gold]`, ...lines], store);

  it("runs a flow's own expectations", async () => {
    const where = folder();
    await writeParquet(join(where.input, "orders/a.parquet"), "(1, 'a', 1), (-2, 'b', 1)");
    const files = project(where, "{}", {
      "standard.yaml": checking(),
      "flow.yaml": flowWith(", expectations: [{ name: positive, check: id > 0, action: drop }]"),
    });
    const database = join(where.root, "ingestron.duckdb");
    const run = await runPrinting(database, runSql(files));
    expect(run.error).toBeUndefined();
    expect(run.printed.flat()).toContainEqual({
      table: "bronze.orders",
      check: "positive",
      action: "drop",
      failing_rows: "1",
      passed: false,
    });
    expect(await execute(database, "SELECT 1", ordered)).toEqual([{ id: "1", name: "a" }]);
  });

  it("counts table checks after the table is built, with no manage.checks: warn prints, fail stops", async () => {
    const where = folder();
    await writeParquet(join(where.input, "orders/a.parquet"), "(1, 'a', 1), (1, 'b', 2)");
    const unique =
      "{ type: library, metric: duplicateValues, arguments: { properties: [id] }, mustBe: 0 }";
    // DuckDB runs table checks itself: the Platform turns nothing on (no manage.checks).
    const warned = project(where, "{}", {
      "standard.yaml": checking(),
      "orders.yaml": checked(unique),
    });
    expect(warned["platform.yaml"]).not.toContain("manage");
    const database = join(where.root, "ingestron.duckdb");
    const run = await runPrinting(database, runSql(warned));
    expect(run.error).toBeUndefined();
    expect(run.printed.flat()).toContainEqual(
      expect.objectContaining({
        table: "bronze.orders",
        action: "warn",
        failing_rows: "1",
        passed: false,
      }),
    );
    const failed = project(where, "{}", {
      "standard.yaml": checking("{}", ["quality: { default: fail }"]),
      "orders.yaml": checked(unique),
    });
    const stopped = await runPrinting(join(where.root, "other.duckdb"), runSql(failed));
    expect(stopped.error).toMatch(
      /The table check ".+" failed on bronze\.orders, so nothing is published\./,
    );
  });

  it("quarantines an append table's failing rows once, so running again changes nothing", async () => {
    const where = folder();
    await writeParquet(join(where.input, "orders/a.parquet"), "(1, 'a', 1), (2, NULL, 1)");
    await writeParquet(join(where.input, "orders/b.parquet"), "(3, NULL, 1)");
    const files = project(where, "{ mode: append }", {
      "standard.yaml": checking(
        "{ mode: append }",
        ["quality: { required: drop, quarantine: true }"],
        "[check, quarantine]",
      ),
      "orders.yaml": checked(),
    });
    const sql = runSql(files);
    const database = join(where.root, "ingestron.duckdb");
    expect((await runPrinting(database, sql)).error).toBeUndefined();
    // Running again changes nothing.
    expect((await runPrinting(database, sql)).error).toBeUndefined();
    expect(await execute(database, "SELECT 1", ordered)).toEqual([{ id: "1", name: "a" }]);
    expect(
      await execute(
        database,
        "SELECT 1",
        "SELECT id, _failed_checks FROM bronze.orders_quarantine ORDER BY id",
      ),
    ).toEqual([
      { id: "2", _failed_checks: ["name_not_null"] },
      { id: "3", _failed_checks: ["name_not_null"] },
    ]);
  });

  it("checks an upsert table's incoming rows, keeping the latest row per key", async () => {
    const where = folder();
    await writeParquet(
      join(where.input, "orders/a.parquet"),
      "(1, 'old', 1), (1, 'new', 2), (2, NULL, 1)",
    );
    const files = project(where, "{ mode: upsert, sequence_by: seq }", {
      "standard.yaml": checking("{ mode: upsert, sequence_by: seq }", [
        "quality: { required: drop }",
      ]),
      "orders.yaml": checked(),
    });
    const sql = runSql(files);
    const database = join(where.root, "ingestron.duckdb");
    expect((await runPrinting(database, sql)).error).toBeUndefined();
    // Running again changes nothing.
    expect((await runPrinting(database, sql)).error).toBeUndefined();
    expect(await execute(database, "SELECT 1", ordered)).toEqual([{ id: "1", name: "new" }]);
  });
});
