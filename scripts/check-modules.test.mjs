import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { moduleProblems } from "./check-modules.mjs";

function source(files) {
  const root = mkdtempSync(join(tmpdir(), "modules-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

test("a flat source folder has no problems", () => {
  const root = source({ "index.ts": 'export * from "./a.js";\n', "a.ts": "export const a = 1;\n" });
  assert.deepEqual(moduleProblems(root), []);
});

test("modules that meet through their index files have no problems", () => {
  const root = source({
    "index.ts": 'export * from "./plan/index.js";\n',
    "folders.ts": "export const here = 1;\n",
    "plan/index.ts": 'export { plan } from "./plan.js";\n',
    "plan/plan.ts":
      'import { write } from "../apply/index.js";\nimport { here } from "../folders.js";\nexport const plan = write + here;\n',
    "apply/index.ts": 'export { write } from "./write.js";\n',
    "apply/write.ts": "export const write = 1;\n",
  });
  assert.deepEqual(moduleProblems(root), []);
});

test("reports a folder more than one level deep", () => {
  const root = source({ "plan/diff/lines.ts": "export const x = 1;\n" });
  assert.deepEqual(moduleProblems(root), [
    "plan/diff/lines.ts: more than one folder deep under src",
  ]);
});

test("reports an import of another module's file instead of its index", () => {
  const root = source({
    "plan/plan.ts": 'import { write } from "../apply/write.js";\n',
    "apply/index.ts": "",
    "apply/write.ts": "export const write = 1;\n",
  });
  assert.deepEqual(moduleProblems(root), [
    'plan/plan.ts: imports "../apply/write.js"; use the apply module\'s index.js',
  ]);
});

test("reports a cycle between modules", () => {
  const root = source({
    "a/index.ts": 'export { b } from "../b/index.js";\n',
    "b/index.ts": 'export { a } from "../a/index.js";\n',
  });
  assert.deepEqual(moduleProblems(root), ["modules import each other in a cycle: a → b → a"]);
});

test("reports a module named for nothing in particular", () => {
  const root = source({ "utils/index.ts": "export const x = 1;\n" });
  assert.deepEqual(moduleProblems(root), ['utils: name the module for what it does, not "utils"']);
});

test("reports a module named like a folder Git ignores", () => {
  const root = source({ "build/index.ts": "export const x = 1;\n" });
  assert.deepEqual(moduleProblems(root), [
    'build: Git ignores folders named "build"; name the module otherwise',
  ]);
});
