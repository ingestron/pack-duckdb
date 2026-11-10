// How rows reach a table, by its mode (spec/behaviour.md, "Each table" and "Row checks"):
// replaced, appended file by file, or upserted by key. A table that runs row checks first keeps
// its rows in a temporary table, checks them, then inserts those its drop checks keep, and
// quarantines the others; any other table is built as it was before checks existed.
import type { ResolvedTable } from "@ingestron/definitions";
import { auditOf } from "./audit.js";
import {
  keepOf,
  quarantinedRows,
  quarantineOf,
  rowCheckSql,
  rowChecksOf,
  rowsTable,
} from "./checks.js";
import { fileColumn, quote, typeOf } from "./sql.js";
import { columnsOf } from "./columns.js";

/** The table being kept: the model's table, its quoted name, and whether types are DuckDB's. */
export interface Target {
  table: ResolvedTable;
  /** `"<schema>"."<table>"`. */
  name: string;
  resolvedTypes: boolean;
}

/** True when the table runs row checks, so its rows are checked before they are inserted. */
const checked = (target: Target) => rowChecksOf(target.table).length > 0;

/**
 * Keeps the rows in the temporary table, checks them, then runs `insert` (which reads the
 * temporary table) and `quarantine`, and drops the temporary table.
 */
function checking(rows: string, target: Target, insert: string, quarantine: string[]): string[] {
  return [
    `CREATE OR REPLACE TEMP TABLE "ingestron_rows" AS ${rows};`,
    ...rowCheckSql(target.table),
    insert,
    ...quarantine,
    `DROP TABLE ${rowsTable};`,
  ];
}

/** The table is the rows, each run; its quarantine, the rows its drop checks leave out. */
export function replaceSql(target: Target, rows: string): string[] {
  if (!checked(target)) return [`CREATE OR REPLACE TABLE ${target.name} AS ${rows};`];
  const quarantine = quarantineOf(target.table);
  return checking(
    rows,
    target,
    `CREATE OR REPLACE TABLE ${target.name} AS SELECT * FROM ${rowsTable}${keepOf(target.table)};`,
    quarantine
      ? [`CREATE OR REPLACE TABLE ${quarantine} AS ${quarantinedRows(target.table)};`]
      : [],
  );
}

/**
 * Each file once: its name is kept with its rows, and files already loaded are skipped: those in
 * the table, and those in its quarantine, so a file whose every row failed is not read again.
 */
export function appendSql(target: Target, select: string, reader: string): string[] {
  const rows = `SELECT ${select}, ${quote(fileColumn)} FROM ${reader}`;
  const file = quote(fileColumn);
  const created = [
    `CREATE TABLE IF NOT EXISTS ${target.name} AS ${rows} LIMIT 0;`,
    ...addColumns(target, target.name),
  ];
  const loaded = `${file} NOT IN (SELECT ${file} FROM ${target.name})`;
  if (!checked(target))
    return [...created, `INSERT INTO ${target.name} BY NAME ${rows} WHERE ${loaded};`];
  const quarantine = quarantineOf(target.table);
  const column = quote(target.table.quarantine?.column ?? "");
  const kept = quarantine
    ? [
        `CREATE TABLE IF NOT EXISTS ${quarantine} AS SELECT *, CAST([] AS VARCHAR[]) AS ${column} FROM ${target.name} LIMIT 0;`,
        ...addColumns(target, quarantine),
      ]
    : [];
  const skipped = quarantine ? ` AND ${file} NOT IN (SELECT ${file} FROM ${quarantine})` : "";
  return [
    ...created,
    ...kept,
    ...checking(
      `${rows} WHERE ${loaded}${skipped}`,
      target,
      `INSERT INTO ${target.name} BY NAME SELECT * FROM ${rowsTable}${keepOf(target.table)};`,
      quarantine ? [`INSERT INTO ${quarantine} BY NAME ${quarantinedRows(target.table)};`] : [],
    ),
  ];
}

/** The cleansing operations that can change a value, so two keys can become one. */
const changing = ["trim", "empty", "map", "case", "default"] as const;

/** True when the table cleanses a column of its primary key in a way that can change its value. */
function cleansesKey(table: ResolvedTable): boolean {
  const columns = table.cleanse?.columns ?? {};
  return table.contract.primaryKey.some((key) => {
    const operations = columns[key];
    return operations !== undefined && changing.some((name) => operations[name] !== undefined);
  });
}

/**
 * Rows replace those with the same primary key. A key's row is the last by
 * sequence_by, then (for files) by file name, so every run keeps the same one. Rows the
 * source no longer gives stay. A source that gives no order is not made unique, unless
 * cleansing can change a key: then rows that cleansing gives one key are made unique on the
 * cleansed key, the last by sequence_by, file name and every column, so the insert never
 * holds a key twice.
 */
export function upsertSql(
  target: Target,
  select: string,
  source: string,
  files: boolean,
): string[] {
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
  const created = [
    `CREATE TABLE IF NOT EXISTS ${target.name} (${definitions(target).join(", ")}, PRIMARY KEY (${keys}));`,
    ...addColumns(target, target.name),
  ];
  const rows = cleansesKey(table)
    ? uniqueByKey(target, select, source, files)
    : `SELECT ${select} FROM ${source}${last}`;
  if (!checked(target))
    return [...created, `INSERT OR REPLACE INTO ${target.name} BY NAME ${rows};`];
  const quarantine = quarantineOf(table);
  return [
    ...created,
    ...checking(
      rows,
      target,
      `INSERT OR REPLACE INTO ${target.name} BY NAME SELECT * FROM ${rowsTable}${keepOf(table)};`,
      quarantine ? [`CREATE OR REPLACE TABLE ${quarantine} AS ${quarantinedRows(table)};`] : [],
    ),
  ];
}

/** Columns the contract gained since the table (or its quarantine) was created. */
function addColumns(target: Target, name: string): string[] {
  return definitions(target).map(
    (definition) => `ALTER TABLE ${name} ADD COLUMN IF NOT EXISTS ${definition};`,
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

/**
 * The rows, one per cleansed key: a `SELECT` of their own, so the window reads the key as
 * cleansed, then `QUALIFY`, the last by sequence_by, file name (for files) and every column.
 */
function uniqueByKey(target: Target, select: string, source: string, files: boolean): string {
  const { table } = target;
  const keys = table.contract.primaryKey.map(quote).join(", ");
  const sequence = table.store!.settings.sequence_by;
  const file = quote(fileColumn);
  const order = [
    ...(typeof sequence === "string" ? [quote(sequence)] : []),
    ...(files ? [file] : []),
    ...columnsOf(table).map((column) => quote(column.name)),
  ]
    .map((column) => `${column} DESC`)
    .join(", ");
  const rows = `SELECT ${select}${files ? `, ${file}` : ""} FROM ${source}`;
  const all = files ? `* EXCLUDE (${file})` : "*";
  return `SELECT ${all} FROM (${rows}) AS "rows" QUALIFY row_number() OVER (PARTITION BY ${keys} ORDER BY ${order}) = 1`;
}
