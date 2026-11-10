// The CRM fixture's data (test/fixtures/quality): customers as Parquet and orders as CSV, as the
// CRM writes them, with London wall-clock times around both clock changes of 2026.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { folder, generate, qualityProject, writeQuery } from "./project.js";

const columns =
  "id, email, name, country, status, segment, phone, code, age, score, tags, vip, signed_up, contacted_at, last_seen, updated_at";

/** A customer as the CRM writes it: London wall-clock times, untrimmed text. */
export const customer = (values: string) => `(${values})`;

/** The customers' rows, typed as the contract types them. */
export const customers = (rows: string[]) =>
  `SELECT id::BIGINT AS id, email, name, country, status, segment, phone, code, age::BIGINT AS age, score::BIGINT AS score, tags::VARCHAR[] AS tags, vip::BOOLEAN AS vip, signed_up::TIMESTAMP AS signed_up, contacted_at::TIMESTAMP AS contacted_at, last_seen::TIMESTAMP AS last_seen, updated_at::TIMESTAMP AS updated_at FROM (VALUES ${rows.join(", ")}) AS t(${columns})`;

const first = [
  // Two rows for id 1: the later one, after London's clock went forward, wins.
  customer(
    "1, ' Ann@Example.com ', ' Ann ', 'United Kingdom', NULL, 'retail', '0123', 'ABC', 30, -1, ['a'], NULL, '2026-03-29 02:30:00', '2026-03-29 01:30:00', '2026-03-29 02:30:00', '2026-03-29 00:30:00'",
  ),
  // An email of spaces is empty once trimmed, so null: email_not_null drops the row.
  customer(
    "2, '   ', 'Bea', 'UK', 'active', 'retail', '1', 'ABC', 40, 10, ['b'], FALSE, '2026-01-10 09:00:00', NULL, NULL, '2026-01-10 09:00:00'",
  ),
  // XX is not a valid country (warn); the hour London's clock repeats.
  customer(
    "3, 'cy@example.com', 'Cy', 'XX', 'active', 'retail', '2', 'ABC', 50, 15, ['c'], FALSE, '2026-10-25 01:30:00', '2026-10-25 01:30:00', NULL, '2026-10-25 02:30:00'",
  ),
  // n/a is a missing status (warn); the hour London's clock skips.
  customer(
    "4, 'di@example.com', 'Di', '-', 'n/a', 'retail', '3', 'ABC', 20, 20, ['d'], TRUE, '2026-03-29 01:30:00', NULL, NULL, '2026-03-29 01:30:00'",
  ),
  // Before each clock change.
  customer(
    "5, 'ed@example.com', 'Ed', 'ie', 'active', 'retail', '4', 'ABC', 25, 25, ['e'], FALSE, '2026-03-29 00:30:00', '2026-10-25 00:30:00', NULL, '2026-10-25 00:30:00'",
  ),
];
const older = customer(
  "1, 'old@example.com', 'Old', 'GB', 'active', 'retail', '0', 'ABC', 30, 5, ['a'], TRUE, '2026-03-28 12:00:00', NULL, NULL, '2026-03-28 12:00:00'",
);

const orders = [
  "id,customer_id,status,total,updated_at",
  "1,10, shipped ,12.50,2026-03-29 00:30:00",
  "1,10,delivered,12.50,2026-03-30 09:00:00",
  "2,0,open,5.00,2026-03-29 10:00:00",
  "4,11,open,1.00,",
  "",
].join("\n");

/** The fixture, with its files written to a fresh folder. */
export async function crm() {
  const where = folder();
  const input = join(where.root, "in", "crm");
  mkdirSync(join(input, "customers"), { recursive: true });
  mkdirSync(join(input, "orders"), { recursive: true });
  await writeQuery(join(input, "customers", "a.parquet"), customers(first));
  await writeQuery(join(input, "customers", "b.parquet"), customers([older]));
  writeFileSync(join(input, "orders", "a.csv"), orders);
  const files = qualityProject(where);
  const { result, files: built } = generate(files);
  return { where, input, files, result, sql: built["run.sql"] ?? "" };
}
