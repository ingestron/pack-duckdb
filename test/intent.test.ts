// Intent (spec/behaviour.md, "Intent"): what the pack declares it applies, the settings that are
// other names for intent, and the audit columns it adds.
import { intentCoverageGaps, intentUseOf, type Method } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { duckdb } from "../src/index.js";
import { folder, generate, project, runSql } from "./project.js";

const standard = (lines: string[], store = "{}") =>
  [
    "apiVersion: ingestron.io/v1",
    "kind: Standard",
    "id: acme",
    "packs: [duckdb@2]",
    `store: { settings: { duckdb-table: ${store} } }`,
    ...lines,
    "",
  ].join("\n");

const flow = (table: string) =>
  `apiVersion: ingestron.io/v1\nkind: Flow\nid: shop\nsource: shop\ntables:\n  orders: { object: orders/*.parquet, contract: orders${table} }\n`;

const bronzeAudit = (audit: string) =>
  standard([`layers: [{ name: bronze, audit: ${audit} }, silver, gold]`]);

describe("the pack's intent coverage", () => {
  it("covers every intent path and value", () => {
    expect(intentCoverageGaps(duckdb)).toEqual([]);
    for (const method of Object.values(duckdb.methods))
      expect(
        intentCoverageGaps({ intent: { ...duckdb.intent, ...(method as Method).intent } }),
      ).toEqual([]);
  });

  it("declares what it builds as used, with the date its status was checked", () => {
    for (const key of [
      "load.mode=files",
      "load.mode=full",
      "history=none",
      "history=latest",
      "sequence",
      "audit=loaded_at",
      "audit=source_file",
    ])
      expect(duckdb.intent?.[key], key).toMatchObject({
        use: "used",
        status: { level: "ga", checked: "2026-11-09" },
      });
  });

  it("leaves landed files and the ingest step's audit values to the landing pack", () => {
    expect(intentUseOf(duckdb, "retention.landed_files")?.use).toBe("elsewhere");
    for (const value of [
      "run_id",
      "window_start",
      "window_end",
      "source_object",
      "source_connection",
    ])
      expect(intentUseOf(duckdb, "audit", value)?.use, value).toBe("elsewhere");
  });

  it("has no scheduler, so operations do not apply", () => {
    for (const path of ["trigger", "retries", "timeout", "alerts", "concurrency"])
      expect(intentUseOf(duckdb, `operations.${path}`, "failure")).toEqual({
        use: "not-applicable",
        reason: "DuckDB runs locally or as one job; it has no scheduler.",
      });
  });

  it("plans the rest", () => {
    for (const [path, value] of [
      ["history", "full"],
      ["history", "bitemporal"],
      ["load.mode", "incremental"],
      ["audit", "row_hash"],
      ["audit", "source_modified_at"],
      ["rescued", "true"],
      ["storage.clustering", "auto"],
      ["quality.results", "true"],
    ])
      expect(intentUseOf(duckdb, path!, value), `${path}=${value}`).toEqual({
        use: "not-yet",
        reason: "Planned.",
      });
  });

  it("does not claim the ingest audit values where duckdb-files reads the files itself", () => {
    const files = duckdb.methods["duckdb-files"] as Method;
    expect(intentUseOf(files, "audit", "run_id")?.use).toBe("not-yet");
    const landed = duckdb.methods["duckdb-landed"] as Method;
    expect(
      intentUseOf({ intent: { ...duckdb.intent, ...landed.intent } }, "audit", "run_id")?.use,
    ).toBe("elsewhere");
  });

  it("has an empty Platform section", () => {
    expect(duckdb.platformSection).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {},
    });
  });
});

describe("the mode and sequence_by settings", () => {
  it("builds the same run.sql from `history: latest` as from `mode: upsert`", () => {
    const where = folder();
    const fromSettings = runSql(project(where, "{ mode: upsert }"));
    const fromIntent = runSql(project(where, "{}", { "flow.yaml": flow(", history: latest") }));
    expect(fromIntent).toBe(fromSettings);
    expect(fromIntent).toContain("INSERT OR REPLACE");
  });

  it("builds the same run.sql from `history: none` with `load: files` as from `mode: append`", () => {
    const where = folder();
    const fromSettings = runSql(project(where, "{ mode: append }"));
    const fromIntent = runSql(
      project(where, "{}", { "flow.yaml": flow(", history: none, load: { mode: files }") }),
    );
    expect(fromIntent).toBe(fromSettings);
  });

  it("builds the same run.sql from `history: none` with `load: full` as from `mode: replace`", () => {
    const where = folder();
    const fromIntent = runSql(
      project(where, "{}", { "flow.yaml": flow(", history: none, load: { mode: full }") }),
    );
    expect(fromIntent).toBe(runSql(project(where)));
  });

  it("builds the same run.sql from `sequence` as from `sequence_by`", () => {
    const where = folder();
    const fromSettings = runSql(project(where, "{ mode: upsert, sequence_by: seq }"));
    const fromIntent = runSql(
      project(where, "{}", { "flow.yaml": flow(", history: latest, sequence: seq") }),
    );
    expect(fromIntent).toBe(fromSettings);
    expect(fromIntent).toContain('ORDER BY "seq" DESC');
  });

  it("builds a project without intent as before", () => {
    const where = folder();
    const files = project(where);
    expect(runSql(files)).toContain('CREATE OR REPLACE TABLE "bronze"."orders" AS SELECT');
    const model = generate(files).result.model!;
    expect(model.tables[0]!.intent).toEqual({ load: { mode: "files" }, history: "none" });
    expect(model.tables[0]!.store!.settings.mode).toBe("replace");
  });
});

describe("audit columns", () => {
  it('adds `now() AS "_loaded_at"` to a table\'s build, and keeps it in the published statement', () => {
    const where = folder();
    const files = project(where, "{}", { "standard.yaml": bronzeAudit("[loaded_at]") });
    const { result, files: built } = generate(files);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const sql = built["tables/bronze.orders.sql"]!;
    expect(sql).toContain('now() AS "_loaded_at" FROM read_parquet(');
    expect(sql).toMatch(
      /COPY \(SELECT "id", "name", "seq", "_loaded_at" FROM "bronze"\."orders"\)/,
    );
  });
});
