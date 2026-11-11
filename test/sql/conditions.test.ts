// The condition each rule writes in DuckDB SQL (spec/behaviour.md, "Row checks"), and what
// DuckDB makes of it: null fails notNull, passes in and notIn only with allowNull, and passes
// every other kind.
import type { Expectation, RowRule } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { conditionOf, ruleCondition } from "../../src/sql/conditions.js";
import { execute } from "../project.js";

describe("each rule's condition", () => {
  const cases: [RowRule, string][] = [
    [{ kind: "notNull", column: "id" }, `"id" IS NOT NULL`],
    [
      { kind: "in", column: "c", values: ["GB", 1], allowNull: true },
      `"c" IS NULL OR "c" IN ('GB', 1)`,
    ],
    [
      { kind: "notIn", column: "c", values: ["n/a"], allowNull: false },
      `"c" IS NOT NULL AND "c" NOT IN ('n/a')`,
    ],
    [
      { kind: "pattern", column: "c", pattern: "^[A-Z]{3}$" },
      `"c" IS NULL OR regexp_matches("c", '^[A-Z]{3}$')`,
    ],
    [
      { kind: "length", column: "c", min: 3, max: 9 },
      `"c" IS NULL OR length("c") >= 3 AND length("c") <= 9`,
    ],
    [
      { kind: "range", column: "c", min: 0, max: 150, exclusive: true },
      `"c" IS NULL OR "c" > 0 AND "c" < 150`,
    ],
    [{ kind: "range", column: "d", min: "2020-01-01" }, `"d" IS NULL OR "d" >= '2020-01-01'`],
    [{ kind: "multipleOf", column: "c", value: 5 }, `"c" IS NULL OR "c" % 5 = 0`],
    [
      { kind: "items", column: "t", min: 1, max: 5, unique: true },
      `"t" IS NULL OR len("t") >= 1 AND len("t") <= 5 AND len(list_distinct("t")) = len("t")`,
    ],
  ];
  it.each(cases)("%j", (rule, condition) => {
    expect(ruleCondition(rule)).toBe(condition);
  });

  it("quotes a column with a double quote", () => {
    expect(ruleCondition({ kind: "notNull", column: 'a"b' })).toBe(`"a""b" IS NOT NULL`);
  });

  it("uses an expectation's check text when it has no rule", () => {
    const own: Expectation = {
      name: "positive",
      check: "id > 0",
      action: "warn",
      from: "definition",
    };
    expect(conditionOf(own)).toBe("id > 0");
    expect(conditionOf({ ...own, rule: { kind: "notNull", column: "id" } })).toBe(
      `"id" IS NOT NULL`,
    );
  });
});

describe("null semantics in DuckDB", () => {
  /** Whether a row with a null `c` passes the rule. */
  const nullPasses = async (rule: RowRule) => {
    const [row] = await execute(
      ":memory:",
      "SELECT 1",
      `SELECT coalesce(${ruleCondition(rule)}, FALSE) AS passes FROM (SELECT CAST(NULL AS VARCHAR) AS "c", CAST(NULL AS VARCHAR[]) AS "t")`,
    );
    return row?.passes;
  };

  it("fails notNull, and in and notIn without allowNull", async () => {
    expect(await nullPasses({ kind: "notNull", column: "c" })).toBe(false);
    expect(await nullPasses({ kind: "in", column: "c", values: ["a"], allowNull: false })).toBe(
      false,
    );
    expect(await nullPasses({ kind: "notIn", column: "c", values: ["a"], allowNull: false })).toBe(
      false,
    );
  });

  it("passes in and notIn with allowNull, and every other kind", async () => {
    expect(await nullPasses({ kind: "in", column: "c", values: ["a"], allowNull: true })).toBe(
      true,
    );
    expect(await nullPasses({ kind: "notIn", column: "c", values: ["a"], allowNull: true })).toBe(
      true,
    );
    expect(await nullPasses({ kind: "pattern", column: "c", pattern: "a" })).toBe(true);
    expect(await nullPasses({ kind: "length", column: "c", min: 1 })).toBe(true);
    expect(await nullPasses({ kind: "range", column: "c", min: "a" })).toBe(true);
    expect(await nullPasses({ kind: "items", column: "t", min: 1, unique: true })).toBe(true);
  });

  it("matches a pattern anywhere in the text, as RLIKE does", async () => {
    const [row] = await execute(
      ":memory:",
      "SELECT 1",
      `SELECT ${ruleCondition({ kind: "pattern", column: "c", pattern: "b" })} AS passes FROM (SELECT 'abc' AS "c")`,
    );
    expect(row?.passes).toBe(true);
  });
});
