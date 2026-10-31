// The pack's methods: read landed files or a folder of files, keep a table in
// the DuckDB database and publish it as Parquet, and run transforms.
import type { Method, ResolvedTable } from "@ingestron/definitions";

const csv = {
  type: "object",
  additionalProperties: false,
  description: "How CSV files are read.",
  properties: {
    header: { type: "boolean", description: "The first row names the columns." },
    delimiter: {
      type: "string",
      description: "The field separator.",
      examples: [",", ";", "|"],
    },
  },
};

const object = (table: ResolvedTable) => table.ingest!.object.replace(/^\/+/, "");

/** Reads the files another pack's method lands, from a local folder; chosen by runs-on. */
export const duckdbLanded: Method = {
  action: "ingest",
  description:
    "Reads the files another pack's method lands, from the folder `landing` names, for an environment that runs on DuckDB.",
  reads: "landed",
  produces: "files",
  placement: { platform: ["landing"] },
  settings: {
    type: "object",
    additionalProperties: false,
    required: ["landing"],
    properties: {
      landing: {
        type: "string",
        description:
          "The folder that holds each table's landed files, in a folder named after its object.",
        examples: ["./samples"],
      },
    },
  },
  output: (table) => ({
    location: `${String(table.ingest!.settings.landing).replace(/\/+$/, "")}/${object(table)}/*.parquet`,
    format: "parquet",
    loads: "add",
  }),
};

/** Reads files where they are: the connection's folder and the table's object (a file or pattern). */
export const duckdbFiles: Method = {
  action: "ingest",
  description:
    "Reads files where they are: the connection's path and the table's object, a file or a pattern.",
  connectors: ["files"],
  produces: "files",
  defaults: { format: "parquet", csv: { header: true, delimiter: "," } },
  placement: { standard: ["csv"] },
  settings: {
    type: "object",
    additionalProperties: false,
    properties: {
      format: {
        enum: ["parquet", "csv", "json"],
        enumDescriptions: ["Parquet files.", "CSV files; see csv.", "JSON files."],
        description: "The files' format.",
      },
      csv,
    },
  },
  output: (table) => {
    const path = String(table.ingest!.connection.settings.path ?? "").replace(/\/+$/, "");
    return {
      location: `${path}/${object(table)}`,
      format: table.ingest!.settings.format as "parquet" | "csv" | "json",
      loads: "add",
    };
  },
};

/** Keeps the table in the DuckDB database, and publishes it as Parquet. */
export const duckdbTable: Method = {
  action: "store",
  description:
    "Keeps the table in the DuckDB database, loading the landed files or the transform's query, and publishes it as Parquet.",
  accepts: ["files", "query"],
  produces: "table",
  defaults: { mode: "replace" },
  placement: { platform: ["published"] },
  settings: {
    type: "object",
    additionalProperties: false,
    required: ["published"],
    properties: {
      mode: {
        enum: ["replace", "append", "upsert"],
        enumDescriptions: [
          "The table is the files' rows, each run.",
          "Each file's rows are added once.",
          "Rows replace those with the same primary key; sequence_by picks the latest.",
        ],
        description: "How the files' rows reach the table.",
      },
      sequence_by: {
        type: "string",
        description: "Upsert: the column that orders a key's rows; the last wins.",
        examples: ["updated_at"],
      },
      published: {
        type: "string",
        description:
          "The folder each table is published to, as <schema>.<table>.parquet. It must exist.",
        examples: ["./published"],
      },
    },
  },
  output: (table) => ({
    location: `${String(table.store!.settings.published).replace(/\/+$/, "")}/${table.fullName.schema}.${table.fullName.table}.parquet`,
    format: "parquet",
    loads: "replace",
  }),
  check: (table) => {
    if (!table.transform && !table.ingest?.output)
      return [
        `"${table.ingest?.method}" does not say where its files land, so DuckDB cannot read them`,
      ];
    return table.store!.settings.mode === "upsert" && table.contract.primaryKey.length === 0
      ? ["upsert needs the contract's primaryKey"]
      : [];
  },
};

const reference = /\{\{\s*tables\.([A-Za-z0-9_-]+)\s*\}\}/g;

/** A transform's SQL in DuckDB, kept by duckdb-table. */
export const duckdbSql: Method = {
  action: "transform",
  description: "The transform's SQL in DuckDB, over its inputs' tables; duckdb-table keeps it.",
  accepts: ["table"],
  produces: "query",
  settings: { type: "object", additionalProperties: false, properties: {} },
  check: (table) => {
    const { code, inputs } = table.transform!;
    return [...code.matchAll(reference)]
      .map((match) => match[1]!)
      .filter((input) => !(input in inputs))
      .map((input) => `the SQL names {{ tables.${input} }}, which is not in inputs`);
  },
};
