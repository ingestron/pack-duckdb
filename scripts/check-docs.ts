// Type-checks every ```ts block in README.md, so documented code
// stays correct as the API changes. Each block must be a complete file.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const packageFolder = join(import.meta.dirname, "..");
const outputFolder = join(packageFolder, ".tmp/doc-snippets");
rmSync(outputFolder, { recursive: true, force: true });
mkdirSync(outputFolder, { recursive: true });

const documents = [join(packageFolder, "README.md")];
let count = 0;
for (const document of documents) {
  const blocks = [...readFileSync(document, "utf8").matchAll(/```ts\n([\s\S]*?)```/g)];
  blocks.forEach((block, index) => {
    const name = `${relative(packageFolder, document).replaceAll("/", "_")}_${index + 1}.ts`;
    // `export {}` makes each block its own module, so names cannot clash.
    writeFileSync(join(outputFolder, name), `${block[1]}\nexport {};\n`);
    count += 1;
  });
}

writeFileSync(
  join(outputFolder, "tsconfig.json"),
  JSON.stringify({ extends: "../../tsconfig.json", include: ["*.ts"] }),
);
try {
  execFileSync("npx", ["tsc", "-p", join(outputFolder, "tsconfig.json"), "--noEmit"], {
    stdio: "inherit",
  });
  console.log(`✓ ${count} TypeScript blocks in ${documents.length} documents type-check`);
} catch {
  console.log(
    `✗ documentation code blocks failed to type-check (files in ${relative(packageFolder, outputFolder)})`,
  );
  process.exit(1);
}
