// Contacts and community files a public repository needs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (file) => readFileSync(join(import.meta.dirname, "..", file), "utf8");

test("SECURITY.md gives the private reporting address", () => {
  assert.match(read("SECURITY.md"), /security@ingestron\.io/);
});

test("CODE_OF_CONDUCT.md is the Contributor Covenant with a contact", () => {
  const text = read("CODE_OF_CONDUCT.md");
  assert.match(text, /Contributor Covenant/);
  assert.match(text, /hello@ingestron\.io/);
});

test("README.md lists the contacts", () => {
  const text = read("README.md");
  assert.match(text, /hello@ingestron\.io/);
  assert.match(text, /security@ingestron\.io/);
});
