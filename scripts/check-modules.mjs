// Checks the module rules in CONTRIBUTING.md: module folders are one level
// deep under src, a module reaches another only through its index.ts, modules
// do not import each other in a cycle, and no module is named utils, helpers,
// common or misc, or build, dist or node_modules, which Git ignores.
//
//   node scripts/check-modules.mjs [<src folder>…]
//
// Default: every packages/*/src folder.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const vagueNames = ["utils", "helpers", "common", "misc"];
const ignoredNames = ["build", "dist", "node_modules"];
const specifier = /(?:\bfrom|\bimport)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g;

function sourceFiles(folder) {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith(".ts") ? [path] : [];
  });
}

/** The module a path under `root` belongs to: its first folder, or undefined at the top level. */
function moduleOf(root, path) {
  const parts = relative(root, path).split(sep);
  return parts.length > 1 ? parts[0] : undefined;
}

/** Each relative import of `file`, with the module it reaches and the file it names. */
function importsOf(root, file) {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(specifier)].map(([, spec]) => {
    const target = resolve(dirname(file), spec);
    return { spec, module: moduleOf(root, target), name: target.split(sep).pop() };
  });
}

/** Module cycles, each as "a → b → a", found by depth-first search over module imports. */
function cycles(edges) {
  const found = [];
  const state = new Map();
  const visit = (node, path) => {
    state.set(node, "open");
    for (const next of [...(edges.get(node) ?? [])].sort()) {
      if (state.get(next) === "open")
        found.push([...path.slice(path.indexOf(next)), next].join(" → "));
      else if (!state.has(next)) visit(next, [...path, next]);
    }
    state.set(node, "done");
  };
  for (const node of [...edges.keys()].sort()) if (!state.has(node)) visit(node, [node]);
  return found;
}

/** Every problem with the modules under the source folder `root`. */
export function moduleProblems(root) {
  const problems = [];
  const edges = new Map();
  const modules = readdirSync(root).filter((name) => statSync(join(root, name)).isDirectory());
  for (const name of modules.filter((name) => vagueNames.includes(name)))
    problems.push(`${name}: name the module for what it does, not "${name}"`);
  for (const name of modules.filter((name) => ignoredNames.includes(name)))
    problems.push(`${name}: Git ignores folders named "${name}"; name the module otherwise`);
  for (const file of sourceFiles(root)) {
    const shown = relative(root, file).split(sep).join("/");
    if (shown.split("/").length > 2) problems.push(`${shown}: more than one folder deep under src`);
    const own = moduleOf(root, file);
    for (const { spec, module, name } of importsOf(root, file)) {
      if (!module || module === own) continue;
      if (name !== "index.js")
        problems.push(`${shown}: imports "${spec}"; use the ${module} module's index.js`);
      if (own) edges.set(own, new Set([...(edges.get(own) ?? []), module]));
    }
  }
  return [
    ...problems,
    ...cycles(edges).map((cycle) => `modules import each other in a cycle: ${cycle}`),
  ];
}

function defaultFolders() {
  const packages = join(import.meta.dirname, "../packages");
  if (!existsSync(packages)) return [join(import.meta.dirname, "../src")];
  return readdirSync(packages)
    .map((name) => join(packages, name, "src"))
    .filter((folder) => existsSync(folder));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const folders =
    process.argv.length > 2
      ? process.argv.slice(2).map((folder) => resolve(folder))
      : defaultFolders();
  const problems = folders.flatMap((folder) =>
    moduleProblems(folder).map((problem) => `${relative(process.cwd(), folder)}/${problem}`),
  );
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exitCode = 1;
  else console.log(`Modules fine: ${folders.length} source folders.`);
}
