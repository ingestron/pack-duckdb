// Table checks counted with DuckDB (spec/behaviour.md, "Table checks"): duplicates over several
// columns and over the whole row, where a row with a null part is a value of its own.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contract, folder, project, runPrinting, runSql, writeParquet } from "../project.js";

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

/** The rows the duplicateValues check printed as failing. */
async function failingRows(properties?: string): Promise<unknown> {
  const where = folder();
  await writeParquet(
    join(where.input, "orders/a.parquet"),
    "(1, 'a', 1), (1, 'a', 2), (1, 'b', 1), (2, NULL, 1), (2, NULL, 1)",
  );
  const files = project(where, "{}", {
    "standard.yaml": standard,
    "orders.yaml": duplicates(properties),
  });
  const run = await runPrinting(join(where.root, "ingestron.duckdb"), runSql(files));
  expect(run.error).toBeUndefined();
  return run.printed.flat().find((row) => String(row.check).includes("duplicate"))?.failing_rows;
}

describe("duplicateValues", () => {
  it("counts duplicates of several columns as one value, a null part included", async () => {
    // Distinct: (1, a), (1, b) and (2, NULL), which counts as a value: 5 - 3.
    expect(await failingRows("[id, name]")).toBe("2");
  });

  it("counts duplicates of the whole row, over the contract's columns", async () => {
    // Distinct: (1, a, 1), (1, a, 2), (1, b, 1) and (2, NULL, 1): 5 - 4.
    expect(await failingRows()).toBe("1");
  });

  it("counts duplicates of one column, leaving nulls out", async () => {
    // Distinct ids: 1 and 2: 5 - 2.
    expect(await failingRows("[id]")).toBe("3");
  });
});
