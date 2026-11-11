// The quality and cleansing paths of the pack's intent (spec/behaviour.md, "Coverage"): checks
// only where the layer's does lists check, quarantine only where it lists quarantine, the rest
// wherever the model gives them.
import { intentUseOf } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { duckdb } from "../../src/index.js";

describe("the pack's quality and cleansing coverage", () => {
  it("checks rows only in a layer whose does lists check, and quarantines where it lists quarantine", () => {
    const paths = [
      ...["notNull", "in", "notIn", "pattern", "length", "range", "multipleOf", "items"].map(
        (kind) => ["quality.rules", kind],
      ),
      ...["warn", "drop", "fail"].map((action) => ["quality.actions", action]),
      ["quality.table-checks", "true"],
    ];
    for (const [path, value] of paths)
      expect(intentUseOf(duckdb, path!, value), `${path}=${value}`).toMatchObject({
        use: "used",
        onlyWhere: "check",
        status: { level: "ga", checked: "2026-11-10" },
      });
    expect(intentUseOf(duckdb, "quality.quarantine", "true")).toMatchObject({
      use: "used",
      onlyWhere: "quarantine",
    });
  });

  it("keeps results, cleanses and deduplicates wherever the model says", () => {
    for (const path of [
      "quality.results",
      "cleanse.trim",
      "cleanse.empty",
      "cleanse.map",
      "cleanse.case",
      "cleanse.default",
      "cleanse.timezone",
      "deduplicate",
    ]) {
      const use = intentUseOf(duckdb, path, "true");
      expect(use, path).toMatchObject({
        use: "used",
        status: { level: "ga", checked: "2026-11-10" },
      });
      expect(use, path).not.toHaveProperty("onlyWhere");
    }
  });
});
