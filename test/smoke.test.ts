// The runner's smoke project: its run.sql is what this pack generates, so the
// image is tested on real output. Regenerate with UPDATE_SMOKE=1.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { memoryFiles } from "@ingestron/config";
import { resolveDefinitions } from "@ingestron/definitions";
import { expect, it } from "vitest";
import { duckdb } from "../src/index.js";

const smoke = join(import.meta.dirname, "../runner/smoke/run.sql");

const files = {
  "project.yaml": "id: smoke\nenvironments: { dev: {} }\nimports: ['*.yaml']\n",
  "standard.yaml":
    "apiVersion: ingestron.io/v1\nkind: Standard\nid: s\npacks: [duckdb@1]\ningest: { settings: { duckdb-files: { format: csv } } }\n",
  "platform.yaml":
    "apiVersion: ingestron.io/v1\nkind: Platform\nid: p\nsettings: { duckdb-table: { published: ./published } }\n",
  "shop.yaml":
    "apiVersion: ingestron.io/v1\nkind: Connection\nid: shop\nconnector: files\nconnectivity: public\nsettings: { path: ./samples }\n",
  "flow.yaml":
    "apiVersion: ingestron.io/v1\nkind: Flow\nid: shop\nsource: shop\ntables:\n  orders: { object: orders.csv, contract: orders }\n",
  "orders.yaml":
    "apiVersion: v3.1.0\nkind: DataContract\nid: orders\nversion: 1.0.0\nstatus: active\nschema:\n  - name: orders\n    logicalType: object\n    properties:\n      - { name: id, logicalType: integer }\n      - { name: name, logicalType: string }\n",
};

it("tests the runner on the run.sql this pack generates", () => {
  const result = resolveDefinitions(memoryFiles(files), { packs: [duckdb], environment: "dev" });
  const generated = duckdb.build(result.model!)["run.sql"]!;
  if (process.env.UPDATE_SMOKE === "1") writeFileSync(smoke, generated);
  expect(readFileSync(smoke, "utf8")).toBe(generated);
});
