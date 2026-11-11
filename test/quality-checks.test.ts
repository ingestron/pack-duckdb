// The CRM fixture's checks, run with DuckDB (spec/behaviour.md, "Row checks", "Results" and
// "Quarantine"): what the run prints, the quarantined rows, the kept results, and a fail check
// that stops the run.
import { statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { crm, customer, customers } from "./crm.js";
import { execute, runPrinting, writeQuery } from "./project.js";

describe("the CRM fixture's checks", () => {
  it("prints each check's failing rows: warn keeps them, drop leaves them out", async () => {
    const { where, sql } = await crm();
    const run = await runPrinting(join(where.root, "ingestron.duckdb"), sql);
    const printed = run.printed.flat();
    const row = (check: string) =>
      printed.find((item) => item.table === "silver.customers_clean" && item.check === check);
    expect(row("country_invalidvalues")).toEqual({
      table: "silver.customers_clean",
      check: "country_invalidvalues",
      action: "warn",
      failing_rows: "1",
      passed: false,
    });
    expect(row("status_missingvalues")).toMatchObject({ action: "warn", failing_rows: "1" });
    expect(row("email_not_null")).toMatchObject({ action: "drop", failing_rows: "1" });
    expect(row("recent")).toMatchObject({ action: "fail", failing_rows: "0", passed: true });
    expect(row("email_pattern")).toMatchObject({ action: "warn", failing_rows: "0" });
  });

  it("quarantines the rows a drop check leaves out, naming the checks", async () => {
    const { where, sql } = await crm();
    const database = join(where.root, "ingestron.duckdb");
    await runPrinting(database, sql);
    expect(
      await execute(
        database,
        "SELECT 1",
        "SELECT id, _failed_checks FROM silver.customers_clean_quarantine ORDER BY id",
      ),
    ).toEqual([{ id: "2", _failed_checks: ["email_not_null"] }]);
    expect(
      await execute(
        database,
        "SELECT 1",
        "SELECT id, _failed_checks FROM silver.orders_clean_quarantine ORDER BY id",
      ),
    ).toEqual([{ id: "4", _failed_checks: ["updated_at_not_null"] }]);
  });

  it("keeps each check's result in _ingestron_checks, one run id per run", async () => {
    const { where, sql } = await crm();
    const database = join(where.root, "ingestron.duckdb");
    await runPrinting(database, sql);
    await runPrinting(database, sql);
    const runs = await execute(
      database,
      "SELECT 1",
      "SELECT count(DISTINCT run_id) AS runs, count(*) AS checks, count(DISTINCT checked_at) AS times FROM silver._ingestron_checks",
    );
    // 18 checks of customers_clean (17 from the contract and recent) and 3 of orders_clean, twice.
    expect(runs).toEqual([{ runs: "2", checks: "42", times: "2" }]);
    expect(
      await execute(
        database,
        "SELECT 1",
        `SELECT "table", "check", action, failing_rows, passed FROM silver._ingestron_checks WHERE NOT passed ORDER BY "table", "check" LIMIT 4`,
      ),
    ).toEqual([
      {
        table: "silver.customers_clean",
        check: "country_invalidvalues",
        action: "warn",
        failing_rows: "1",
        passed: false,
      },
      {
        table: "silver.customers_clean",
        check: "country_invalidvalues",
        action: "warn",
        failing_rows: "1",
        passed: false,
      },
      {
        table: "silver.customers_clean",
        check: "email_not_null",
        action: "drop",
        failing_rows: "1",
        passed: false,
      },
      {
        table: "silver.customers_clean",
        check: "email_not_null",
        action: "drop",
        failing_rows: "1",
        passed: false,
      },
    ]);
  });

  it("stops at a failing fail check: the run rolls back and publishes nothing", async () => {
    const { where, input, sql } = await crm();
    const database = join(where.root, "ingestron.duckdb");
    await runPrinting(database, sql);
    const published = join(where.root, "published", "silver.customers_clean.parquet");
    const before = statSync(published).mtimeMs;
    await writeQuery(
      join(input, "customers", "c.parquet"),
      customers([
        customer(
          "6, 'fi@example.com', 'Fi', 'GB', 'active', 'retail', '5', 'ABC', 33, 30, ['f'], FALSE, '1999-06-01 09:00:00', NULL, NULL, '1999-06-01 09:00:00'",
        ),
      ]),
    );
    const run = await runPrinting(database, sql);
    expect(run.error).toContain(
      'The check "recent" failed for 1 rows of silver.customers_clean, so nothing is published.',
    );
    const counts = await execute(
      database,
      "SELECT 1",
      "SELECT (SELECT count(*) FROM bronze.customers) AS bronze, (SELECT count(*) FROM silver.customers_clean) AS silver, (SELECT count(DISTINCT run_id) FROM silver._ingestron_checks) AS runs",
    );
    expect(counts).toEqual([{ bronze: "6", silver: "4", runs: "1" }]);
    expect(statSync(published).mtimeMs).toBe(before);
  });
});
