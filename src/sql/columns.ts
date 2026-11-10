// A table's columns: the contract's, then those its landed files carry beyond it.
import type { Column, ResolvedTable } from "@ingestron/definitions";

/**
 * The table's columns: the contract's, then those its landed files carry beyond it (such as
 * ADF's audit columns). A transform's table has only the contract's.
 */
export function columnsOf(table: ResolvedTable): Column[] {
  const extra = table.transform
    ? []
    : ((table.ingest?.output as { columns?: Column[] } | undefined)?.columns ?? []);
  return [...table.contract.columns, ...extra];
}
