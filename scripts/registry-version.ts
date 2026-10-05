#!/usr/bin/env node
// Whether the registry npm is configured for already has this package.json's name and version, so
// a release re-run skips a registry it already published to instead of failing on it:
//
//   node scripts/registry-version.ts
//
// It asks `npm view <name>@<version> version --json`, which honours the job's .npmrc and token,
// prints the answer, and appends `published=true` or `published=false` to GITHUB_OUTPUT when that
// is set. Only npm's E404 (no such package, or no such version) means absent; an authentication,
// permission, network, or unreadable answer exits 1, because publishing on a guess is worse.
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

import { runsAsScript } from "./entry-point.ts";

export type NpmViewResult = {
  /** The exit code, or null when npm did not run at all. */
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

type NpmJsonError = { readonly code: string; readonly summary?: unknown };

export type RegistryVersionState = "published" | "absent";

/** The registry could not say; the release must stop rather than guess. */
export class RegistryCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryCheckError";
  }
}

const REGISTRY_VERSION_USAGE = "usage: node scripts/registry-version.ts (reads ./package.json)\n";

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * The `{ "error": { "code", ... } }` object npm prints for a failed `--json` command, either as the
 * whole text or starting on its own line after npm's warnings. npm 11 writes it to stdout, but
 * stderr is read too rather than depending on that. Anything else is no answer at all.
 */
function npmJsonError(text: string): NpmJsonError | undefined {
  const lineStart = text.search(/^\{/m);
  const candidates = [text, lineStart > 0 ? text.slice(lineStart) : ""];
  for (const candidate of candidates) {
    const error = (parsedJson(candidate.trim()) as { error?: unknown } | null | undefined)?.error;
    const code = (error as { code?: unknown } | null | undefined)?.code;
    if (typeof code === "string") return error as NpmJsonError;
  }
  return undefined;
}

/** Reads what `npm view <spec> version --json` answered for `version`. */
export function registryVersionState(
  spec: string,
  version: string,
  result: NpmViewResult,
): RegistryVersionState {
  if (result.status === null) throw new RegistryCheckError(`npm view ${spec} did not run`);
  if (result.status === 0) {
    if (parsedJson(result.stdout) === version) return "published";
    throw new RegistryCheckError(
      `npm view ${spec} answered ${JSON.stringify(result.stdout.trim())}, not ${version}`,
    );
  }
  const error = npmJsonError(result.stdout) ?? npmJsonError(result.stderr);
  if (error === undefined) {
    throw new RegistryCheckError(
      `npm view ${spec} exited ${result.status} without a JSON error`,
    );
  }
  if (error.code === "E404") return "absent";
  throw new RegistryCheckError(`npm view ${spec} failed: ${error.code}: ${String(error.summary)}`);
}

function main(argv: readonly string[], output: string | undefined): number {
  if (argv.length !== 0) {
    process.stderr.write(REGISTRY_VERSION_USAGE);
    return 2;
  }
  try {
    const { name, version } = JSON.parse(readFileSync("package.json", "utf8")) as {
      name: string;
      version: string;
    };
    const spec = `${name}@${version}`;
    const result = spawnSync("npm", ["view", spec, "version", "--json"], { encoding: "utf8" });
    const state = registryVersionState(spec, version, {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    });
    const published = state === "published";
    if (output !== undefined && output !== "") appendFileSync(output, `published=${published}\n`);
    process.stdout.write(`${spec} is ${published ? "already published" : "not published yet"}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`registry-version: ${message}\n`);
    return 1;
  }
}

if (runsAsScript(import.meta.main)) {
  process.exit(main(process.argv.slice(2), process.env.GITHUB_OUTPUT));
}
