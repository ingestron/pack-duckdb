// What the pack does with each intent path and value (spec/behaviour.md, "Intent").
// Every other path and value is planned: the mapping in the spec is the target.
import {
  intentPaths,
  type FeatureStatus,
  type IntentUse,
  type SettingAlias,
} from "@ingestron/definitions";

/** The pages that give each feature's release status; all were read on 2026-11-09. */
const pages = {
  readers: "https://duckdb.org/docs/2.0/data/multiple_files/overview",
  parquet: "https://duckdb.org/docs/2.0/data/parquet/overview",
  insert: "https://duckdb.org/docs/2.0/sql/statements/insert",
  window: "https://duckdb.org/docs/2.0/sql/functions/window_functions",
  timestamps: "https://duckdb.org/docs/2.0/sql/functions/timestamptz",
};

const ga = (source: string): FeatureStatus => ({ level: "ga", checked: "2026-11-09", source });
const used = (does: string, source: string): IntentUse => ({
  use: "used",
  does,
  status: ga(source),
});
const notYet: IntentUse = { use: "not-yet", reason: "Planned." };
const landing: IntentUse = {
  use: "elsewhere",
  reason: "The ingest step that lands the files adds it.",
};

/** The audit values the ingest step adds, which reading files in place cannot. */
const ingestAudit = ["run_id", "window_start", "window_end", "source_object", "source_connection"];

/** Every path and value as planned, so each takes the entry below it, if any. */
function planned(): Record<string, IntentUse> {
  return Object.fromEntries(
    Object.keys(intentPaths).map((path) => [
      path,
      path.startsWith("operations.")
        ? ({
            use: "not-applicable",
            reason: "DuckDB runs locally or as one job; it has no scheduler.",
          } satisfies IntentUse)
        : notYet,
    ]),
  );
}

/** The pack's coverage: what it builds, `elsewhere` for the landing pack's work, the rest planned. */
export const intent: Record<string, IntentUse> = {
  ...planned(),
  "load.mode=files": used("Each file is read once, into an appended table.", pages.readers),
  "load.mode=full": used("Every file is read each run, into a replaced table.", pages.readers),
  "history=none": used("Replace or append: the rows as they arrived.", pages.insert),
  "history=latest": used(
    "INSERT OR REPLACE of the last row per primary key (row_number() … QUALIFY).",
    pages.insert,
  ),
  sequence: used("The column that orders a key's rows in the window function.", pages.window),
  "audit=loaded_at": used("A column of now().", pages.timestamps),
  "audit=source_file": used("A column of the reader's filename option.", pages.parquet),
  ...Object.fromEntries(ingestAudit.map((value) => [`audit=${value}`, landing])),
  "retention.landed_files": {
    use: "elsewhere",
    reason: "The landing pack keeps landed files.",
  },
};

/** What differs for `duckdb-files`, which reads the files in place: nothing lands them. */
export const filesIntent: Record<string, IntentUse> = Object.fromEntries(
  ingestAudit.map((value) => [`audit=${value}`, notYet]),
);

/**
 * `duckdb-table`'s `mode` and `sequence_by` are other names for intent: a replaced table is
 * the whole selection with no history, an appended one the new files with no history, and
 * an upserted one the latest row per key.
 */
export const tableAliases: Record<string, SettingAlias> = {
  mode: {
    values: {
      replace: { load: { mode: "full" }, history: "none" },
      append: { load: { mode: "files" }, history: "none" },
      upsert: { history: "latest" },
    },
  },
  sequence_by: { path: "sequence" },
};
