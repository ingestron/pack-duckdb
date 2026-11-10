// What duckdb-table cannot do with a table's quality and cleansing (spec/behaviour.md, "Checks"):
// a flow's or transform's own expectations where its layer does not check rows, and a time zone
// conversion of a column that is already a moment in time.
import type { ResolvedTable } from "@ingestron/definitions";
import { hasZone } from "../sql/index.js";

/** A flow's or transform's own expectations where the layer does not check rows, so DuckDB would not. */
export function uncheckedProblems(table: ResolvedTable): string[] {
  if (Array.isArray(table.does) && table.does.includes("check")) return [];
  return table.expectations
    .filter((expectation) => expectation.from === "definition")
    .map(
      (expectation) =>
        `DuckDB checks rows only in a layer whose does lists check, so the expectation "${expectation.name}" would not be checked; add check to the layer's does, or remove it`,
    );
}

/** Columns typed with a time zone that the table converts: a moment has no wall-clock zone. */
export function zoneProblems(table: ResolvedTable): string[] {
  const columns = table.cleanse?.columns ?? {};
  return table.contract.columns
    .filter((column) => columns[column.name]?.timezone && hasZone(column.type ?? ""))
    .map(
      (column) =>
        `the column "${column.name}" is ${column.type}, a moment in time with no wall-clock zone to convert; convert TIMESTAMP columns only`,
    );
}
