# Publish Jev as a Node package

Objective: Ship `@ogarciarevett/jev-sdk` as a public package that plain Node.js can import and run, released from CI to npm and GitHub Packages with standard dist-tags.

Problem: The package exports raw TypeScript with extensionless relative imports and Bun shebangs. Node refuses to strip types under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, verified on Node 26), so Node consumers such as Booker cannot use it. There is no license, no CI, and no release process.

Why: Booker (Node 24+, pnpm) should use this SDK as its Jev decision maker instead of its own thin client, gaining masking, stakes thresholds, rate-limit retries, and margins.

Scope:
- Node build: relative imports carry `.ts` extensions and compile to `.js` (`rewriteRelativeImportExtensions`), a build tsconfig emits `dist/` JavaScript plus declarations, bins point at `dist/*.js` with a Node shebang, `exports` map types and import conditions, `files` ships `dist`, `questions`, `skills`, `README.md`, `LICENSE`. Bun keeps working (tests still run with `bun test`).
- License: Apache-2.0 (same as Booker; the user did not object).
- CI on pull requests: tests, typecheck, build, a Node smoke test of the built package, gitleaks.
- Release on a published GitHub Release: the tag must equal `package.json` version; the npm dist-tag comes from the version (`X.Y.Z` latest, `-rc.N` rc, `-beta.N` beta, `-alpha.N` alpha); the GitHub "pre-release" flag must match; publish to npm with provenance (trusted publishing, OIDC) and to GitHub Packages with `GITHUB_TOKEN`.
- Docs: README for public npm install, `RELEASING.md` with the first-publish bootstrap.

Out of scope: Booker's migration to the SDK (separate feature, after the 24 h `minimumReleaseAge` window), changing Jev behavior.

Constraints: English artifacts, Conventional Commits, no AI attribution, no secrets (audit 2026-10-05: full-history gitleaks found only a fake JWT fixture in `test/jev-mask.test.ts`; `.local/` is ignored and untracked). GitHub Actions pinned by commit SHA. Dependencies at least one day old.

TDD: strict (global configuration); runner `bun test`; RED -> GREEN -> REFACTOR.

