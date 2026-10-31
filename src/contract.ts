// What the DuckDB pack does with each ODCS contract field: tables take their
// columns, types and keys from the contract and check no rows yet; the other
// facts describe the data and are kept as documentation.
import { contractCommon, type ContractUse } from "@ingestron/definitions";

const used = (does: string): ContractUse => ({ use: "used", does });
const notYet = (reason: string): ContractUse => ({ use: "not-yet", reason });
const documentation: ContractUse = { use: "documentation" };
const object = "schema.*";
const column = "schema.*.properties.*";

/** The DuckDB pack's use of every contract field, by path. */
export const contract: Record<string, ContractUse> = {
  ...contractCommon,
  schema: used("One object per table; each table uses the object named like it."),
  [`${object}.name`]: used("Matched to the table by its name."),
  [`${object}.logicalType`]: documentation,
  [`${object}.physicalName`]: {
    use: "elsewhere",
    reason: "The table is named by the standard's naming.",
  },
  [`${object}.physicalType`]: documentation,
  [`${object}.description`]: documentation,
  [`${object}.properties`]: used("Each property is a column of the table."),
  [`${object}.relationships`]: notYet("DuckDB tables declare no relationships yet."),
  [`${object}.quality`]: notYet("DuckDB tables check no rows yet."),
  [`${object}.tags`]: notYet("DuckDB tables carry no tags yet."),
  [`${column}.name`]: used("The column's name in the table."),
  [`${column}.physicalName`]: used(
    "Read from the files under this name when the ingest did not rename the column.",
  ),
  [`${column}.logicalType`]: used("Types the column in the table."),
  [`${column}.physicalType`]: used("Types the column when DuckDB provides the defaults."),
  [`${column}.primaryKey`]: used("Upsert replaces rows with the same key."),
  [`${column}.primaryKeyPosition`]: used("Orders the key's columns."),
  [`${column}.quality`]: notYet("DuckDB tables check no rows yet."),
  [`${column}.description`]: documentation,
  ...Object.fromEntries(
    [
      "required",
      "logicalTypeOptions",
      "unique",
      "partitioned",
      "partitionKeyPosition",
      "classification",
      "encryptedName",
      "relationships",
      "tags",
      "properties",
      "items",
    ].map((key) => [`${column}.${key}`, documentation]),
  ),
};
