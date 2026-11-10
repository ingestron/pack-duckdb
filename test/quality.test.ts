// Quality and cleansing (spec/behaviour.md, "Quality and cleansing"), run with DuckDB on the
// shared synthetic CRM fixture: bronze keeps the files as they come, silver cleanses,
// deduplicates, checks and quarantines, and keeps its checks' results.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { crm } from "./crm.js";
import { execute, runPrinting } from "./project.js";

describe("the CRM fixture", () => {
  it("resolves, applying silver's checks, cleansing, quarantine and results", async () => {
    const { result } = await crm();
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    // Bronze keeps raw rows, so its 20 rules (17 of customers, 3 of orders) are not applied
    // there; silver applies all of its own, and every cleansing operation.
    const notApplied = result.diagnostics.filter((item) => item.code === "NOT_APPLIED");
    expect(notApplied).toHaveLength(20);
    expect(new Set(notApplied.map((item) => item.hint))).toEqual(
      new Set(["Add `check` to the layer's `does` to apply it here."]),
    );
    expect(result.model?.tables.find((table) => table.name === "orders_clean")?.timezone).toBe(
      "UTC",
    );
  });

  it("keeps bronze's SQL as it was: no checks, no cleansing", async () => {
    const { sql } = await crm();
    const bronze = sql.slice(sql.indexOf('CREATE SCHEMA IF NOT EXISTS "bronze"'));
    expect(bronze.slice(0, bronze.indexOf('CREATE SCHEMA IF NOT EXISTS "silver"'))).not.toMatch(
      /ingestron_rows|AT TIME ZONE|trim\(/,
    );
  });

  it("drops failing rows, keeps the latest row per key, and cleanses", async () => {
    const { where, sql } = await crm();
    const database = join(where.root, "ingestron.duckdb");
    const run = await runPrinting(database, sql);
    expect(run.error).toBeUndefined();
    expect(
      await execute(
        database,
        "SELECT 1",
        "SELECT id, email, name, country, status, score, vip FROM silver.customers_clean ORDER BY id",
      ),
    ).toEqual([
      {
        id: "1",
        email: "ann@example.com",
        name: " Ann ",
        country: "GB",
        status: "active",
        score: "0",
        vip: false,
      },
      {
        id: "3",
        email: "cy@example.com",
        name: "Cy",
        country: "XX",
        status: "active",
        score: "15",
        vip: false,
      },
      {
        id: "4",
        email: "di@example.com",
        name: "Di",
        country: null,
        status: "n/a",
        score: "20",
        vip: true,
      },
      {
        id: "5",
        email: "ed@example.com",
        name: "Ed",
        country: "IE",
        status: "active",
        score: "25",
        vip: false,
      },
    ]);
    expect(
      await execute(database, "SELECT 1", "SELECT id, status FROM silver.orders_clean ORDER BY id"),
    ).toEqual([{ id: "1", status: "DELIVERED" }]);
  });

  it("turns London wall times into UTC on both sides of each clock change", async () => {
    const { where, sql } = await crm();
    const database = join(where.root, "ingestron.duckdb");
    await runPrinting(database, sql);
    const times = await execute(
      database,
      "SELECT 1",
      "SELECT id, strftime(signed_up, '%Y-%m-%d %H:%M') AS signed_up, strftime(updated_at, '%Y-%m-%d %H:%M') AS updated_at, strftime(contacted_at, '%Y-%m-%d %H:%M') AS contacted_at, strftime(last_seen, '%Y-%m-%d %H:%M') AS last_seen FROM silver.customers_clean ORDER BY id",
    );
    expect(times).toEqual([
      // After the spring change (BST, UTC+1); contacted_at goes from UTC to London.
      {
        id: "1",
        signed_up: "2026-03-29 01:30",
        updated_at: "2026-03-29 00:30",
        contacted_at: "2026-03-29 02:30",
        last_seen: "2026-03-29 01:30",
      },
      // The repeated hour is read as the later one (GMT); after the autumn change.
      {
        id: "3",
        signed_up: "2026-10-25 01:30",
        updated_at: "2026-10-25 02:30",
        contacted_at: "2026-10-25 01:30",
        last_seen: null,
      },
      // The skipped hour is read in the offset before the change (GMT).
      {
        id: "4",
        signed_up: "2026-03-29 01:30",
        updated_at: "2026-03-29 01:30",
        contacted_at: null,
        last_seen: null,
      },
      // Before the spring change (GMT) and before the autumn change (BST).
      {
        id: "5",
        signed_up: "2026-03-29 00:30",
        updated_at: "2026-10-24 23:30",
        contacted_at: "2026-10-25 01:30",
        last_seen: null,
      },
    ]);
  });
});
