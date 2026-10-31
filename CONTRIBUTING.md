# Contributing

Code here should make sense to someone who has never seen it: simple code,
and documentation good enough to use it without reading the source. The rules
below make that checkable.

## Code

- **One direction of flow.** A package is a short pipeline of steps, one
  module per step. Each step takes plain data and returns plain data plus
  diagnostics. No step reaches back into an earlier one. Recursion inside one
  step is fine, for example resolving a file that includes another.
- **Small units.** At most 200 lines per file, 40 lines per function, nesting
  at most 3 deep, complexity at most 10. ESLint enforces these; an exception
  needs a comment explaining why.
- **I/O at the edges.** Core logic does not import `node:fs`; it reads through
  a small interface, so it runs in Node, browsers and tests alike.
- **Functions and plain objects first.** A class only for real state with a
  lifetime. No inheritance.
- **Few dependencies.** A pull request that adds a runtime dependency says
  why it is needed.

Writing style:

| Do                                                     | Avoid                                    |
| ------------------------------------------------------ | ---------------------------------------- |
| One check per rule, each with its own message and code | `check(a && b && c, "X", "Invalid")`     |
| Descriptive names                                      | `v`, `k`, `out`, `tmp`                   |
| One declaration per statement                          | `const a = 1, b = 2;`                    |
| Visible rules, documented once                         | Behaviour that depends on a field's name |
| Limits in one documented options object with defaults  | Magic numbers at call sites              |
| Shared guards written once (`isSafeKey`)               | The same check copied into several files |
| Comments that explain why                              | Comments that repeat what the code says  |

Every public export has a doc comment; ESLint fails on a missing one. Packages meet only at their entry points: ESLint refuses an
import of another package's files or a relative path out of the package.

## Documentation

User documentation lives in the documentation site,
[ingestron/docs](https://github.com/ingestron/docs); change it there in the same
release as the code. Package READMEs say what the package is, how to install
it and how to develop it. Every `ts` code block in a README must be a complete
file; `pnpm validate` type-checks them all.

## Tests

- Every change in behaviour comes with a test that fails without it.
- Behaviour is described in `spec/behaviour.md`; change it with the code.
- Test names read as sentences describing behaviour.

## Done means

1. `pnpm validate` passes.
2. A public API change updates the API report (`pnpm api` writes `api/`), so
   reviewers see the interface change.
3. A change users see updates the documentation site,
   [ingestron/docs](https://github.com/ingestron/docs), in the same release.

## Licence

Ingestron is licensed under the [Apache License 2.0](LICENSE). By contributing,
you agree that your contribution is licensed under the same terms.

Every commit is signed off under the
[Developer Certificate of Origin 1.1](https://developercertificate.org/): add
`-s` to `git commit`, which appends `Signed-off-by: Your Name <you@example.com>`
matching the commit author. `pnpm dco:check` checks the commits since
`origin/main`; pull requests run it too.

## Conduct

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).
