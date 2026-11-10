// The README that says how to run the environment's SQL: the laptop command, or the Container
// Apps job in Azure, and what its checks print and keep.
import type { ResolvedModel, ResolvedTable } from "@ingestron/definitions";
import { remote } from "../methods/index.js";
import { keepsResults, quarantineOf, rowChecksOf, tableChecksOf } from "../sql/index.js";

/** Whether the paths are all in Azure, all local, or both; a table with no path counts for neither. */
function placeOf(tables: ResolvedTable[]): "azure" | "local" | "mixed" {
  const locations = tables.flatMap((table) => [
    table.ingest?.output?.location,
    table.store?.output?.location,
  ]);
  const paths = locations.filter((location): location is string => location !== undefined);
  if (!paths.some(remote)) return "local";
  return paths.every(remote) ? "azure" : "mixed";
}

/** Whether the tables are published to Azure storage, where there is no folder to create. */
function publishesToAzure(tables: ResolvedTable[]): boolean {
  return tables.some((table) => remote(table.store?.output?.location));
}

const job = `A Container Apps job runs \`run.sql\` with the public image
\`ghcr.io/ingestron/duckdb-runner:1\`: copy this folder to storage and set the
job's \`INGESTRON_SQL\` to the copied \`run.sql\`. \`ingestron request\` lists
what the job needs. \`run.sql\` has no Azure sign-in of its own, so on a laptop
it cannot read these paths; the job signs in as its managed identity.`;

const mixed = `This environment reads or writes both local paths and paths in Azure storage,
and local paths cannot run in Azure: a job there cannot see them. Give it only
paths in Azure storage, or only local paths. \`run.sql\` has no Azure sign-in of
its own.`;

const azureRun = `The job builds every table in one transaction, publishes each to its path, and
stops without publishing if a table fails to build. Running it again is safe.
\`tables/\` holds each table's SQL alone.`;

const laptopRun = (
  tableCommand: string,
  remotePublished: boolean,
) => `It builds every table in \`ingestron.duckdb\` in one transaction, then
${
  remotePublished
    ? "publishes each to its path."
    : "publishes each one to the `published` folder as `<schema>.<table>.parquet`;\nthe folder must exist."
} With \`-bail\`, a run that
fails while building publishes nothing; without it, DuckDB carries on after an
error and commits what it built. Running it again is safe. \`tables/\` holds
each table's SQL alone, to run one table again:\n\n${tableCommand}`;

/** README.md for the environment's tables. */
export function readme(model: ResolvedModel, tables: ResolvedTable[]): string {
  const { id, environment } = model.project;
  // Where ingestron 2.0 writes this environment's files: build/<pack>/<environment>/.
  const folder = `build/duckdb/${environment}`;
  const place = placeOf(tables);
  const command = (file: string) =>
    `\`\`\`sh\nduckdb -bail ingestron.duckdb -c ".read ${folder}/${file}"\n\`\`\``;
  const sections = [
    `# DuckDB SQL for ${id} (${environment})`,
    { azure: job, mixed, local: "" }[place],
    place === "azure"
      ? ""
      : `Run \`run.sql\` from the project folder, where its paths start, with the DuckDB
command line; \`-bail\` stops at the first error:\n\n${command("run.sql")}`,
    place === "azure"
      ? azureRun
      : laptopRun(command("tables/<schema>.<table>.sql"), publishesToAzure(tables)),
    ...qualitySections(tables, place === "azure"),
  ];
  return `${sections.filter(Boolean).join("\n\n")}\n`;
}

const checksRun = `\`run.sql\` checks the rows of the tables in layers whose \`does\` lists
\`check\`, and prints each check with the rows that fail it: a \`warn\` check
keeps those rows, a \`drop\` check leaves them out. When a \`fail\` check
fails, the run stops and nothing is published.`;

const jobChecks = `\`run.sql\` checks the rows of the tables in layers whose \`does\` lists
\`check\`. The job's log shows each check with the rows that fail it: a \`warn\`
check keeps those rows, a \`drop\` check leaves them out. When a \`fail\` check
fails, the run stops, nothing is published, and the job's log shows the
check's message.`;

const resultsKept = `Each check's result is also kept in the \`_ingestron_checks\` table of the
table's schema, with the run's id and time. A run that stops keeps no results.`;

const quarantined = `The rows a \`drop\` check leaves out are kept in \`<schema>.<table>_quarantine\`,
with \`_failed_checks\` naming the checks they failed. Quarantine tables are
not published.`;

const jobDatabase = `The job starts each run with an empty database, so the results and
quarantine tables last only for that run.`;

const zones = `Time zones are converted with DuckDB's ICU extension, which DuckDB's command
line and client libraries include.`;

/** What the tables' checks print and keep, and how zones are converted; none without them. */
function qualitySections(tables: ResolvedTable[], inJob: boolean): string[] {
  const checks = tables.some(
    (table) => rowChecksOf(table).length > 0 || tableChecksOf(table).length > 0,
  );
  const quarantine = tables.some((table) => quarantineOf(table) !== undefined);
  const converts = tables.some((table) =>
    Object.values(table.cleanse?.columns ?? {}).some((column) => column.timezone),
  );
  const results = tables.some(keepsResults);
  return [
    checks ? (inJob ? jobChecks : checksRun) : "",
    results ? resultsKept : "",
    quarantine ? quarantined : "",
    inJob && (results || quarantine) ? jobDatabase : "",
    converts ? zones : "",
  ];
}
