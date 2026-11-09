// The SQL that keeps one table: load its files by the mode, or rebuild it from
// its transform's query, then publish the contract's columns as Parquet.
// Tables already in the database gain new contract columns, and rows are
// inserted by name, so a changed contract keeps loading.
import type { Column, ResolvedModel, ResolvedTable } from "@ingestron/definitions";
import { auditOf, auditSelect, readsFileName } from "./audit.js";
import {
  fileColumn,
  literal,
  quote,
  readFiles,
  selectColumns,
  typeOf,
  type FilesInput,
} from "./sql.js";

interface Target {
  table: ResolvedTable;
  /** `"<schema>"."<table>"`. */
  name: string;
  resolvedTypes: boolean;
}

/** The table's statements, one per line, ending with the COPY that publishes it. */
export function tableSql(
  model: ResolvedModel,
  table: ResolvedTable,
  resolvedTypes: boolean,
): string {
  return [...buildSql(model, table, resolvedTypes), publishSql(table)].join("\n");
}

/** The statements that keep the table in the database. */
export function buildSql(
  model: ResolvedModel,
  table: ResolvedTable,
  resolvedTypes: boolean,
): string[] {
  const target = { table, name: nameOf(table), resolvedTypes };
  const keep = table.transform ? transformSql(model, target) : filesSql(target);
  return [`CREATE SCHEMA IF NOT EXISTS ${quote(table.fullName.schema)};`, ...keep];
}

/**
 * The table's columns: the contract's, then those its landed files carry
 * beyond it (such as ADF's audit columns). A transform's table has only the contract's.
 */
export function columnsOf(table: ResolvedTable): Column[] {
  const extra = table.transform
    ? []
    : ((table.ingest?.output as { columns?: Column[] } | undefined)?.columns ?? []);
  return [...table.contract.columns, ...extra];
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

function filesSql(target: Target): string[] {
  const ingest = target.table.ingest!;
  const output = ingest.output!;
  const files: FilesInput = {
    location: output.location,
    format: output.format === "csv" || output.format === "json" ? output.format : "parquet",
    csv: ingest.settings.csv as FilesInput["csv"],
    names: columnsOf(target.table).map((column) =>
      !ingest.renamed && column.physicalName ? column.physicalName : column.name,
    ),
    // Files landed before the extra columns were added read them as NULL.
    unionByName: columnsOf(target.table).length > target.table.contract.columns.length,
  };
  const select = [
    selectColumns(columnsOf(target.table), {
      renamed: ingest.renamed,
      resolvedTypes: target.resolvedTypes,
    }),
    ...auditSelect(target.table),
  ].join(", ");
  const reader = readFiles({ ...files, withFile: true });
  const mode = target.table.store!.settings.mode;
  if (mode === "append") return appendSql(target, select, reader);
  if (mode === "upsert") return upsertSql(target, select, reader, true);
  const replaced = readFiles({ ...files, withFile: readsFileName(target.table) });
  return [`CREATE OR REPLACE TABLE ${target.name} AS SELECT ${select} FROM ${replaced};`];
}

/** Each file once: its name is kept with its rows, and files already loaded are skipped. */
function appendSql(target: Target, select: string, reader: string): string[] {
  const rows = `SELECT ${select}, ${quote(fileColumn)} FROM ${reader}`;
  return [
    `CREATE TABLE IF NOT EXISTS ${target.name} AS ${rows} LIMIT 0;`,
    ...addColumns(target),
    `INSERT INTO ${target.name} BY NAME ${rows} WHERE ${quote(fileColumn)} NOT IN (SELECT ${quote(fileColumn)} FROM ${target.name});`,
  ];
}

/**
 * Rows replace those with the same primary key. A key's row is the last by
 * sequence_by, then (for files) by file name, so every run keeps the same one. Rows the
 * source no longer gives stay. A source that gives no order is not made unique.
 */
function upsertSql(target: Target, select: string, source: string, files: boolean): string[] {
  const { table } = target;
  const keys = table.contract.primaryKey.map(quote).join(", ");
  const sequence = table.store!.settings.sequence_by;
  const order = [
    ...(typeof sequence === "string" ? [`${quote(sequence)} DESC`] : []),
    ...(files ? [`${quote(fileColumn)} DESC`] : []),
  ].join(", ");
  const last = order
    ? ` QUALIFY row_number() OVER (PARTITION BY ${keys} ORDER BY ${order}) = 1`
    : "";
  return [
    `CREATE TABLE IF NOT EXISTS ${target.name} (${definitions(target).join(", ")}, PRIMARY KEY (${keys}));`,
    ...addColumns(target),
    `INSERT OR REPLACE INTO ${target.name} BY NAME SELECT ${select} FROM ${source}${last};`,
  ];
}

/** Columns the contract gained since the table was created. */
function addColumns(target: Target): string[] {
  return definitions(target).map(
    (definition) => `ALTER TABLE ${target.name} ADD COLUMN IF NOT EXISTS ${definition};`,
  );
}

function definitions({ table, resolvedTypes }: Target): string[] {
  return [
    ...columnsOf(table).map(
      (column) => `${quote(column.name)} ${typeOf(column, { resolvedTypes })}`,
    ),
    ...auditOf(table).map((column) => `${quote(column.name)} ${column.type}`),
  ];
}

/** The transform's query, its inputs named by their tables, selecting the contract's columns. */
function transformSql(model: ResolvedModel, target: Target): string[] {
  const code = target.table
    .transform!.code.trim()
    .replace(/;\s*$/, "")
    .replace(/\{\{\s*tables\.([A-Za-z0-9_-]+)\s*\}\}/g, (written, input: string) => {
      const found = model.tables.find((item) => item.name === input);
      return found ? `${quote(found.fullName.schema)}.${quote(found.fullName.table)}` : written;
    });
  const columns = [
    selectColumns(target.table.contract.columns, {
      renamed: true,
      resolvedTypes: target.resolvedTypes,
    }),
    ...auditSelect(target.table),
  ].join(", ");
  // The code sits on its own lines, so a trailing comment cannot swallow the bracket.
  const query = `(\n${code}\n) AS "source"`;
  // With a key, `history: latest` keeps the rows the query no longer gives (by key).
  if (keepsLatest(target.table)) return upsertSql(target, columns, query, false);
  return [`CREATE OR REPLACE TABLE ${target.name} AS SELECT ${columns} FROM ${query};`];
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
