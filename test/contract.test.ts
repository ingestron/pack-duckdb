// What the pack does with contracts, and that it asks nothing of a platform team.
import { describe, expect, it } from "vitest";
import { duckdb } from "../src/index.js";
import { folder, generate, project } from "./project.js";

describe("contract", () => {
  it("types the table's columns and keys from the contract, and checks no rows yet", () => {
    expect(duckdb.contract?.["schema.*.properties.*.logicalType"]).toMatchObject({ use: "used" });
    expect(duckdb.contract?.["schema.*.properties.*.primaryKey"]).toMatchObject({ use: "used" });
    expect(duckdb.contract?.["schema.*.quality"]).toEqual({
      use: "not-yet",
      reason: "DuckDB tables check no rows yet.",
    });
  });

  it("leaves a project's contract fields without warnings", () => {
    const { result } = generate(project(folder()));
    expect(result.diagnostics).toEqual([]);
  });

  it("asks nothing of a platform team: DuckDB runs where you start it", () => {
    expect(duckdb.request).toBeUndefined();
  });
});
