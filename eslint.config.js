// Lint rules carry the size and documentation limits from CONTRIBUTING.md.
import jsdoc from "eslint-plugin-jsdoc";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", ".tmp/**"] },
  ...tseslint.configs.recommended,
  {
    // Packages meet only at their entry points: no deep imports into another
    // package, and no relative path out of this one.
    files: ["**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^@ingestron/[^/]+/(?!core$).+",
              message: "Import another package by its entry point, not its files.",
            },
            {
              regex: "^(\\.\\./){2,}",
              message: "Stay inside this package; use another package by its name.",
            },
          ],
        },
      ],
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
