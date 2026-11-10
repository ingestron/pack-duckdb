// What the pack does with the quality and cleansing paths of intent (spec/behaviour.md,
// "Quality and cleansing"): checks in run.sql, only in a layer whose does lists check;
// quarantine only where it lists quarantine; results, cleansing and deduplicate wherever the
// model gives them.
import type { FeatureStatus, IntentUse, LayerDuty } from "@ingestron/definitions";

/** The pages each entry's status comes from; all were read on 2026-11-10. */
const pages = {
  transactions: "https://duckdb.org/docs/2.0/sql/statements/transactions",
  utility: "https://duckdb.org/docs/2.0/sql/functions/utility",
  aggregates: "https://duckdb.org/docs/2.0/sql/functions/aggregates",
  list: "https://duckdb.org/docs/2.0/sql/functions/list",
  create: "https://duckdb.org/docs/2.0/sql/statements/create_table",
  text: "https://duckdb.org/docs/2.0/sql/functions/text",
  case: "https://duckdb.org/docs/2.0/sql/expressions/case",
  timestamptz: "https://duckdb.org/docs/2.0/sql/functions/timestamptz",
  qualify: "https://duckdb.org/docs/2.0/sql/query_syntax/qualify",
};

/** Generally available: the page carries no release label. */
const ga = (source: string): FeatureStatus => ({ level: "ga", checked: "2026-11-10", source });
const used = (does: string, source: string, onlyWhere?: LayerDuty): IntentUse => ({
  use: "used",
  does,
  status: ga(source),
  ...(onlyWhere && { onlyWhere }),
});

/** The quality and cleansing entries of the pack. */
export const qualityIntent: Record<string, IntentUse> = {
  "quality.rules": used(
    "A check in run.sql, in the run's transaction, written from the rule.",
    pages.transactions,
    "check",
  ),
  "quality.actions=warn": used(
    "The row is kept; the run prints how many rows fail.",
    pages.transactions,
    "check",
  ),
  "quality.actions=drop": used(
    "The row is not inserted; the run prints how many rows fail.",
    pages.transactions,
    "check",
  ),
  "quality.actions=fail": used(
    "error() before the insert: the run stops and nothing is published.",
    pages.utility,
    "check",
  ),
  "quality.table-checks": used(
    "Counted after the table is built: fail raises error(), warn prints the count.",
    pages.aggregates,
    "check",
  ),
  "quality.quarantine": used(
    "The rows a drop check leaves out are inserted into <table>_quarantine, with _failed_checks.",
    pages.list,
    "quarantine",
  ),
  "quality.results": used(
    "Each check's result in <schema>._ingestron_checks, in the run's transaction.",
    pages.create,
  ),
  "cleanse.trim": used("trim() in the table's SELECT.", pages.text),
  "cleanse.empty": used("nullif(<column>, '') in the table's SELECT.", pages.utility),
  "cleanse.map": used("A CASE expression in the table's SELECT.", pages.case),
  "cleanse.case": used("upper() or lower() in the table's SELECT.", pages.text),
  "cleanse.default": used("coalesce() in the table's SELECT.", pages.utility),
  "cleanse.timezone": used(
    "(<column> AT TIME ZONE '<from>') AT TIME ZONE '<to>' in the table's SELECT.",
    pages.timestamptz,
  ),
  deduplicate: used(
    "QUALIFY row_number() … = 1 in a table that is replaced each run.",
    pages.qualify,
  ),
};