Delivery: feature-branch-chain (the user's choice for Booker, reused): tracker `feat/node-package`, slices `-01-node-build`, `-02-ci-release`, `-03-docs`. Pushes use HTTPS with the gh credential helper, never the SSH agent.

## Tasks
- [x] N1 Node build, license, package metadata, Node smoke test. Commit `1060462` on `feat/node-package-01-node-build`.
- [x] N2 PR CI workflow, release workflow, dist-tag helper with tests. Commits `873ac08` and `16b92de` on `feat/node-package-02-ci-release`.
- [ ] N3 README and RELEASING.md.

## Acceptance
- [x] `node -e "import('@ogarciarevett/jev-sdk/judge')"` style smoke passes against the built package from a temp consumer, and one bin runs under Node. (`test/jev-node-package.test.ts`, N1)
- [x] `bun test` and typecheck green. (at `1060462` and `16b92de`; recheck at each slice)
- [x] Release dry run computes the right dist-tag for stable, rc, beta, alpha, and rejects mismatches. (`test/release-tag.test.ts` and manual `node scripts/release-tag.ts` runs, N2)
- [x] Packed tarball (`npm pack --dry-run` equivalent) contains no `.local`, `odd`, `test`, or secrets. (the smoke test asserts an allowlist and a denylist over `tar -tzf` of the real `npm pack` tarball)

## Progress

### N1 (done, `1060462`)
- RED: `bun test test/jev-node-package.test.ts` failed in setup with `npm error Missing script: "build"` (0 pass, 1 fail). Manually, the then-current package packed with `npm pack` and imported under Node 26.9 failed with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` for `src/judge.ts`.
- GREEN: `bun test` 337 pass, 0 fail, 579 expect() calls, 14 files (baseline 330 in 13 files; the smoke test adds 7). `bunx tsc --noEmit` clean. `bun run build` clean (18 `.js` and 18 `.d.ts` in `dist/`). `bun install --frozen-lockfile` unchanged.
- Extra checks: `npm install --offline` of the tarball links all nine bins, and `node_modules/.bin/jev-judge --help` runs through the shebang. A TypeScript consumer (`skipLibCheck: false`, NodeNext and Bundler) resolves the declarations, whose relative specifiers stay `.ts`.
- gitleaks `dir . --redact`: only the two known findings (`test/jev-mask.test.ts` fake JWT, ignored `.local/review-status.json`).
- Tarball: 46 files, 55.3 kB: `LICENSE`, `README.md`, `package.json`, `dist/*.js` and `dist/*.d.ts`, `questions/*.json`, `skills/jev/**`.
- Review: approved by the native review (4 lenses); pushed as jev-sdk PR #1.

Decisions:
- The source shebang is `#!/usr/bin/env node`, which tsc copies into `dist/`; no build rewrite step. Running sources with `bun src/<name>.ts` still works, and executing a source file directly now runs Node type stripping, which `verbatimModuleSyntax` and `erasableSyntaxOnly` in `tsconfig.json` keep valid (both passed with no code changes).
- `engines.node` is `^22.18.0 || >=24.2.0`, not `>=22.14`: every bin gates on `import.meta.main`, added in Node 22.18.0 and 24.2.0 (nodejs.org/api/esm.html). On 22.14 to 22.17 the bins would exit 0 without doing anything. Trusted publishing's Node 22.14 floor applies to the CI runner, not consumers.
- Exports use `types` then `default`; `default` serves `import` and Node's `require(esm)` alike.
- `src/` is not shipped: declarations carry the types, the emitted JavaScript stays close to the source (types erased, comments kept), and no source maps point at missing files.
- `tsconfig.build.json` loads Node types only (from `@types/node`, a dependency of `bun-types`), so a Bun global in `src/` fails the build. No new dependency was added.

Open for later slices:
- README install section still documents GitHub installs; a Git install no longer carries `dist/` (ignored, built at pack time). N3 switches it to the registry.
- `build` uses `rm -rf`, fine under Bun's shell and POSIX `npm`, not under `npm` on Windows `cmd`.
- `bun.lock` still names the workspace `@ogarciarevett/jev` (harmless; frozen install passes).

### N2 (done, `873ac08`, `16b92de`)
- `873ac08` test(package): `test/node-tools.ts` gates Node-only suites (skip without `node`/`npm`, a failing test under `JEV_REQUIRE_NODE_SMOKE=1`). The smoke test now installs the tarball with `npm install --offline`, runs `node_modules/.bin/jev-judge` through its shebang (also for the `.env` check), type-checks NodeNext and Bundler consumers of every subpath with `skipLibCheck: false` (a `@ts-expect-error` proves the types are real), defines the sample question and the 0.95 override once, and names a missing `jev-judge` bin.
- `16b92de` ci: `scripts/release-tag.ts` (+ `test/release-tag.test.ts`), `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.gitleaksignore`, `scripts/` in the root typecheck.
- RED: `test/node-tools.test.ts` and `test/release-tag.test.ts` each failed with `Cannot find module` (0 pass, 1 fail) before their modules existed. The widened smoke checks pass against N1's package (they add coverage, not behavior); a mutation (a valid stakes word under `@ts-expect-error`) failed both TypeScript consumers with TS2578.
- GREEN: `bun test` 371 pass, 0 fail, 635 expect() calls, 16 files, with and without `JEV_REQUIRE_NODE_SMOKE=1`, on Node 26.9 and on Node 22.18.0 / npm 10.9.3 (checksum-verified download into a scratch dir). `bunx tsc --noEmit` clean. `bun run build` clean. `actionlint` 1.7.12 (with shellcheck): 0 errors in both workflows.
- Flag end to end: with `node`/`npm` off PATH, the smoke file skips 12 and exits 0; with the flag it fails 1 and exits 1.
- Release tag under Node: `v1.2.0 1.2.0 false` latest; `v1.2.0-rc.1 … true` rc; `-beta.2` beta; `-alpha.3` alpha; tag mismatch, stable-marked-pre-release, rc-not-marked, and `1.2.0-next.1` exit 1 with the reason; `GITHUB_OUTPUT` gets `tag=rc`.
- gitleaks `git` (full history): no leaks (the fixture fingerprint is ignored). `dir`: only the ignored `.local/review-status.json`.
- Review: tier not assessed by the writer; pending the parent.

Decisions:
- The release script runs as `node scripts/release-tag.ts` with no build: Node strips types by default and without a warning from 22.18.0 (nodejs.org/api/typescript.html), and the root typecheck covers `scripts/`. `scripts/` is not shipped.
- Pinned actions: `actions/checkout@3d3c42e5…` v7.0.1 and `actions/setup-node@82076278…` v7.0.0 (reused from Booker), `oven-sh/setup-bun@0c5077e5…` v2.2.0 (2026-03-14, resolved with `gh api`). gitleaks 8.30.1 with Booker's SHA-256, which matches the upstream checksums file.
- npm auth (npm CLI 11.19.0 `lib/utils/oidc.js`; docs.npmjs.com/trusted-publishers): with `id-token: write`, npm exchanges the GitHub OIDC token for a package publish token and overrides any configured token; only a failed exchange falls back to `NODE_AUTH_TOKEN`. Provenance is automatic after a successful exchange for a public repository and a public package; `--provenance` also attests the bootstrap publish. Node 24.x bundles npm 11.19.0 (above 11.5.1); a guard step fails early otherwise.
- `.gitleaksignore` lists exact fingerprints (the commit and the working-tree file) for the fake JWT fixture, so the full-history scan passes without weakening any rule; a moved or new match is reported again.
- Concurrency group `release-publish`, not cancelled in progress. GitHub keeps one waiting run per group, so a third quick release cancels the waiting one, which then needs a re-run.

## User steps (after merge)
1. npm account `ogarciarevett` (scope owner).
2. First publish: add a short-lived granular npm token as the repository secret `NPM_TOKEN`, publish the GitHub release (tag `v0.1.0`, not a pre-release), then configure the trusted publisher on npmjs.com (owner `ogarciarevett`, repository `jev-sdk`, workflow `release.yml`, no environment), delete the secret, and revoke the token.

Next step: N3 on `feat/node-package-03-docs` (README for the public npm install, RELEASING.md with the bootstrap above).
