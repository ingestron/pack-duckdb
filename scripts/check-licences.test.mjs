import assert from "node:assert/strict";
import test from "node:test";

import { findViolations, licenceVerdict, packagesFromReport } from "./check-licences.mjs";

test("allows permissive licences, including Boost's BSL-1.0", () => {
  for (const id of ["MIT", "Apache-2.0", "BSD-3-Clause", "ISC", "BSL-1.0", "0BSD", "MPL-2.0"])
    assert.equal(licenceVerdict(id), "allow", id);
});

test("denies GPL-family, SSPL and Business Source licences", () => {
  for (const id of ["GPL-3.0-only", "LGPL-2.1-or-later", "AGPL-3.0", "SSPL-1.0", "BUSL-1.1"])
    assert.equal(licenceVerdict(id), "deny", id);
});

test("reads SPDX expressions", () => {
  assert.equal(licenceVerdict("MIT OR GPL-3.0"), "allow");
  assert.equal(licenceVerdict("MIT AND GPL-3.0"), "deny");
  assert.equal(licenceVerdict("(MIT OR Apache-2.0) AND BSD-2-Clause"), "allow");
  assert.equal(licenceVerdict("GPL-2.0-only WITH Classpath-exception-2.0"), "deny");
});

test("treats missing or non-SPDX licences as unknown", () => {
  for (const id of ["UNLICENSED", "SEE LICENSE IN LICENSE.md", ""])
    assert.equal(licenceVerdict(id), "unknown", JSON.stringify(id));
});

test("reports violations that no exception covers", () => {
  const packages = [
    { name: "a", version: "1.0.0", license: "GPL-3.0" },
    { name: "b", version: "1.0.0", license: "UNLICENSED" },
    { name: "c", version: "1.0.0", license: "MIT" },
  ];
  assert.deepEqual(
    findViolations(packages, [{ name: "b", licence: "UNLICENSED", reason: "checked by hand" }]),
    ["a@1.0.0: GPL-3.0"],
  );
});

test("matches an exception ending in * as a name prefix", () => {
  const packages = [
    { name: "@img/sharp-libvips-linux-x64", version: "1.3.4", license: "LGPL-3.0-or-later" },
  ];
  assert.deepEqual(
    findViolations(packages, [
      { name: "@img/sharp-libvips-*", licence: "LGPL-3.0-or-later", reason: "docs site" },
    ]),
    [],
  );
});

test("an exception covers only the licence it records", () => {
  const packages = [{ name: "x", version: "1.0.0", license: "GPL-3.0" }];
  const exceptions = [{ name: "x", licence: "LGPL-3.0-or-later", reason: "r" }];
  assert.deepEqual(findViolations(packages, exceptions), ["x@1.0.0: GPL-3.0"]);
});

test("reports an exception that matches no installed package", () => {
  assert.deepEqual(findViolations([], [{ name: "y", licence: "MIT", reason: "r" }]), [
    "y: matches no installed package",
  ]);
});

test("reads no packages when there are no production dependencies", () => {
  assert.deepEqual(packagesFromReport("No licenses found\n"), []);
});

test("reads each version of each package, leaving out Ingestron's own", () => {
  const report = JSON.stringify({
    MIT: [{ name: "yaml", versions: ["2.9.1"], license: "MIT" }],
    "Apache-2.0": [{ name: "@ingestron/config", versions: ["1.0.0"], license: "Apache-2.0" }],
  });
  assert.deepEqual(packagesFromReport(report), [
    { name: "yaml", versions: ["2.9.1"], license: "MIT", version: "2.9.1" },
  ]);
});
