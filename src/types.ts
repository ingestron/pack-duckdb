// DuckDB types for each contract logicalType.

/** The column type, by the contract's logicalType. */
export const duckdbTypes: Record<string, string> = {
  string: "VARCHAR",
  integer: "BIGINT",
  number: "DOUBLE",
  boolean: "BOOLEAN",
  date: "DATE",
  timestamp: "TIMESTAMP",
  time: "TIME",
};
