import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Permissive, or file-level copyleft (MPL-2.0) that is fine to depend on unmodified.
const allowed = new Set([
  "MIT",
  "MIT-0",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "BSL-1.0",
  "CC0-1.0",
  "CC-BY-4.0",
  "Unlicense",
  "Python-2.0",
  "BlueOak-1.0.0",
  "MPL-2.0",
]);

function idVerdict(id) {
  if (/GPL/i.test(id) || /^SSPL/i.test(id) || /^BUSL/i.test(id)) return "deny";
  return allowed.has(id) ? "allow" : "unknown";
}

function tokens(expression) {
  return expression.replace(/[()]/g, " $& ").trim().split(/\s+/).filter(Boolean);
}

/** Parses an SPDX expression into nested verdicts; throws on anything else. */
function parse(list) {
  let at = 0;
  const atom = () => {
    const token = list[at++];
    if (token === "(") {
      const inner = either();
      if (list[at++] !== ")") throw new Error("unbalanced");
      return inner;
    }
    if (!token || ["AND", "OR", "WITH", ")"].includes(token)) throw new Error("bad token");
    if (list[at] === "WITH") at += 2;
    return idVerdict(token);
  };
  const both = () => {
    const parts = [atom()];
    while (list[at] === "AND") {
      at++;
      parts.push(atom());
    }
    if (parts.includes("deny")) return "deny";
    return parts.includes("unknown") ? "unknown" : "allow";
  };
  const either = () => {
    const parts = [both()];
    while (list[at] === "OR") {
      at++;
      parts.push(both());
    }
    if (parts.includes("allow")) return "allow";
    return parts.every((part) => part === "deny") ? "deny" : "unknown";
  };
  const verdict = either();
  if (at !== list.length) throw new Error("trailing tokens");
  return verdict;
}

export function licenceVerdict(expression) {
  try {
    return parse(tokens(expression ?? ""));
  } catch {
    return "unknown";
  }
}

function names(exception, pkg) {
  return exception.name.endsWith("*")
    ? pkg.name.startsWith(exception.name.slice(0, -1))
    : pkg.name === exception.name;
}

function covers(exception, pkg) {
  return names(exception, pkg) && pkg.license === exception.licence;
}

export function findViolations(packages, exceptions) {
  const disallowed = packages
    .filter((pkg) => licenceVerdict(pkg.license) !== "allow")
    .filter((pkg) => !exceptions.some((exception) => covers(exception, pkg)))
    .map((pkg) => `${pkg.name}@${pkg.version}: ${pkg.license}`);
  const unused = exceptions
    .filter((exception) => !packages.some((pkg) => names(exception, pkg)))
    .map((exception) => `${exception.name}: matches no installed package`);
  return [...disallowed, ...unused];
}

/**
 * The third-party packages in a `pnpm licenses list --json` report, one entry
 * per installed version. pnpm prints a sentence instead of JSON when there are
 * no production dependencies.
 */
export function packagesFromReport(text) {
  if (!text.trim().startsWith("{")) return [];
  return Object.values(JSON.parse(text))
    .flat()
    .filter((pkg) => !pkg.name.startsWith("@ingestron/") && pkg.name !== "ingestron-vscode")
    .flatMap((pkg) => pkg.versions.map((version) => ({ ...pkg, version })));
}

function installedPackages() {
  return packagesFromReport(
    execFileSync("pnpm", ["licenses", "list", "--json", "--prod"], { encoding: "utf8" }),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const exceptions = JSON.parse(
    readFileSync(new URL("./licence-exceptions.json", import.meta.url), "utf8"),
  );
  const failures = findViolations(installedPackages(), exceptions);
  if (failures.length) {
    console.error(failures.map((failure) => `FAIL: ${failure}`).join("\n"));
    process.exit(1);
  }
  console.log("Every production dependency has an allowed licence.");
}
