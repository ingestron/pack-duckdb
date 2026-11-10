// Table checks counted with DuckDB (spec/behaviour.md, "Table checks"): duplicates over several
// columns and over the whole row, where a row with a null part is left out of the distinct
// count, as Databricks and Synapse leave it out.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  contract,
  folder,
  project,
  runPrinting,
  runSql,
  writeParquet,
  writeQuery,
} from "../project.js";

const standard = [
  "apiVersion: ingestron.io/v1",
  "kind: Standard",
  "id: acme",
  "packs: [duckdb@2]",
  "layers: [{ name: bronze, does: [check] }, silver, gold]",
  "",
].join("\n");

/** The orders contract with a duplicateValues rule over the properties given, or the whole row. */
const duplicates = (properties?: string) =>
  contract().replace(
    "    properties:\n",
    `    quality:\n      - { type: library, metric: duplicateValues${properties ? `, arguments: { properties: ${properties} }` : ""}, mustBe: 0 }\n    properties:\n`,
  );

const rows = "(1, 'a', 1), (1, 'a', 2), (1, 'b', 1), (2, NULL, 1), (2, NULL, 1)";

/** The rows the duplicateValues check printed as failing. */
async function failingRows(properties?: string): Promise<unknown> {
  const where = folder();
  await writeParquet(join(where.input, "orders/a.parquet"), rows);
  return failing(where, duplicates(properties));
}

/** Runs the project with the contract given, and the failing rows of its duplicateValues check. */
async function failing(where: ReturnType<typeof folder>, orders: string): Promise<unknown> {
  const files = project(where, "{}", { "standard.yaml": standard, "orders.yaml": orders });
  const run = await runPrinting(join(where.root, "ingestron.duckdb"), runSql(files));
  expect(run.error).toBeUndefined();
  return run.printed.flat().find((row) => String(row.check).includes("duplicate"))?.failing_rows;
}

describe("duplicateValues", () => {
  it("counts duplicates of several columns, a row with a null part among them", async () => {
    // Distinct, with no null part: (1, a) and (1, b): 5 - 2.
    expect(await failingRows("[id, name]")).toBe("3");
  });

  it("counts duplicates of the whole row, over the contract's columns", async () => {
    // Distinct, with no null part: (1, a, 1), (1, a, 2) and (1, b, 1): 5 - 3.
    expect(await failingRows()).toBe("2");
  });

  it("counts duplicates of one column, leaving nulls out", async () => {
    // Distinct ids: 1 and 2: 5 - 2.
    expect(await failingRows("[id]")).toBe("3");
  });

  it("counts the whole row when a column is named rows", async () => {
    const where = folder();
    const query = `SELECT * FROM (VALUES ${rows}) t(id, "rows", seq)`;
    await writeQuery(join(where.input, "orders/a.parquet"), query);
    const orders = duplicates().replace("{ name: name,", "{ name: rows,");
    // As the whole row above, not the distinct values of the column rows (a and b: 5 - 2).
    expect(await failing(where, orders)).toBe("2");
  });

  it("counts the whole row of a contract with one column", async () => {
    const where = folder();
    const query = "SELECT * FROM (VALUES (1), (1), (2), (NULL)) t(id)";
    await writeQuery(join(where.input, "orders/a.parquet"), query);
    const orders = duplicates()
      .replace("      - { name: name, logicalType: string }\n", "")
      .replace("      - { name: seq, logicalType: integer }\n", "");
    // Distinct, with no null: 1 and 2: 4 - 2.
    expect(await failing(where, orders)).toBe("2");
  });
});
