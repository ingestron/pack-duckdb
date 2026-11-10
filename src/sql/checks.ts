// A table's row checks, results and quarantine as DuckDB SQL (spec/behaviour.md, "Row checks",
// "Results" and "Quarantine"): only in a layer whose does lists check (and quarantine), so a
// table anywhere else is built as it was before checks existed.
import type { Expectation, LayerDuty, ResolvedTable } from "@ingestron/definitions";
import { conditionOf, passes } from "./conditions.js";
import { literal, quote } from "./sql.js";

/** The temporary table that holds a table's rows while they are checked. */
export const rowsTable = '"temp"."ingestron_rows"';

/** The temporary table that holds each check's outcome, to print and keep. */
const checkedTable = '"temp"."ingestron_checked"';

/**
 * The table that keeps the results of the checks of every table in the table's schema. Not a
 * schema of its own: the database is often `ingestron.duckdb`, whose catalog is `ingestron`, and
 * a schema of that name would be ambiguous.
 */
const resultsOf = (table: ResolvedTable) => `${quote(table.fullName.schema)}."_ingestron_checks"`;

/** Sets the run's id, which every result of one run shares. */
export const runIdSql = "SET VARIABLE ingestron_run_id = CAST(uuid() AS VARCHAR);";

/** True when the table's layer's `does` lists the duty. */
const lists = (table: ResolvedTable, duty: LayerDuty) =>
  Array.isArray(table.does) && table.does.includes(duty);

/** The table's expectations the pack runs: all of them where its layer checks, else none. */
export function rowChecksOf(table: ResolvedTable): Expectation[] {
  return lists(table, "check") ? table.expectations : [];
}

/** The table's contract table checks the pack runs: all of them where its layer checks, else none. */
export function tableChecksOf(table: ResolvedTable): ResolvedTable["contract"]["tableChecks"] {
  return lists(table, "check") ? table.contract.tableChecks : [];
}

/** True when the table keeps its checks' results: it resolves `results` and runs a check. */
export function keepsResults(table: ResolvedTable): boolean {
  const checks = rowChecksOf(table).length + tableChecksOf(table).length;
  return table.quality?.results === true && checks > 0;
}

/** The `drop` checks the table runs. */
const dropsOf = (table: ResolvedTable) =>
  rowChecksOf(table).filter((expectation) => expectation.action === "drop");

/** The quarantine table's quoted name, when the table keeps the rows its drop checks leave out. */
export function quarantineOf(table: ResolvedTable): string | undefined {
  const { quarantine } = table;
  if (!quarantine || !lists(table, "quarantine") || dropsOf(table).length === 0) return undefined;
  return `${quote(quarantine.fullName.schema)}.${quote(quarantine.fullName.table)}`;
}

/** `<schema>.<table>`, as the checks name the table. */
export const shownName = (table: ResolvedTable): string =>
  literal(`${table.fullName.schema}.${table.fullName.table}`);

/** ` WHERE <every drop check passes>`, or nothing when no check drops rows. */
export function keepOf(table: ResolvedTable): string {
  const drops = dropsOf(table);
  return drops.length === 0 ? "" : ` WHERE ${passes(drops)}`;
}

/** The statements that make the results table, when the table keeps results. */
export function resultsTableSql(table: ResolvedTable): string[] {
  if (!keepsResults(table)) return [];
  return [
    `CREATE TABLE IF NOT EXISTS ${resultsOf(table)} ("run_id" VARCHAR, "checked_at" TIMESTAMP WITH TIME ZONE, "table" VARCHAR, "check" VARCHAR, "action" VARCHAR, "failing_rows" BIGINT, "passed" BOOLEAN);`,
  ];
}

/**
 * Prints the checks' outcomes, stops the run where a `fail` check failed with the message
 * `stop` (its `{}` filled from the columns `fill` names), and keeps the outcomes.
 */
export function outcomeSql(table: ResolvedTable, stop: string, fill: string[]): string[] {
  const kept = keepsResults(table)
    ? [
        `INSERT INTO ${resultsOf(table)} ("run_id", "checked_at", "table", "check", "action", "failing_rows", "passed") SELECT getvariable('ingestron_run_id'), now(), "table", "check", "action", "failing_rows", "passed" FROM ${checkedTable};`,
      ]
    : [];
  return [
    `SELECT "table", "check", "action", "failing_rows", "passed" FROM ${checkedTable};`,
    `SELECT error(format(${[literal(stop), ...fill.map(quote)].join(", ")})) FROM ${checkedTable} WHERE "action" = 'fail' AND NOT "passed";`,
    ...kept,
  ];
}

/** Counts each row check's failing rows in the checked rows, then prints, stops and keeps. */
export function rowCheckSql(table: ResolvedTable): string[] {
  const checks = rowChecksOf(table);
  if (checks.length === 0) return [];
  const rows = checks.map(
    (expectation) =>
      `  (${shownName(table)}, ${literal(expectation.name)}, ${literal(expectation.action)}, (SELECT count(*) FROM ${rowsTable} WHERE NOT ${passes([expectation])}))`,
  );
  return [
    `CREATE OR REPLACE TEMP TABLE "ingestron_checked" AS SELECT *, "failing_rows" = 0 AS "passed" FROM (VALUES\n${rows.join(",\n")}\n) AS "checks"("table", "check", "action", "failing_rows");`,
    ...outcomeSql(table, 'The check "{}" failed for {} rows of {}, so nothing is published.', [
      "check",
      "failing_rows",
      "table",
    ]),
  ];
}

/** The names of the drop checks a row failed, as a list; a null condition counts as failed. */
export function failedChecks(table: ResolvedTable): string {
  const names = dropsOf(table).map(
    (expectation) =>
      `CASE WHEN coalesce(${conditionOf(expectation)}, FALSE) THEN NULL ELSE ${literal(expectation.name)} END`,
  );
  return `list_filter([${names.join(", ")}], lambda name: name IS NOT NULL)`;
}

/** The rows the drop checks leave out, with the checks they failed, as a quarantine reads them. */
export function quarantinedRows(table: ResolvedTable): string {
  const column = quote(table.quarantine!.column);
  return `SELECT *, ${failedChecks(table)} AS ${column} FROM ${rowsTable} WHERE NOT ${passes(dropsOf(table))}`;
}
