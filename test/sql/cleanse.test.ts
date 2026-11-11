// Each cleansing operation as DuckDB SQL (spec/behaviour.md, "Cleansing"), applied in the
// model's order to the column cast to its type.
import type { Column, ColumnCleanse } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { cleansed } from "../../src/sql/cleanse.js";
import { execute } from "../project.js";

const text: Column = { name: "country", logicalType: "string", nullable: true };
const x = 'CAST("country" AS VARCHAR)';

describe("a column's cleansing", () => {
  it("applies each operation to the one before, in the model's order", () => {
    const operations: ColumnCleanse = {
      trim: true,
      empty: true,
      map: { UK: "GB", "-": null },
      case: "upper",
      default: "GB",
    };
    const trimmed = `nullif(trim(${x}), '')`;
    expect(cleansed(operations, text, x)).toBe(
      `coalesce(upper(CASE ${trimmed} WHEN 'UK' THEN 'GB' WHEN '-' THEN NULL ELSE ${trimmed} END), 'GB')`,
    );
  });

  it("converts a timestamp from one zone to another with AT TIME ZONE", () => {
    const column: Column = { name: "at", logicalType: "timestamp", nullable: true };
    expect(cleansed({ timezone: { from: "Europe/London", to: "UTC" } }, column, '"at"')).toBe(
      `("at" AT TIME ZONE 'Europe/London') AT TIME ZONE 'UTC'`,
    );
  });

  it("writes each value for the column's logical type", () => {
    const of = (logicalType: string, value: unknown) =>
      cleansed({ default: value }, { name: "c", logicalType, nullable: true }, '"c"');
    expect(of("integer", 0)).toBe(`coalesce("c", 0)`);
    expect(of("number", "1.5")).toBe(`coalesce("c", 1.5)`);
    expect(of("boolean", false)).toBe(`coalesce("c", FALSE)`);
    expect(of("date", "2026-01-01")).toBe(`coalesce("c", DATE '2026-01-01')`);
    expect(of("timestamp", "2026-01-01 00:00:00")).toBe(
      `coalesce("c", TIMESTAMP '2026-01-01 00:00:00')`,
    );
    expect(of("string", "o'k")).toBe(`coalesce("c", 'o''k')`);
    expect(
      cleansed({ map: { "-1": 0 } }, { name: "s", logicalType: "integer", nullable: true }, '"s"'),
    ).toBe(`CASE "s" WHEN -1 THEN 0 ELSE "s" END`);
  });

  it("gives DuckDB's values", async () => {
    const operations: ColumnCleanse = { trim: true, empty: true, map: { UK: "GB" }, case: "upper" };
    const rows = await execute(
      ":memory:",
      "SELECT 1",
      `SELECT ${cleansed(operations, text, '"country"')} AS c FROM (VALUES (' uk '), ('  '), (' UK '), (NULL)) AS t("country")`,
    );
    expect(rows.map((row) => row.c)).toEqual(["UK", null, "GB", null]);
  });
});
