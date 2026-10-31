// The pack: DuckDB loads files into tables, runs transforms and publishes
// Parquet, locally or wherever DuckDB runs.
import type { Pack } from "@ingestron/definitions";
import { build } from "./build.js";
import { contract } from "./contract.js";
import { duckdbFiles, duckdbLanded, duckdbSql, duckdbTable } from "./methods.js";
import { duckdbTypes } from "./types.js";

/**
 * The DuckDB pack.
 * @example loadDefinitions("definitions", { packs: [duckdb], environment: "local" })
 */
export const duckdb: Pack = {
  id: "duckdb",
  version: 1,
  defaults: {
    naming: {
      catalog: "{{ project }}",
      schema: "{{ layer }}",
      table: "{{ table }}",
      pipeline: "{{ project }}",
      job: "{{ project }}_refresh",
    },
    layers: ["bronze", "silver", "gold"],
    types: duckdbTypes,
    quality: { required: "warn", default: "warn" },
  },
  rules: {
    ingest: { default: "duckdb-files" },
    store: { default: "duckdb-table" },
    transform: { default: "duckdb-sql" },
  },
  methods: {
    "duckdb-files": duckdbFiles,
    "duckdb-landed": duckdbLanded,
    "duckdb-table": duckdbTable,
    "duckdb-sql": duckdbSql,
  },
  build,
  contract,
};
