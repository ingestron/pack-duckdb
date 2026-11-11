// The condition of each expectation in DuckDB SQL (spec/behaviour.md, "Row checks"): written
// from its rule when it has one, else its check text. The rules keep the Databricks pack's
// null semantics: null fails notNull, passes in and notIn only with allowNull, and passes
// every other kind.
import type { Expectation, RowRule } from "@ingestron/definitions";
import { literal, quote } from "./sql.js";

/**
 * A value of a rule or a check: a number as it is, any other value as SQL text.
 * @example value(5) // "5"
 */
export function value(item: unknown): string {
  return typeof item === "number" ? String(item) : literal(String(item));
}

/** The condition a row passes, as DuckDB SQL. */
export function conditionOf(expectation: Expectation): string {
  return expectation.rule ? ruleCondition(expectation.rule) : expectation.check;
}

/** A rule as DuckDB SQL that is never null. */
export function ruleCondition(rule: RowRule): string {
  const name = quote(rule.column);
  switch (rule.kind) {
    case "notNull":
      return `${name} IS NOT NULL`;
    case "in":
    case "notIn": {
      const list = `${name} ${rule.kind === "in" ? "IN" : "NOT IN"} (${rule.values.map(value).join(", ")})`;
      return rule.allowNull ? `${name} IS NULL OR ${list}` : `${name} IS NOT NULL AND ${list}`;
    }
    default:
      return `${name} IS NULL OR ${limits(rule, name).join(" AND ")}`;
  }
}

/** The limits of a rule that a null value passes. */
function limits(rule: Exclude<RowRule, { kind: "notNull" | "in" | "notIn" }>, name: string) {
  switch (rule.kind) {
    case "pattern":
      return [`regexp_matches(${name}, ${value(rule.pattern)})`];
    case "length":
      return bounds(`length(${name})`, rule.min, rule.max, false);
    case "range":
      return bounds(name, rule.min, rule.max, rule.exclusive === true);
    case "multipleOf":
      return [`${name} % ${value(rule.value)} = 0`];
    case "items":
      return [
        ...bounds(`len(${name})`, rule.min, rule.max, false),
        ...(rule.unique ? [`len(list_distinct(${name})) = len(${name})`] : []),
      ];
  }
}

function bounds(of: string, min: unknown, max: unknown, exclusive: boolean): string[] {
  return [
    ...(min === undefined ? [] : [`${of} ${exclusive ? ">" : ">="} ${value(min)}`]),
    ...(max === undefined ? [] : [`${of} ${exclusive ? "<" : "<="} ${value(max)}`]),
  ];
}

/** The condition that a row passes, where null fails: `coalesce(<condition>, FALSE)`. */
export function passes(expectations: Expectation[]): string {
  const conditions = expectations.map(conditionOf);
  const all =
    conditions.length === 1
      ? conditions[0]!
      : conditions.map((condition) => `(${condition})`).join(" AND ");
  return `coalesce(${all}, FALSE)`;
}
