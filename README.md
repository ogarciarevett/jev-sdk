# Jev SDK: typed decision support for repository agents

[![CI](https://github.com/ogarciarevett/jev-sdk/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ogarciarevett/jev-sdk/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@ogarciarevett/jev-sdk)](https://www.npmjs.com/package/@ogarciarevett/jev-sdk)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

Ask Jev, the TypeSafe decision service, typed questions about a piece of state and get one verdict per question. The SDK masks secrets before anything leaves the machine, applies a bar per question by its stakes, retries rate limits, and reports how far ahead the winning answer was. It ships a library, command-line tools, an MCP server, and a stop hook.

A verdict is evidence for an operator or an agent. It never authorizes an edit, a deployment, a financial action, or a skipped review.

## Quick path

1. Install: `npm i @ogarciarevett/jev-sdk`
2. Put `TYPESAFE_API_KEY` in the process environment (see [The API key](#the-api-key)).
3. Copy a question pack into your repository and ask:

```sh
mkdir -p questions
cp node_modules/@ogarciarevett/jev-sdk/questions/agent-operations.json questions/
printf '%s\n' '{"change":"rename a test helper","files":["test/helper.ts"]}' \
  | npx --no-install jev-judge --state - --questions questions/agent-operations.json
```

It prints one JSON object with a verdict per question id. Treat `undecided` as "stop or ask a person", never as yes.

## Install

| Package manager | Command |
| --- | --- |
| npm | `npm i @ogarciarevett/jev-sdk` |
| pnpm | `pnpm add @ogarciarevett/jev-sdk` |
| Bun | `bun add @ogarciarevett/jev-sdk` |

Every release goes out under one dist-tag. A pre-release never moves `latest`.

| Dist-tag | Versions | Install |
| --- | --- | --- |
| `latest` | `X.Y.Z` | `npm i @ogarciarevett/jev-sdk` |
| `rc` | `X.Y.Z-rc.N` | `npm i @ogarciarevett/jev-sdk@rc` |
| `beta` | `X.Y.Z-beta.N` | `npm i @ogarciarevett/jev-sdk@beta` |
| `alpha` | `X.Y.Z-alpha.N` | `npm i @ogarciarevett/jev-sdk@alpha` |

Pin an exact version (`@ogarciarevett/jev-sdk@1.2.0-rc.1`) when you want the same bytes on every install. Each npm release carries a provenance attestation that links it to the GitHub workflow run that built it.

The same versions are mirrored to GitHub Packages (`https://npm.pkg.github.com`), which needs a token with `read:packages` even for public packages; npm is the simpler source.

### Runtimes

| Runtime | Support |
| --- | --- |
| Node.js | `^22.18.0 \|\| >=24.2.0`, the first releases with `import.meta.main`, which every command uses. |
| Bun | Imports work as they do in Node. `bunx --no-install jev-judge` runs the commands with Node, as their `#!/usr/bin/env node` line asks; `bunx --bun` runs them with Bun. |

The package is ES modules only and ships TypeScript declarations.

## The API key

Set `TYPESAFE_API_KEY` in the process environment, from your CI secret store or a keychain wrapper that exports it for one invocation. Never put it in a file in the repository, in `package.json`, or in a command argument.

Jev reads the key from the environment only. It does not load `.env` files, and neither does Node unless asked with `--env-file`. Bun does load `.env` files on its own, so under Bun either keep the key out of them or run with `--no-env-file`.

Without the key every verdict is `undecided` with the reason `typesafe_api_key_missing`; nothing is sent.

## Verdicts

Each question id in the result maps to a verdict:

| Field | Meaning |
| --- | --- |
| `verdict` | `yes` or `no` for a `noul` question, the chosen option for a `choice`, the level for a `score`, or `undecided`. |
| `value`, `valueKind` | The probability (`noul`) or confidence (`choice`, `score`) behind the answer. |
| `threshold` | The bar the answer had to clear: an explicit override if the call set one, else the question's `stakes` (`passive` 0.6, `design` 0.75, `critical` 0.9), else 0.8. |
| `margin` | How far the leading answer is ahead of the next one. |
| `leaning` | The answer the service gave, even when it did not clear the bar. |
| `reason` | Only on `undecided`: why. |

`undecided` means Jev could not decide above the bar. It is never permission to proceed. Its reasons:

| Reason | What happened |
| --- | --- |
| `typesafe_api_key_missing` | No key in the environment; nothing was sent. |
| `request_timeout`, `network_error` | The service did not answer in time, or could not be reached. |
| `http_client_error`, `http_server_error`, `rate_limited` | The service refused the request, failed, or was still rate-limiting after retries. |
| `response_schema_mismatch`, `answer_missing`, `answer_type_mismatch` | The answer did not have the expected shape. |
| `below_threshold` | The service answered, but not confidently enough for this question's bar. |

The commands exit 0 for any verdict, `undecided` included, and 2 for a usage error.

## Commands

| Command | Role |
| --- | --- |
| `jev-judge` | Judge typed questions about state. |
| `jev-score-options` | Compare options across weighted dimensions. |
| `jev-finding` | Route a review finding against committed code and a base ref. |
| `jev-outcome`, `jev-report` | Record and summarize how decisions turned out. |
| `jev-capabilities` | Select capabilities from your skills and extras. |
| `jev-mcp-server` | Serve the `jev_judge` tool over MCP stdio. |
| `jev-stop-hook` | Optional Claude Code Stop hook: blocks a stop while Jev judges the assistant can still make progress alone; `no` or `undecided` lets it stop. |
| `jev-smoke` | Optional live latency and availability probe; needs the key. |

Every command except `jev-mcp-server`, `jev-stop-hook`, and `jev-smoke` prints its flags with `--help`. The package registers no hooks or MCP servers on its own; wire up the ones you want.

Run the commands from your repository's working directory. `jev-judge` reads `questions/agent-operations.json` there unless `--questions <path>` says otherwise; `jev-finding` reads `questions/agent-operations.json` and `questions/plan-decisions.json` unless `--questions-directory <path>` says otherwise. Nothing is read from the package implicitly.

With `--log`, decisions are appended to `.local/jev-decisions/` under the working directory (`--directory <path>` overrides it). The log holds masked content, but it is still yours: keep `.local/` in your `.gitignore`.

## Library

Import by subpath:

```ts
import { judge, jevDependenciesFrom } from "@ogarciarevett/jev-sdk/judge";

const result = await judge(
  {
    state: { change: "rename a test helper", files: ["test/helper.ts"] },
    questions: {
      needs_owner: { type: "noul", stakes: "design", instructions: "Does the owner have to act?" },
    },
  },
  jevDependenciesFrom(process.env),
);
console.log(result.verdicts.needs_owner?.verdict);
```

| Subpath | Contents |
| --- | --- |
| `@ogarciarevett/jev-sdk`, `/judge` | `judge`, `jevDependenciesFrom`, thresholds, and the request and verdict types. |
| `/mask` | `maskJevText`, `maskJevState`, `maskJevQuestions`: the masking applied before every request. |
| `/score-options`, `/finding`, `/capabilities` | The logic behind `jev-score-options`, `jev-finding`, and `jev-capabilities`. |
| `/decision-log` | Reading and writing the decision log. |
| `/jev-judge`, `/jev-finding`, and the other command names | Each command's module, importable without running it. |
| `/questions/*`, `/skills/jev/*` | The question pack templates and the agent skill, as files. |

## Question packs and the agent skill

The packs in `questions/` are templates: copy them into your repository and adapt the questions to your vocabulary. A pack is `{ "questions": { "<id>": { "type", "stakes", "instructions", "criteria" } } }`; types are `noul`, `choice`, and `score`.

`skills/jev/` is a portable agent skill with references on the protocol, question packs, anti-patterns, and a worked example. Copy it if your agent runtime uses skills.

### Migrating from a source checkout

If your repository carries a copy of Jev's sources, install the package, replace relative imports with the subpaths above and direct `bun <path>/jev-*.ts` calls with the `jev-*` commands, keep your question packs in your own `questions/` directory, and delete the copy once your tests pass.

## Develop

```sh
bun install
bun test
bunx tsc --noEmit
bun run build
```

`bun test` includes a smoke test that builds and packs the package, installs it into a temporary consumer, and imports, type-checks, and runs it with plain `node`. It needs `node` and `npm` on `PATH` and is skipped without them, unless `JEV_REQUIRE_NODE_SMOKE=1` (set in CI) turns the skip into a failure.

Releases are cut from GitHub Releases; see [RELEASING.md](RELEASING.md).

## License

[Apache-2.0](LICENSE)
