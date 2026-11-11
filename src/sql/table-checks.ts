// A table's contract table checks as DuckDB SQL (spec/behaviour.md, "Table checks"): counted
// over all its rows after it is built, compared by the rule's operator, printed and kept as row
// checks are; a failing `fail` check stops the run.
import type { ResolvedTable, TableCheck } from "@ingestron/definitions";
import { value } from "./conditions.js";
import { outcomeSql, shownName, tableChecksOf } from "./checks.js";
import { literal, quote } from "./sql.js";

/** The statements that count, print, stop and keep the table's table checks after it is built. */
export function tableCheckSql(table: ResolvedTable, name: string): string[] {
  const checks = tableChecksOf(table);
  if (checks.length === 0) return [];
  const rows = checks.map(
    (check) =>
      `  SELECT ${shownName(table)} AS "table", ${literal(check.name)} AS "check", ${literal(check.action)} AS "action", CAST(coalesce("counted", 0) AS BIGINT) AS "failing_rows", ${comparison(check)} AS "passed" FROM (${countQuery(table, check, name)})`,
  );
  return [
    `CREATE OR REPLACE TEMP TABLE "ingestron_checked" AS\n${rows.join("\n  UNION ALL\n")};`,
    ...outcomeSql(table, 'The table check "{}" failed on {}, so nothing is published.', [
      "check",
      "table",
    ]),
  ];
}

/** A query whose one row has `counted`, the number the rule compares, and `total`, all rows. */
function countQuery(table: ResolvedTable, check: TableCheck, from: string): string {
  if (check.metric === "sql") {
    const query = (check.query ?? "").replaceAll("${object}", from);
    return `SELECT (${query}) AS "counted", (SELECT count(*) FROM ${from}) AS "total"`;
  }
  return `SELECT ${countOf(table, check)} AS "counted", count(*) AS "total" FROM ${from}`;
}

function countOf(table: ResolvedTable, check: TableCheck): string {
  const columns = check.columns.map(quote);
  const [column = "*"] = columns;
  switch (check.metric) {
    case "rowCount":
      return "count(*)";
    case "duplicateValues":
      if (columns.length === 1) return `count(*) - count(DISTINCT ${column})`;
      // The whole row is the contract's columns, so audit and file columns do not make rows differ.
      return distinctRows(
        columns.length > 1 ? columns : table.contract.columns.map((item) => quote(item.name)),
      );
    case "nullValues":
      return `countif(${column} IS NULL)`;
    case "missingValues":
      return Array.isArray(check.arguments.missingValues)
        ? `countif(${column} IS NULL OR ${column} IN (${valuesOf(check.arguments.missingValues)}))`
        : `countif(${column} IS NULL)`;
    default:
      return `countif(${column} IS NOT NULL AND NOT ${validOf(check, column)})`;
  }
}

/**
 * The duplicates of several columns: all rows less the distinct rows of their values. DuckDB's
 * count takes one argument, so the values are one `row(…)`, named column by column so that no
 * column can be read in its place; a row with a null part is left out of the distinct rows, as
 * Spark's `count(DISTINCT a, b)` leaves it out, so it counts as a duplicate.
 */
function distinctRows(columns: string[]): string {
  const whole = columns.map((column) => `${column} IS NOT NULL`).join(" AND ");
  return `count(*) - count(DISTINCT CASE WHEN ${whole} THEN row(${columns.join(", ")}) END)`;
}

/** For invalidValues: within `validValues`, or matching `pattern`. */
function validOf(check: TableCheck, column: string): string {
  const { validValues, pattern } = check.arguments;
  if (typeof pattern === "string") return `regexp_matches(${column}, ${literal(pattern)})`;
  return `${column} IN (${valuesOf(validValues)})`;
}

function valuesOf(values: unknown): string {
  const list = Array.isArray(values) && values.length > 0 ? values : [""];
  return list.map(value).join(", ");
}

const operators: Record<string, string> = {
  mustBe: "=",
  mustNotBe: "<>",
  mustBeGreaterThan: ">",
  mustBeGreaterOrEqualTo: ">=",
  mustBeLessThan: "<",
  mustBeLessOrEqualTo: "<=",
};

/** True when the measured number meets the rule: rows, or a percentage of all rows. */
function comparison(check: TableCheck): string {
  const measured =
    check.unit === "percent"
      ? `CASE WHEN "total" = 0 THEN 0 ELSE coalesce("counted", 0) * 100.0 / "total" END`
      : `coalesce("counted", 0)`;
  const operator = operators[check.operator];
  if (operator) return `${measured} ${operator} ${value(check.value)}`;
  const [low, high] = Array.isArray(check.value) ? check.value : [check.value, check.value];
  const between = check.operator === "mustNotBeBetween" ? "NOT BETWEEN" : "BETWEEN";
  return `${measured} ${between} ${value(low)} AND ${value(high)}`;
}
