// Under runs-on: DuckDB reads the files another pack lands, from a local folder.
import type { Pack } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { duckdb } from "../src/index.js";
import { contract, folder, generate, project } from "./project.js";

/** A pack that lands files somewhere DuckDB cannot see, and says where only when asked to. */
const copier = (output: boolean): Pack => ({
  ...duckdb,
  id: "copier",
  rules: { ingest: { default: "copy" } },
  methods: {
    copy: {
      action: "ingest",
      description: "Copies files to cloud storage.",
      connectors: ["files"],
      produces: "files",
      settings: { type: "object" },
      ...(output && {
        output: () => ({
          location: "abfss://landing@acct/orders/*.parquet",
          format: "parquet",
          loads: "add",
        }),
      }),
    },
  },
  build: () => ({}),
});

describe("runs-on", () => {
  it("reads the landed files from the local folder in an environment that runs on DuckDB", () => {
    const where = folder();
    const files = project(where, "{}", {
      "project.yaml":
        "id: shop\nenvironments: { dev: {}, local: { runs-on: duckdb } }\nimports: ['*.yaml']\n",
      "standard.yaml":
        "apiVersion: ingestron.io/v1\nkind: Standard\nid: acme\npacks: [duckdb@1, copier@1]\ningest: { settings: { duckdb-landed: { landing: ./samples } } }\n",
      "flow.yaml":
        "apiVersion: ingestron.io/v1\nkind: Flow\nid: shop\nsource: shop\ningest: { uses: copy }\ntables:\n  orders: { object: orders, contract: orders }\n",
    });
    const { result, files: built } = generate(files, [duckdb, copier(true)], "local");
    expect(result.diagnostics).toEqual([]);
    expect(built["run.sql"]).toContain("FROM read_parquet('./samples/orders/*.parquet');");
  });

  it("refuses files whose ingest does not say where they land", () => {
    const where = folder();
    const files = project(where, "{}", {
      "standard.yaml":
        "apiVersion: ingestron.io/v1\nkind: Standard\nid: acme\npacks: [duckdb@1, copier@1]\n",
      "flow.yaml":
        "apiVersion: ingestron.io/v1\nkind: Flow\nid: shop\nsource: shop\ningest: { uses: copy }\ntables:\n  orders: { object: orders, contract: orders }\n",
    });
    expect(
      generate(files, [duckdb, copier(false)]).result.diagnostics.map(({ message }) => message),
    ).toEqual([
      '"duckdb-table" for table "orders": "copy" does not say where its files land, so DuckDB cannot read them.',
    ]);
  });

  it("writes the same SQL for the cloud and the local environment, apart from where the files are", () => {
    const where = folder();
    const renaming: Pack = {
      ...copier(true),
      methods: { copy: { ...copier(true).methods.copy!, renames: true } },
    };
    const files = project(where, "{}", {
      "project.yaml":
        "id: shop\nenvironments: { dev: {}, local: { runs-on: duckdb } }\nimports: ['*.yaml']\n",
      "standard.yaml":
        "apiVersion: ingestron.io/v1\nkind: Standard\nid: acme\npacks: [duckdb@1, copier@1]\ningest: { settings: { duckdb-landed: { landing: ./samples } } }\n",
      "flow.yaml":
        "apiVersion: ingestron.io/v1\nkind: Flow\nid: shop\nsource: shop\ningest: { uses: copy }\ntables:\n  orders: { object: orders, contract: orders }\n",
      "orders.yaml": contract().replace(
        "{ name: name, logicalType: string }",
        '{ name: name, logicalType: string, physicalName: "CustomerName" }',
      ),
    });
    const sqlOf = (environment: string) =>
      generate(files, [duckdb, renaming], environment).files["run.sql"] ?? "";
    const cloud = sqlOf("dev").replace("abfss://landing@acct/orders/*.parquet", "<landed>");
    const local = sqlOf("local").replace("./samples/orders/*.parquet", "<landed>");
    expect(local.replace("(local)", "(dev)")).toBe(cloud);
    expect(local).toContain('CAST("name" AS VARCHAR) AS "name"');
  });
});
