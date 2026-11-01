// What the platform team provides when tables are read and published in Azure:
// the job that runs run.sql, and its access to the storage.
import { describe, expect, it } from "vitest";
import { duckdb } from "../src/index.js";
import { folder, generate, project } from "./project.js";

const cloud = {
  input: "abfss://landing@acct.dfs.core.windows.net/erp",
  published: "abfss://published@acct.dfs.core.windows.net/tables",
};

describe("request", () => {
  it("asks for the job when tables are read and published in Azure", () => {
    const { result } = generate(project(cloud));
    expect(duckdb.request!(result.model!)).toEqual([
      {
        title: "DuckDB job",
        lines: [
          "A Container Apps job running `ghcr.io/ingestron/duckdb-runner:1`, a public image, with `INGESTRON_SQL` set to where your deploy step copies `run.sql` for dev; see the docs' template.",
          "The job's managed identity needs Storage Blob Data Reader on `abfss://landing@acct.dfs.core.windows.net` and the deployed `run.sql`, and Storage Blob Data Contributor on `abfss://published@acct.dfs.core.windows.net`.",
          "Something that starts the job after each load, such as ADF's after_copy.",
        ],
      },
    ]);
  });

  it("asks for nothing for a local project", () => {
    const { result } = generate(project(folder()));
    expect(duckdb.request!(result.model!)).toEqual([]);
  });

  it("says a job cannot run an environment that also uses local paths", () => {
    const { result } = generate(project({ input: cloud.input, published: "./published" }));
    expect(duckdb.request!(result.model!)[0]?.lines).toEqual([
      "In dev, run.sql also reads or writes local paths, such as `./published/bronze.orders.parquet`, which a job in Azure cannot see: give this environment only paths in Azure storage.",
    ]);
  });
});
