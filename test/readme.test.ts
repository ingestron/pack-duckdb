// The package README and the generated README say what users would trip on.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { duckdb } from "../src/index.js";
import { folder, generate, project, qualityProject } from "./project.js";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8").replace(/\s+/g, " ");

describe("the pack's version", () => {
  it("is 2, whose README names ingestron 2.0's folder, as the package README says", () => {
    expect(duckdb.version).toBe(2);
    expect(readme).toContain("The pack is `duckdb@2`, like every pack ingestron 2.0 uses.");
  });
});

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

const text = (where: { input: string; published: string }) =>
  generate(project(where)).files["README.md"] ?? "";
const azureInput = "abfss://landing@acct.dfs.core.windows.net/erp";
const azurePublished = "abfss://published@acct.dfs.core.windows.net";

describe("the generated README for an environment in Azure", () => {
  const azure = () => text({ input: azureInput, published: azurePublished });

  it("leads with how the job runs it, and gives no laptop command", () => {
    const readme = azure();
    expect(readme.split("\n\n")[1]).toContain("A Container Apps job runs `run.sql`");
    expect(readme).not.toContain("duckdb -bail");
  });

  it("says run.sql has no Azure sign-in of its own", () => {
    expect(azure().replace(/\s+/g, " ")).toContain(
      "`run.sql` has no Azure sign-in of its own, so on a laptop it cannot read these paths",
    );
  });

  it("describes the job's run without the laptop's -bail, database or folder", () => {
    const readme = azure().replace(/\s+/g, " ");
    expect(readme).toContain(
      "The job builds every table in one transaction, publishes each to its path, and stops without publishing if a table fails to build.",
    );
    expect(readme).not.toContain("-bail");
    expect(readme).not.toContain("ingestron.duckdb");
    expect(readme).not.toContain("must exist");
  });
});

describe("the generated README when only some paths are in Azure", () => {
  const mixed = {
    "input local": () => text({ input: folder().input, published: azurePublished }),
    "published local": () => text({ input: azureInput, published: folder().published }),
  };

  it.each(Object.entries(mixed))(
    "says local paths cannot run in Azure, keeps the laptop command and omits the job (%s)",
    (_name, readme) => {
      const result = readme();
      expect(result).toContain("local paths cannot run in Azure");
      expect(result).toContain('duckdb -bail ingestron.duckdb -c ".read build/duckdb/dev/run.sql"');
      expect(result).not.toContain("Container Apps job runs");
    },
  );
});

describe("the laptop run text in the generated README", () => {
  const flat = (where: { input: string; published: string }) => text(where).replace(/\s+/g, " ");

  it("does not mention the Azure job's runner when the paths are local or mixed", () => {
    for (const readme of [
      flat(folder()),
      flat({ input: azureInput, published: folder().published }),
      flat({ input: folder().input, published: azurePublished }),
    ]) {
      expect(readme).toContain("With `-bail`, a run that fails while building publishes nothing");
      expect(readme).not.toContain("runner");
    }
  });

  it("says each table goes to its path when published is in Azure, with no folder to create", () => {
    const readme = flat({ input: folder().input, published: azurePublished });
    expect(readme).toContain("then publishes each to its path");
    expect(readme).not.toContain("`published` folder");
    expect(readme).not.toContain("must exist");
  });

  it("says each table goes to the published folder, which must exist, when published is local", () => {
    for (const where of [folder(), { input: azureInput, published: folder().published }]) {
      const readme = flat(where);
      expect(readme).toContain("publishes each one to the `published` folder");
      expect(readme).toContain("the folder must exist");
    }
  });
});

describe("the generated README when every path is local", () => {
  it("has the laptop command and no job paragraph", () => {
    const readme = text(folder());
    expect(readme).toContain('duckdb -bail ingestron.duckdb -c ".read build/duckdb/dev/run.sql"');
    expect(readme).not.toContain("Container Apps");
    expect(readme).not.toContain("sign-in");
  });
});

describe("the generated README's checks", () => {
  /** The CRM fixture's README, its files read from `storage` and published to `published`. */
  const crm = (storage: string, published: string) => {
    const files = qualityProject(folder());
    files["project.yaml"] = files["project.yaml"]!.replace(
      /storage: .*/,
      `storage: "${storage}"`,
    ).replace(/published: .*/, `published: "${published}"`);
    return (generate(files).files["README.md"] ?? "").replace(/\s+/g, " ");
  };

  it("says the job's log shows the counts and a fail check's message, and the tables last one run", () => {
    const readme = crm(azureInput, azurePublished);
    expect(readme).toContain("The job's log shows each check with the rows that fail it");
    expect(readme).toContain("the job's log shows the check's message");
    expect(readme).toContain(
      "The job starts each run with an empty database, so the results and quarantine tables last only for that run.",
    );
    expect(readme).not.toContain("prints each check");
  });

  it("says a laptop run prints each check, and keeps results and quarantine in the database", () => {
    const where = folder();
    const readme = crm(where.input, where.published);
    expect(readme).toContain("prints each check with the rows that fail it");
    expect(readme).toContain("A run that stops keeps no results.");
    expect(readme).not.toContain("job");
  });
});
