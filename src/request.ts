// What the platform team provides when DuckDB reads and publishes tables in
// Azure storage: the job that runs run.sql, and its access to the storage.
import type { RequestSection, ResolvedModel } from "@ingestron/definitions";

const root = /^(abfss|az):\/\/[^/]+/;

/** The DuckDB job's section of `ingestron request`, or nothing when no table lives in Azure. */
export function request(model: ResolvedModel): RequestSection[] {
  const tables = model.tables.filter((table) => table.store?.method === "duckdb-table");
  const reads = roots(tables.map((table) => table.ingest?.output?.location));
  const writes = roots(tables.map((table) => table.store?.output?.location));
  if (reads.length === 0 && writes.length === 0) return [];
  const list = (items: string[]) => items.map((item) => `\`${item}\``).join(", ");
  return [
    {
      title: "DuckDB job",
      lines: [
        `A Container Apps job running \`ghcr.io/ingestron/duckdb-runner:1\`, a public image, with \`INGESTRON_SQL\` set to where your deploy step copies \`run.sql\` for ${model.project.environment}; see the docs' template.`,
        `The job's managed identity reads ${[list(reads), "the deployed `run.sql`"].filter(Boolean).join(" and ")}, and writes ${list(writes)}: Storage Blob Data Reader and Storage Blob Data Contributor on those storage accounts.`,
        "Something that starts the job after each load, such as ADF's after_copy.",
      ],
    },
  ];
}

/** The distinct storage roots, `abfss://<file system>@<account>…`, of the remote locations. */
function roots(locations: (string | undefined)[]): string[] {
  const found = locations.flatMap((location) => root.exec(location ?? "")?.[0] ?? []);
  return [...new Set(found)].sort();
}
