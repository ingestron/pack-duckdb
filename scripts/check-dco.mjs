import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const trailer = /^signed-off-by:\s*(.+?)\s*<([^>]+)>\s*$/gim;

function signedByAuthor(commit) {
  return [...commit.message.matchAll(trailer)].some(
    ([, name, email]) =>
      name === commit.author && email.toLowerCase() === commit.email.toLowerCase(),
  );
}

/** Short SHAs of non-merge commits without a sign-off by their own author (DCO 1.1). */
export function unsignedCommits(commits) {
  return commits
    .filter((commit) => commit.parents < 2 && !signedByAuthor(commit))
    .map((commit) => commit.sha);
}

function commitsSince(base) {
  const log = execFileSync(
    "git",
    ["log", "--format=%h%x1f%an%x1f%ae%x1f%P%x1f%B%x1e", `${base}..HEAD`],
    { encoding: "utf8" },
  );
  return log
    .split("\x1e")
    .map((record) => record.replace(/^\n/, ""))
    .filter(Boolean)
    .map((record) => {
      const [sha, author, email, parents, message] = record.split("\x1f");
      return { sha, author, email, parents: parents.split(" ").filter(Boolean).length, message };
    });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.argv[2] ?? "origin/main";
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `${base}^{commit}`], {
      stdio: "ignore",
    });
  } catch {
    process.stderr.write(`FAIL: unknown base ref ${base}\n`);
    process.exit(1);
  }
  const commits = commitsSince(base);
  const unsigned = unsignedCommits(commits);
  if (unsigned.length) {
    const subjects = new Map(commits.map((commit) => [commit.sha, commit.message.split("\n")[0]]));
    console.error(unsigned.map((sha) => `FAIL: ${sha} ${subjects.get(sha)}`).join("\n"));
    console.error("Sign off each commit with `git commit -s` (see CONTRIBUTING.md).");
    process.exit(1);
  }
  console.log(`Every commit since ${base} is signed off by its author.`);
}
