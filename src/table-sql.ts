// The SQL that keeps one table: load its files by the mode, or rebuild it from
// its transform's query, then publish it as Parquet.
import type { ResolvedModel, ResolvedTable } from "@ingestron/definitions";
import { literal, quote, readFiles, selectColumns, typeOf, type FilesInput } from "./sql.js";

/** The table's statements, one per line, ending with the COPY that publishes it. */
export function tableSql(
  model: ResolvedModel,
  table: ResolvedTable,
  resolvedTypes: boolean,
): string {
  const name = `${quote(table.fullName.schema)}.${quote(table.fullName.table)}`;
  const keep = table.transform
    ? transformSql(model, table, name)
    : filesSql(table, name, resolvedTypes);
  return [
    `CREATE SCHEMA IF NOT EXISTS ${quote(table.fullName.schema)};`,
    ...keep,
    `COPY ${name} TO ${literal(table.store!.output!.location)} (FORMAT parquet);`,
  ].join("\n");
}

function filesSql(table: ResolvedTable, name: string, resolvedTypes: boolean): string[] {
  const ingest = table.ingest!;
  const output = ingest.output!;
  const files: FilesInput = {
    location: output.location,
    format: output.format === "csv" || output.format === "json" ? output.format : "parquet",
    csv: ingest.settings.csv as FilesInput["csv"],
  };
  const select = selectColumns(table.contract.columns, { renamed: ingest.renamed, resolvedTypes });
  const settings = table.store!.settings;
  if (settings.mode === "append")
    return appendSql(name, select, readFiles({ ...files, withFile: true }));
  if (settings.mode === "upsert")
    return upsertSql(table, name, select, readFiles(files), resolvedTypes);
  return [`CREATE OR REPLACE TABLE ${name} AS SELECT ${select} FROM ${readFiles(files)};`];
}

/** Each file once: its name is kept with its rows, and files already loaded are skipped. */
function appendSql(name: string, select: string, reader: string): string[] {
  const rows = `SELECT ${select}, filename AS "_ingestron_file" FROM ${reader}`;
  return [
    `CREATE TABLE IF NOT EXISTS ${name} AS ${rows} LIMIT 0;`,
    `INSERT INTO ${name} ${rows} WHERE filename NOT IN (SELECT "_ingestron_file" FROM ${name});`,
  ];
}

/** Rows replace those with the same primary key; sequence_by picks a key's latest row. */
function upsertSql(
  table: ResolvedTable,
  name: string,
  select: string,
  reader: string,
  resolvedTypes: boolean,
): string[] {
  const columns = table.contract.columns.map(
    (column) => `${quote(column.name)} ${typeOf(column, { resolvedTypes })}`,
  );
  const keys = table.contract.primaryKey.map(quote).join(", ");
  const sequence = table.store!.settings.sequence_by;
  const latest =
    typeof sequence === "string"
      ? ` QUALIFY row_number() OVER (PARTITION BY ${keys} ORDER BY ${quote(sequence)} DESC) = 1`
      : "";
  return [
    `CREATE TABLE IF NOT EXISTS ${name} (${columns.join(", ")}, PRIMARY KEY (${keys}));`,
    `INSERT OR REPLACE INTO ${name} SELECT ${select} FROM ${reader}${latest};`,
  ];
}

/** The transform's query, its inputs named by their tables, selecting the contract's columns. */
function transformSql(model: ResolvedModel, table: ResolvedTable, name: string): string[] {
  const code = table
    .transform!.code.trim()
    .replace(/;\s*$/, "")
    .replace(/\{\{\s*tables\.([A-Za-z0-9_-]+)\s*\}\}/g, (written, input: string) => {
      const found = model.tables.find((item) => item.name === input);
      return found ? `${quote(found.fullName.schema)}.${quote(found.fullName.table)}` : written;
    });
  const columns = table.contract.columns.map((column) => quote(column.name)).join(", ");
  return [`CREATE OR REPLACE TABLE ${name} AS SELECT ${columns} FROM (${code}) AS "source";`];
}
