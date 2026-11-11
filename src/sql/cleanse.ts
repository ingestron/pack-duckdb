// Cleansing and deduplicate as DuckDB SQL (spec/behaviour.md, "Cleansing" and "Deduplicate"):
// each column cast to its type, then cleansed in the model's order, in the table's SELECT.
import type { Column, ColumnCleanse, ResolvedTable } from "@ingestron/definitions";
import { literal, quote } from "./sql.js";

/** A number column's value: a number, or text that reads as one. */
const numeric = (item: unknown, text: string) =>
  typeof item === "number" || /^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(text) ? text : literal(text);

/** How each logical type writes a value, given the value and its text. */
const writers: Record<string, (item: unknown, text: string) => string> = {
  string: (_item, text) => literal(text),
  integer: numeric,
  number: numeric,
  boolean: (_item, text) =>
    text === "true" || text === "false" ? text.toUpperCase() : literal(text),
  date: (_item, text) => `DATE ${literal(text)}`,
  timestamp: (_item, text) => `TIMESTAMP ${literal(text)}`,
};

/** A value written for the column's logical type; a `map` key, which is text, too. */
function literalOf(item: unknown, column: Column): string {
  if (item === null) return "NULL";
  const text = String(item);
  const type = column.logicalType ?? "";
  const writer = Object.hasOwn(writers, type) ? writers[type] : undefined;
  if (writer) return writer(item, text);
  if (typeof item === "number") return text;
  if (typeof item === "boolean") return text.toUpperCase();
  return literal(text);
}

/**
 * The column, read as `start`, with each of its cleansing operations applied in the model's
 * order.
 * @example cleansed({ trim: true }, column, '"name"') // 'trim("name")'
 */
export function cleansed(operations: ColumnCleanse, column: Column, start: string): string {
  const value = (item: unknown) => literalOf(item, column);
  let text = start;
  if (operations.timezone) {
    const { from, to } = operations.timezone;
    text = `(${text} AT TIME ZONE ${literal(from)}) AT TIME ZONE ${literal(to)}`;
  }
  if (operations.trim) text = `trim(${text})`;
  if (operations.empty) text = `nullif(${text}, '')`;
  if (operations.map) {
    const cases = Object.entries(operations.map).map(
      ([key, to]) => `WHEN ${value(key)} THEN ${value(to)}`,
    );
    text = `CASE ${text} ${cases.join(" ")} ELSE ${text} END`;
  }
  if (operations.case) text = `${operations.case}(${text})`;
  if (operations.default !== undefined) text = `coalesce(${text}, ${value(operations.default)})`;
  return text;
}

/** The column's expression, cleansed when the table cleanses it. */
export function cleansedColumn(table: ResolvedTable, column: Column, start: string): string {
  const operations = table.cleanse?.columns[column.name];
  return operations ? cleansed(operations, column, start) : start;
}

/** True for a column type that holds a moment in time, which has no wall-clock zone to convert. */
export function hasZone(type: string): boolean {
  return /^(TIMESTAMPTZ|TIMESTAMP\s+WITH\s+TIME\s+ZONE)$/i.test(type.trim());
}

/**
 * The rows, one per primary key when the table deduplicates: a `SELECT` of their own, so the
 * window reads the columns as cast and cleansed, then `QUALIFY`. `file` orders a flow's rows by
 * the file they came from, last first, after the `order_by` columns; it is left out of the result.
 */
export function deduplicated(table: ResolvedTable, rows: string, file?: string): string {
  const deduplicate = table.cleanse?.deduplicate;
  if (!deduplicate) return rows;
  const keys = table.contract.primaryKey.map(quote).join(", ");
  const order = [...deduplicate.orderBy, ...(file ? [file] : [])]
    .map((column) => `${quote(column)} DESC`)
    .join(", ");
  const all = file ? `* EXCLUDE (${quote(file)})` : "*";
  return `SELECT ${all} FROM (${rows}) AS "rows" QUALIFY row_number() OVER (PARTITION BY ${keys} ORDER BY ${order}) = 1`;
}
