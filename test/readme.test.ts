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
});
