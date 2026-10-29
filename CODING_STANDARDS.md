# Coding standards

Judgement rules for reviewers. Implementers do not need to read this file; reviewers apply it to every diff. Mechanical checks (typecheck, build, tests, `bun run lint`) run in CI.

## 1. Reuse first

Before writing new code, look in the shared reusable core (`src/judge.ts`, `src/mask.ts`, `src/finding.ts` and `src/cli.ts`; new commands and the MCP server call them instead of repeating logic) and reuse or extend it. Duplicating logic that already lives there is a review finding.

## 2. Branching (TypeScript)

No nested (double) ternaries. When branching on one value, use a `switch` or a lookup map, not a chain of `else if`.

```ts
// Reject
const tone = n >= 80 ? "urgent" : n >= 60 ? "warning" : "normal";
// Accept
const tone = pickTone(n); // switch (true) or a small ordered table, one place
```

Mechanical part: Biome `style/noNestedTernary` is enabled in `biome.json` and runs as `bun run lint` (CI). No linter rule covers long `else if` chains, so reviewers check that by eye.

## 3. Validate first, at the boundary

Parse the whole input against a schema once, at the entry point, and fail with one typed validation error. Reject a function that checks fields line by line and returns or throws a different ad hoc error for each.

## 4. Schema libraries

TypeScript uses Zod wherever performance allows, and always for endpoints, MCP tools, config and messages. Hot loops may validate explicitly at their boundary instead; say why in the PR. Question packs, CLI input, MCP tool arguments and decision-log lines are boundaries. Masking runs before anything leaves the machine, so validate the shape first and mask the validated value.

## 5. Glossary

`GLOSSARY.md` is required and kept current. Every domain term with a collision risk is defined there. In this codebase "contract" means a DTO or schema (a request or response shape), not a smart contract. Reviewers flag any undefined term a diff introduces.

## 6. Unit tests ship with the code

Every added piece of code ships with unit tests, using fixtures or mocks where needed. TypeScript tests live in separate files under `test/`, mirroring the source file name.

A diff that adds logic without a unit test is a review FAIL.
