import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { unsignedCommits } from "./check-dco.mjs";

const author = { author: "The Architect", email: "contact@intentlabs.dev", parents: 1 };
const commit = (sha, message, extra = {}) => ({ sha, message, ...author, ...extra });

test("accepts a sign-off that matches the author", () => {
  const message = "feat: x\n\nSigned-off-by: The Architect <contact@intentlabs.dev>\n";
  assert.deepEqual(unsignedCommits([commit("a1", message)]), []);
});

test("ignores the case of the trailer and trailing spaces", () => {
  const message = "feat: x\n\nsigned-off-by: The Architect <contact@intentlabs.dev>   \n";
  assert.deepEqual(unsignedCommits([commit("a2", message)]), []);
});

test("rejects a sign-off by someone other than the author", () => {
  const message = "feat: x\n\nSigned-off-by: The Architect <other@example.com>\n";
  assert.deepEqual(unsignedCommits([commit("a3", message)]), ["a3"]);
});

test("does not count Co-authored-by as a sign-off", () => {
  const message = "feat: x\n\nCo-authored-by: The Architect <contact@intentlabs.dev>\n";
  assert.deepEqual(unsignedCommits([commit("a4", message)]), ["a4"]);
});

test("skips merge commits", () => {
  assert.deepEqual(unsignedCommits([commit("a5", "Merge branch 'x'", { parents: 2 })]), []);
});

test("reports an unknown base ref in one line", () => {
  const script = new URL("./check-dco.mjs", import.meta.url).pathname;
  const result = spawnSync("node", [script, "no-such-ref-xyz"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "FAIL: unknown base ref no-such-ref-xyz\n");
});
