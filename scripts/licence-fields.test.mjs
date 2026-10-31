// The repository and every package in it are Apache-2.0.
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = join(import.meta.dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");

/** The root package.json and, in a workspace, one per folder its `dir/*` globs match. */
function manifests() {
  const workspace = existsSync(join(root, "pnpm-workspace.yaml"))
    ? read("pnpm-workspace.yaml")
    : "";
  const globs = [...workspace.matchAll(/^\s+-\s+(\S+)\/\*\s*$/gm)];
  const folders = globs.flatMap(([, dir]) =>
    readdirSync(join(root, dir), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(dir, entry.name)),
  );
  return ["package.json", ...folders.map((folder) => join(folder, "package.json"))];
}

test("every package declares Apache-2.0", () => {
  for (const path of manifests()) assert.equal(JSON.parse(read(path)).license, "Apache-2.0", path);
});

test("LICENSE is the Apache License 2.0", () => {
  const text = read("LICENSE");
  assert.match(text, /Apache License/);
  assert.match(text, /Version 2\.0, January 2004/);
});

test("NOTICE names the copyright holder", () => {
  assert.match(read("NOTICE"), /Copyright 2026 Otrera Limited, trading as IntentLabs/);
});

test("the npm package ships the NOTICE", () => {
  assert.ok(JSON.parse(read("package.json")).files.includes("NOTICE"));
});
