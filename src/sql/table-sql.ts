// The SQL that keeps one table: load its files by the mode, or rebuild it from
// its transform's query, then publish the contract's columns as Parquet.
// Tables already in the database gain new contract columns, and rows are
// inserted by name, so a changed contract keeps loading. Columns are cleansed
// in the SELECT, and rows deduplicated and checked as the model says.
import type { Column, ResolvedModel, ResolvedTable } from "@ingestron/definitions";
import { auditOf, auditSelect, readsFileName } from "./audit.js";
import { keepsResults, resultsTableSql, runIdSql } from "./checks.js";
import { cleansedColumn, deduplicated } from "./cleanse.js";
import { columnsOf } from "./columns.js";
import { appendSql, replaceSql, upsertSql, type Target } from "./modes.js";
import { fileColumn, literal, quote, readFiles, selectColumns, type FilesInput } from "./sql.js";
import { tableCheckSql } from "./table-checks.js";

export { columnsOf } from "./columns.js";

/** The table's statements, one per line, ending with the COPY that publishes it. */
export function tableSql(
  model: ResolvedModel,
  table: ResolvedTable,
  resolvedTypes: boolean,
): string {
  const runId = keepsResults(table) ? [runIdSql] : [];
  return [...runId, ...buildSql(model, table, resolvedTypes), publishSql(table)].join("\n");
}

/** The statements that keep the table in the database, then count its table checks. */
export function buildSql(
  model: ResolvedModel,
  table: ResolvedTable,
  resolvedTypes: boolean,
): string[] {
  const target = { table, name: nameOf(table), resolvedTypes };
  const keep = table.transform ? transformSql(model, target) : filesSql(target);
  return [
    `CREATE SCHEMA IF NOT EXISTS ${quote(table.fullName.schema)};`,
    ...resultsTableSql(table),
    ...keep,
    ...tableCheckSql(table, target.name),
  ];
}

/** The COPY that publishes the table's columns as Parquet. */
export function publishSql(table: ResolvedTable): string {
  const columns = [
    ...columnsOf(table).map((column) => column.name),
    ...auditOf(table).map((c) => c.name),
  ]
    .map(quote)
    .join(", ");
  return `COPY (SELECT ${columns} FROM ${nameOf(table)}) TO ${literal(table.store!.output!.location)} (FORMAT parquet);`;
}

const nameOf = (table: ResolvedTable) =>
  `${quote(table.fullName.schema)}.${quote(table.fullName.table)}`;

/** Cleanses a column, cast to its type, as the table says. */
const cleansing = (table: ResolvedTable) => (column: Column, cast: string) =>
  cleansedColumn(table, column, cast);

function filesSql(target: Target): string[] {
  const { table } = target;
  const ingest = table.ingest!;
  const output = ingest.output!;
  const files: FilesInput = {
    location: output.location,
    format: output.format === "csv" || output.format === "json" ? output.format : "parquet",
    csv: ingest.settings.csv as FilesInput["csv"],
    names: columnsOf(table).map((column) =>
      !ingest.renamed && column.physicalName ? column.physicalName : column.name,
    ),
    // Files landed before the extra columns were added read them as NULL.
    unionByName: columnsOf(table).length > table.contract.columns.length,
  };
  const options = { renamed: ingest.renamed, resolvedTypes: target.resolvedTypes };
  const select = [
    selectColumns(columnsOf(table), options, cleansing(table)),
    ...auditSelect(table),
  ].join(", ");
  const reader = readFiles({ ...files, withFile: true });
  const mode = table.store!.settings.mode;
  if (mode === "append") return appendSql(target, select, reader);
  if (mode === "upsert") return upsertSql(target, select, reader, true);
  if (table.cleanse?.deduplicate) {
    const rows = `SELECT ${select}, ${quote(fileColumn)} FROM ${reader}`;
    return replaceSql(target, deduplicated(table, rows, fileColumn));
  }
  const replaced = readFiles({ ...files, withFile: readsFileName(table) });
  return replaceSql(target, `SELECT ${select} FROM ${replaced}`);
}

/** The transform's query, its inputs named by their tables, selecting the contract's columns. */
function transformSql(model: ResolvedModel, target: Target): string[] {
  const { table } = target;
  const code = table
    .transform!.code.trim()
    .replace(/;\s*$/, "")
    .replace(/\{\{\s*tables\.([A-Za-z0-9_-]+)\s*\}\}/g, (written, input: string) => {
      const found = model.tables.find((item) => item.name === input);
      return found ? `${quote(found.fullName.schema)}.${quote(found.fullName.table)}` : written;
    });
  const options = { renamed: true, resolvedTypes: target.resolvedTypes };
  const columns = [
    selectColumns(table.contract.columns, options, cleansing(table)),
    ...auditSelect(table),
  ].join(", ");
  // The code sits on its own lines, so a trailing comment cannot swallow the bracket.
  const query = `(\n${code}\n) AS "source"`;
  // With a key, `history: latest` keeps the rows the query no longer gives (by key).
  if (keepsLatest(table)) return upsertSql(target, columns, query, false);
  return replaceSql(target, deduplicated(table, `SELECT ${columns} FROM ${query}`));
}

/**
 * True for a transform's table with a primary key whose intent says `history: latest`, written
 * as intent. A `mode: upsert` setting alone never made a transform's table an upsert, so
 * it still does not: tables already built that way have no key to replace by.
 */
function keepsLatest(table: ResolvedTable): boolean {
  const origin = table.intentOrigins.history;
  return (
    table.intent.history === "latest" &&
    table.contract.primaryKey.length > 0 &&
    origin !== undefined &&
    origin.layer !== "pack" &&
    origin.alias === undefined
  );
}
