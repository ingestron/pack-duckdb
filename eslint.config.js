// Lint rules carry the size, documentation and module limits from CONTRIBUTING.md.
import { dirname, join, resolve, sep } from "node:path";
import jsdoc from "eslint-plugin-jsdoc";
import tseslint from "typescript-eslint";

/**
 * A relative import must stay inside this package, and source files import
 * only other source files: another package is used by its name.
 */
const insidePackage = {
  meta: {
    type: "problem",
    messages: {
      outside: "Stay inside this package; use another package by its name.",
      fromSource: "Source files import only from src/.",
    },
  },
  create(context) {
    const root = context.cwd;
    const source = join(root, "src") + sep;
    const inSource = context.filename.startsWith(source);
    const check = (node) => {
      const spec = node.source?.value;
      if (typeof spec !== "string" || !spec.startsWith(".")) return;
      const target = resolve(dirname(context.filename), spec);
      if (!target.startsWith(root + sep))
        context.report({ node: node.source, messageId: "outside" });
      else if (inSource && !target.startsWith(source))
        context.report({ node: node.source, messageId: "fromSource" });
    };
    return {
      ImportDeclaration: check,
      ExportAllDeclaration: check,
      ExportNamedDeclaration: check,
      ImportExpression: check,
    };
  },
};

export default tseslint.config(
  { ignores: ["dist/**", ".tmp/**"] },
  ...tseslint.configs.recommended,
  {
    // Packages meet only at their entry points: no deep imports into another
    // package, and no relative path out of this one.
    files: ["**/*.ts"],
    plugins: { ingestron: { rules: { "inside-package": insidePackage } } },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^@ingestron/[^/]+/(?!core$).+",
              message: "Import another package by its entry point, not its files.",
            },
          ],
        },
      ],
      "ingestron/inside-package": "error",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    files: ["**/*.ts"],
    plugins: { jsdoc },
    rules: {
      "max-lines": ["error", { max: 200, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 40, skipBlankLines: true, skipComments: true }],
      "max-depth": ["error", 3],
      complexity: ["error", 10],
      "one-var": ["error", "never"],
    },
  },
  {
    files: ["src/**/*.ts"],
    rules: {
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "jsdoc/require-jsdoc": [
        "error",
        {
          publicOnly: true,
          require: { FunctionDeclaration: true },
          contexts: [
            "TSInterfaceDeclaration",
            "TSTypeAliasDeclaration",
            "ExportNamedDeclaration > VariableDeclaration",
          ],
        },
      ],
    },
  },
  {
    // Test and script files group many small cases in one callback.
    files: ["test/**/*.ts", "scripts/**/*.ts"],
    rules: { "max-lines-per-function": "off" },
  },
);
