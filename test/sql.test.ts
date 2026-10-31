// The DuckDB SQL a table is written in: quoted names and text, file readers, typed columns.
import type { Column } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { literal, quote, readFiles, selectColumns } from "../src/sql.js";

const columns: Column[] = [
  { name: "id", logicalType: "integer", nullable: false },
  { name: "total", logicalType: "number", physicalName: "Total Amount", nullable: true },
];

describe("quote and literal", () => {
  it("double-quotes names and doubles a double quote", () => {
    expect(quote('my "x"')).toBe('"my ""x"""');
  });

  it("single-quotes text and doubles a single quote", () => {
    expect(literal("o'brien")).toBe("'o''brien'");
  });
});

describe("readFiles", () => {
  it("reads Parquet, quoting the path", () => {
    expect(readFiles({ location: "./my samples/o'brien.parquet", format: "parquet" })).toBe(
      "read_parquet('./my samples/o''brien.parquet')",
    );
  });

  it("names each row's file when asked", () => {
    expect(readFiles({ location: "./in/*.parquet", format: "parquet", withFile: true })).toBe(
      "read_parquet('./in/*.parquet', filename = '_ingestron_file')",
    );
  });

  it("reads CSV with its header and delimiter", () => {
    expect(
      readFiles({ location: "./in/*.csv", format: "csv", csv: { header: true, delimiter: ";" } }),
    ).toBe("read_csv('./in/*.csv', header = true, delim = ';')");
  });

  it("reads JSON", () => {
    expect(readFiles({ location: "./in/*.json", format: "json" })).toBe(
      "read_json_auto('./in/*.json')",
    );
  });
});

describe("selectColumns", () => {
  it("casts each column to its type, under its contract name", () => {
    expect(selectColumns(columns, { renamed: true, resolvedTypes: false })).toBe(
      'CAST("id" AS BIGINT) AS "id", CAST("total" AS DOUBLE) AS "total"',
    );
  });

  it("reads a column under its physicalName when the ingest did not rename it", () => {
    expect(selectColumns(columns, { renamed: false, resolvedTypes: false })).toBe(
      'CAST("id" AS BIGINT) AS "id", CAST("Total Amount" AS DOUBLE) AS "total"',
    );
  });

  it("uses the resolved type when DuckDB provides the defaults", () => {
    const money: Column[] = [
      { name: "total", logicalType: "number", type: "DECIMAL(18,2)", nullable: true },
    ];
    expect(selectColumns(money, { renamed: true, resolvedTypes: true })).toBe(
      'CAST("total" AS DECIMAL(18,2)) AS "total"',
    );
  });
});
