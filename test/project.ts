// A small project on disk: files in a folder, loaded and published by DuckDB.
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryFiles } from "@ingestron/config";
import { resolveDefinitions, type Pack, type ResolvedModel } from "@ingestron/definitions";
import { DuckDBInstance } from "@duckdb/node-api";
import { expect } from "vitest";
import { duckdb } from "../src/index.js";

/** A fresh folder with `in/orders/` and `published/`. */
export function folder(): { root: string; input: string; published: string } {
  const root = mkdtempSync(join(tmpdir(), "ingestron-duckdb-"));
  const input = join(root, "in");
  const published = join(root, "published");
  mkdirSync(join(input, "orders"), { recursive: true });
  mkdirSync(published);
  return { root, input, published };
}

export const contract = (key = "primaryKey: true") =>
  [
    "apiVersion: v3.1.0",
    "kind: DataContract",
    "id: orders",
    "version: 1.0.0",
    "status: active",
    "schema:",
    "  - name: orders",
    "    logicalType: object",
    "    properties:",
    `      - { name: id, logicalType: integer, ${key} }`,
    "      - { name: name, logicalType: string }",
    "      - { name: seq, logicalType: integer }",
    "",
  ].join("\n");

/** The project's files for a folder, with the store's settings and any changes. */
export function project(
  where: { input: string; published: string },
  store = "{}",
  changes: Record<string, string> = {},
): Record<string, string> {
  return {
    "project.yaml": "id: shop\nenvironments: { dev: {} }\nimports: ['*.yaml']\n",
    "standard.yaml": `apiVersion: ingestron.io/v1\nkind: Standard\nid: acme\npacks: [duckdb@1]\nstore: { settings: { duckdb-table: ${store} } }\n`,
    "platform.yaml": `apiVersion: ingestron.io/v1\nkind: Platform\nid: local\nsettings:\n  duckdb-table: { published: "${where.published}" }\n`,
    "shop.yaml": `apiVersion: ingestron.io/v1\nkind: Connection\nid: shop\nconnector: files\nconnectivity: public\nsettings: { path: "${where.input}" }\n`,
    "flow.yaml":
      "apiVersion: ingestron.io/v1\nkind: Flow\nid: shop\nsource: shop\ntables:\n  orders: { object: orders/*.parquet, contract: orders }\n",
    "orders.yaml": contract(),
    ...changes,
  };
}

/** Resolves the files and builds the pack's output. */
export function generate(
  files: Record<string, string>,
  packs: Pack[] = [duckdb],
  environment = "dev",
) {
  const result = resolveDefinitions(memoryFiles(files), { packs, environment });
  const model = result.model as ResolvedModel | undefined;
  return { result, files: model ? duckdb.build(model) : {} };
}

/** run.sql, after checking the project resolved without errors. */
export function runSql(files: Record<string, string>): string {
  const { result, files: built } = generate(files);
  expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  return built["run.sql"] ?? "";
}

/** Runs SQL in a database file and returns the rows of `query`. */
export async function execute(database: string, sql: string, query: string) {
  const instance = await DuckDBInstance.create(database);
  const connection = await instance.connect();
  await connection.run(sql);
  const reader = await connection.runAndReadAll(query);
  const rows = reader.getRowObjectsJson();
  connection.closeSync();
  return rows;
}

/** Writes rows as a Parquet file with DuckDB. */
export async function writeParquet(path: string, values: string): Promise<void> {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  await connection.run(
    `COPY (SELECT * FROM (VALUES ${values}) t(id, name, seq)) TO '${path}' (FORMAT parquet)`,
  );
  connection.closeSync();
}
