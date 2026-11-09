// The audit columns a table's intent asks for that this pack adds (spec/behaviour.md,
// "Intent"). They come after the contract's columns and are not contract columns.
import type { AuditValue, ResolvedTable } from "@ingestron/definitions";
import { fileColumn, quote } from "./sql.js";

/** One audit column: its name, the expression that fills it and its type. */
export interface AuditColumn {
  name: string;
  expression: string;
  type: string;
}

/** What each audit value is, and whether only a table that reads files has it. */
const supported: Partial<
  Record<AuditValue, { expression: string; type: string; filesOnly: boolean }>
> = {
  loaded_at: { expression: "now()", type: "TIMESTAMP WITH TIME ZONE", filesOnly: false },
  // The reader's `filename` option names the file column (`fileColumn`), whichever mode loads.
  source_file: { expression: quote(fileColumn), type: "VARCHAR", filesOnly: true },
};

/**
 * The audit columns the table's intent asks for, in the order given. A transform's table
 * reads no files, so it has no `source_file`. Definitions has checked that each name is a
 * plain one.
 */
export function auditOf(table: ResolvedTable): AuditColumn[] {
  return (table.intent.audit ?? []).flatMap(({ value, as }) => {
    const found = supported[value];
    if (!found || (found.filesOnly && table.transform)) return [];
    return [{ name: as, expression: found.expression, type: found.type }];
  });
}

/** True when a column reads each row's file name, so the reader must provide it. */
export function readsFileName(table: ResolvedTable): boolean {
  return auditOf(table).some((column) => column.expression === quote(fileColumn));
}

/** `<expression> AS <name>` for each audit column, ready to follow the contract's columns. */
export function auditSelect(table: ResolvedTable): string[] {
  return auditOf(table).map((column) => `${column.expression} AS ${quote(column.name)}`);
}
