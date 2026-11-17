// Behaviour assertions ignore layout while preserving whitespace inside quoted SQL values.
/** SQL layout whitespace collapsed, keeping quoted identifiers and literals byte-for-byte. */
export function compactSql(text: string | undefined): string {
  if (text === undefined) throw new Error("Expected generated SQL output.");
  return text
    .replace(
      /--[^\n]*|'(?:''|\\.|[^'\\])*'|"(?:""|\\.|[^"\\])*"|`(?:``|[^`])*`|\(\s*|\s*\)|\s+/g,
      (part) => {
        if (part.startsWith("--")) return part;
        if (part.startsWith("(")) return "(";
        if (part.endsWith(")") && /^\s*\)/.test(part)) return ")";
        return /^\s/.test(part) ? " " : part;
      },
    )
    .trim();
}
