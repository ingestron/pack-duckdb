// The DuckDB SQL a table is written in: quoted names and text, the readers
// for landed files, and typed columns.
import type { Column } from "@ingestron/definitions";
import { duckdbTypes } from "./types.js";

/**
 * A name in double quotes, with `"` doubled.
 * @example quote("order") // "\"order\""
 */
export function quote(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * Text in single quotes, with `'` doubled.
 * @example literal("o'brien") // "'o''brien'"
 */
export function literal(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

/** The column naming each row's file; unlike `filename`, no file holds it. */
export const fileColumn = "_ingestron_file";

/** What a reader reads: a file or pattern, its format, and how. */
export interface FilesInput {
  location: string;
  format: "parquet" | "csv" | "json";
  csv?: { header: boolean; delimiter: string };
  /** The columns' names in file order, for CSV files without a header. */
  names?: string[];
  /** Add a `_ingestron_file` column naming each row's file. */
  withFile?: boolean;
}

/**
 * DuckDB's reader for the files: `read_parquet`, `read_csv` or `read_json_auto`.
 * @example readFiles({ location: "./in/*.parquet", format: "parquet" }) // "read_parquet('./in/*.parquet')"
 */
export function readFiles(input: FilesInput): string {
  const options = input.withFile ? [`filename = ${literal(fileColumn)}`] : [];
  if (input.format === "csv") {
    const { header, delimiter } = input.csv ?? { header: true, delimiter: "," };
    options.unshift(`header = ${String(header)}`, `delim = ${literal(delimiter)}`);
    if (!header && input.names)
      options.splice(2, 0, `names = [${input.names.map(literal).join(", ")}]`);
  }
  const reader = { parquet: "read_parquet", csv: "read_csv", json: "read_json_auto" }[input.format];
  return `${reader}(${[literal(input.location), ...options].join(", ")})`;
}

/** How a table's columns are read from its files. */
export interface ColumnOptions {
  /** False when the files hold columns under their physicalName. */
  renamed: boolean;
  /** True when each column's resolved type is DuckDB's (DuckDB provides the defaults). */
  resolvedTypes: boolean;
}

/**
 * Each column cast to its type, under its contract name.
 * @example selectColumns(columns, { renamed: true, resolvedTypes: false }) // 'CAST("id" AS BIGINT) AS "id"'
 */
export function selectColumns(columns: Column[], options: ColumnOptions): string {
  return columns
    .map((column) => {
      const source = !options.renamed && column.physicalName ? column.physicalName : column.name;
      return `CAST(${quote(source)} AS ${typeOf(column, options)}) AS ${quote(column.name)}`;
    })
    .join(", ");
}

/** The resolved type when it is DuckDB's; otherwise from the logicalType. */
export function typeOf(
  column: Column,
  { resolvedTypes }: Pick<ColumnOptions, "resolvedTypes">,
): string {
  const mapped = column.logicalType ? duckdbTypes[column.logicalType] : undefined;
  const type = resolvedTypes ? (column.type ?? mapped) : (mapped ?? column.type);
  return type ?? "VARCHAR";
}
