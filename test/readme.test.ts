// The package README and the generated README say what users would trip on.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { duckdb } from "../src/index.js";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8").replace(/\s+/g, " ");

describe("the package README and settings say what users would trip on", () => {
  it("says a CSV without a header binds its columns in contract order", () => {
    const settings = duckdb.methods["duckdb-files"]?.settings as {
      properties: { csv: { properties: { header: { description: string } } } };
    };
    expect(settings.properties.csv.properties.header.description).toBe(
      "The first row names the columns. Without it, the columns bind in the contract's order.",
    );
    expect(readme).toContain(
      "A CSV without a header (`csv.header: false`) binds its columns in the contract's order",
    );
  });

  it("warns that a transform's casts to the contract's types can change values", () => {
    expect(readme).toContain(
      "A transform's columns are cast to the contract's types, and a cast can change a value",
    );
    expect(readme).toContain(
      "a timestamp with a time zone loses its offset when the contract says `timestamp`, and a `timestamptz` shows the time in the session's time zone",
    );
    expect(readme).toContain("a decimal rounds when the contract says `integer`");
  });

  it("says append reads each file name once, so a re-exported file is skipped", () => {
    expect(readme).toContain(
      "`append` reads each file name once, so a file re-exported under the same name is skipped",
    );
  });
});
