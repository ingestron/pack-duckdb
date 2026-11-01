// What the platform team provides when DuckDB reads and publishes tables in
// Azure storage: the job that runs run.sql, and its access to the storage.
import type { RequestSection, ResolvedModel } from "@ingestron/definitions";

const root = /^(abfss|abfs|az|azure):\/\/[^/]+/;

/**
 * True for a location in Azure storage, which DuckDB's azure extension reads.
 * @example remote("abfss://landing@acct.dfs.core.windows.net/erp") // true
 */
export function remote(location: string | undefined): boolean {
  return root.test(location ?? "");
}

/** The DuckDB job's section of `ingestron request`, or nothing when no table lives in Azure. */
export function request(model: ResolvedModel): RequestSection[] {
  const tables = model.tables.filter((table) => table.store?.method === "duckdb-table");
  const read = (table: (typeof tables)[number]) =>
    table.transform ? undefined : table.ingest?.output?.location;
  const locations = tables.flatMap((table) => [read(table), table.store?.output?.location]);
  if (!locations.some(remote)) return [];
  const environment = model.project.environment;
  const local = locations.find((location) => location !== undefined && !remote(location));
  if (local)
    return [
      {
        title: "DuckDB job",
        lines: [
          `In ${environment}, run.sql also reads or writes local paths, such as \`${local}\`, which a job in Azure cannot see: give this environment abfss:// paths only.`,
        ],
      },
    ];
  const reads = roots(tables.map(read));
  const writes = roots(tables.map((table) => table.store?.output?.location));
  const list = (items: string[]) => items.map((item) => `\`${item}\``).join(", ");
  return [
    {
      title: "DuckDB job",
      lines: [
        `A Container Apps job running \`ghcr.io/ingestron/duckdb-runner:1\`, a public image, with \`INGESTRON_SQL\` set to where your deploy step copies \`run.sql\` for ${environment}; see the docs' template.`,
        `The job's managed identity needs Storage Blob Data Reader on ${[list(reads), "the deployed \`run.sql\`"].filter(Boolean).join(" and ")}, and Storage Blob Data Contributor on ${list(writes)}.`,
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
