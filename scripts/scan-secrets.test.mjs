import assert from "node:assert/strict";
import test from "node:test";

import { detectSecrets } from "./scan-secrets.mjs";

test("allows documented secret placeholders", () => {
  assert.deepEqual(detectSecrets("token: <your-databricks-token>"), []);
  assert.deepEqual(detectSecrets("AccountKey=<storage-account-key>"), []);
});

test("detects representative committed credentials", () => {
  assert.deepEqual(detectSecrets(["token=ghp_", "abcdefghijklmnopqrstuvwxyz123456"].join("")), [
    "GitHub token",
  ]);
  assert.deepEqual(detectSecrets(["-----BEGIN ", "PRIVATE KEY-----"].join("")), ["private key"]);
  assert.deepEqual(detectSecrets(["github_pat_", "A".repeat(82)].join("")), [
    "GitHub fine-grained token",
  ]);
  assert.deepEqual(detectSecrets(["sk-", "a".repeat(32)].join("")), ["secret key (sk-…)"]);
});

test("detects the platform credentials Ingestron projects use", () => {
  assert.deepEqual(detectSecrets(["token: dapi", "0123456789abcdef".repeat(2)].join("")), [
    "Databricks token",
  ]);
  assert.deepEqual(detectSecrets(["AccountKey=", "A".repeat(86), "=="].join("")), [
    "Azure storage account key",
  ]);
});
