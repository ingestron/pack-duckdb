// What the pack does with contracts.
import { describe, expect, it } from "vitest";
import { duckdb } from "../../src/index.js";
import { folder, generate, project } from "../project.js";

describe("contract", () => {
  it("types the table's columns and keys from the contract, and checks rows from it", () => {
    expect(duckdb.contract?.["schema.*.properties.*.logicalType"]).toMatchObject({ use: "used" });
    expect(duckdb.contract?.["schema.*.properties.*.primaryKey"]).toMatchObject({ use: "used" });
    for (const path of [
      "schema.*.quality",
      "schema.*.properties.*.quality",
      "schema.*.properties.*.required",
      "schema.*.properties.*.logicalTypeOptions",
      "schema.*.properties.*.unique",
    ])
      expect(duckdb.contract?.[path], path).toMatchObject({ use: "used" });
    expect(duckdb.contract?.["schema.*.quality"]).not.toHaveProperty("needs");
  });

  it("leaves a project's contract fields without warnings", () => {
    const { result } = generate(project(folder()));
    expect(result.diagnostics).toEqual([]);
  });
});
