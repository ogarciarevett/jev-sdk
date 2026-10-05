import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { JEV_STAKES_THRESHOLDS, jevThresholdFor } from "../src/judge.ts";

// The published package as a Node consumer sees it. Bun runs the TypeScript sources directly, so
// every other test would pass on a package that plain Node refuses to load (Node does not strip
// types under node_modules). This one builds and packs the package the way `npm publish` does,
// unpacks the tarball into a throwaway consumer, and imports and runs it with `node`, never Bun.

const PACKAGE_NAME = "@ogarciarevett/jev-sdk";
const NODE_SHEBANG = "#!/usr/bin/env node\n";
const repositoryRoot = join(import.meta.dir, "..");
const node = Bun.which("node") ?? "";
const npm = Bun.which("npm") ?? "";
const missingTool = node === "" ? "node" : npm === "" ? "npm" : undefined;
if (missingTool !== undefined) {
  console.warn(`Skipping the Node package smoke test: ${missingTool} is not on PATH.`);
}

/** What the tarball may hold: the build, the question packs, the skill, the package documents. */
const SHIPPED_DIRECTORIES = ["dist/", "questions/", "skills/"];
const SHIPPED_FILES = ["package.json", "README.md", "LICENSE"];
/** What it must never hold, whatever `files` says: local state, plans, tests, sources, keys. */
const NEVER_SHIPPED = /^(\.local|odd|test|src)\/|(^|\/)\.env/;
const SYNTHETIC_ENV_FILE = `${["TYPESAFE_API_KEY", "synthetic-never-send"].join("=")}\n`;

type Run = { code: number; stdout: string; stderr: string };
type ExportTarget = string | { readonly types?: string; readonly default?: string };
type Manifest = {
  readonly exports: Readonly<Record<string, ExportTarget>>;
  readonly bin: Readonly<Record<string, string>>;
};

// Neither the key nor NODE_OPTIONS reaches a child: the CLI must answer without a key, and a loader
// injected through NODE_OPTIONS could make a broken package look importable.
const { TYPESAFE_API_KEY: _key, NODE_OPTIONS: _nodeOptions, ...environment } = Bun.env;

async function run(argv: readonly string[], cwd: string, stdin = ""): Promise<Run> {
  const child = Bun.spawn([...argv], {
    cwd,
    env: environment,
    stdin: new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
}

async function succeed(argv: readonly string[], cwd: string): Promise<Run> {
  const result = await run(argv, cwd);
  if (result.code !== 0) {
    throw new Error(`${argv.join(" ")} exited ${result.code}\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

/** Every exported subpath that is a module rather than a wildcard over shipped data files. */
function javascriptSubpaths(manifest: Manifest): string[] {
  return Object.keys(manifest.exports).filter((subpath) => !subpath.includes("*"));
}

/** The module a consumer script imports, written in that consumer's own directory. */
function consumerScript(subpaths: readonly string[]): string {
  return `const subpaths = ${JSON.stringify(subpaths)};
const loaded = {};
for (const subpath of subpaths) {
  const specifier = subpath === "." ? "${PACKAGE_NAME}" : "${PACKAGE_NAME}/" + subpath.slice(2);
  loaded[subpath] = Object.keys(await import(specifier)).length;
}
const { jevThresholdFor } = await import("${PACKAGE_NAME}/judge");
const question = { type: "noul", instructions: "Does the owner have to act?" };
process.stdout.write(JSON.stringify({
  bun: process.versions.bun ?? null,
  loaded,
  thresholds: {
    default: jevThresholdFor(question),
    critical: jevThresholdFor({ ...question, stakes: "critical" }),
    override: jevThresholdFor({ ...question, stakes: "critical" }, 0.95),
  },
  pack: import.meta.resolve("${PACKAGE_NAME}/questions/agent-operations.json"),
  skill: import.meta.resolve("${PACKAGE_NAME}/skills/jev/SKILL.md"),
}));
`;
}

describe.skipIf(missingTool !== undefined)("the packed package under plain Node", () => {
  let workspace = "";
  let consumer = "";
  let installed = "";
  let entries: string[] = [];
  let manifest: Manifest = { exports: {}, bin: {} };
  const judgeBin = () => join(installed, manifest.bin["jev-judge"] ?? "");

  beforeAll(async () => {
    workspace = mkdtempSync(join(tmpdir(), "jev-node-package-"));
    // `prepack` runs this same build, but npm prints its output into its own, so the test builds
    // first and packs with scripts off.
    await succeed([npm, "run", "build"], repositoryRoot);
    const pack = [npm, "pack", "--ignore-scripts", "--pack-destination", workspace];
    await succeed(pack, repositoryRoot);
    const tarballs = readdirSync(workspace).filter((name) => name.endsWith(".tgz"));
    if (tarballs.length !== 1) throw new Error(`expected one tarball, found [${tarballs}]`);
    const tarball = join(workspace, tarballs[0] ?? "");
    entries = (await succeed(["tar", "-tzf", tarball], workspace)).stdout
      .split("\n")
      .filter((entry) => entry.length > 0 && !entry.endsWith("/"))
      .map((entry) => entry.replace(/^package\//, ""));

    // What `npm install` would leave behind, minus the network: the tarball under node_modules.
    consumer = join(workspace, "consumer");
    const scope = join(consumer, "node_modules", "@ogarciarevett");
    mkdirSync(scope, { recursive: true });
    await succeed(["tar", "-xzf", tarball, "-C", scope], workspace);
    installed = join(scope, "jev-sdk");
    renameSync(join(scope, "package"), installed);
    manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  }, 120_000);

  afterAll(() => {
    if (workspace !== "") rmSync(workspace, { recursive: true, force: true });
  });

  test("ships only the build, the question packs, the skill, and the package documents", () => {
    const unexpected = entries.filter(
      (entry) =>
        !SHIPPED_FILES.includes(entry) &&
        !SHIPPED_DIRECTORIES.some((directory) => entry.startsWith(directory)),
    );
    expect(unexpected).toEqual([]);
    const expected = [
      ...SHIPPED_FILES,
      "dist/judge.js",
      "dist/judge.d.ts",
      "questions/agent-operations.json",
      "skills/jev/SKILL.md",
    ];
    for (const file of expected) expect(entries).toContain(file);
  });

  test("never ships local state, plans, tests, sources, or environment files", () => {
    expect(entries.filter((entry) => NEVER_SHIPPED.test(entry))).toEqual([]);
  });

  test("points every module export at built JavaScript and its declarations", () => {
    const broken = javascriptSubpaths(manifest).filter((subpath) => {
      const target = manifest.exports[subpath];
      if (typeof target !== "object" || target.types === undefined) return true;
      if (target.default === undefined || !target.default.endsWith(".js")) return true;
      return [target.types, target.default].some((file) => !existsSync(join(installed, file)));
    });
    expect(broken).toEqual([]);
  });

  test("imports every module subpath and runs the judge under node", async () => {
    const subpaths = javascriptSubpaths(manifest);
    const script = join(consumer, "smoke.mjs");
    writeFileSync(script, consumerScript(subpaths));
    const result = await run([node, script], consumer);
    expect(result).toMatchObject({ code: 0 });

    const report = JSON.parse(result.stdout);
    // Bun can stand in for `node` on PATH; this run must be Node itself.
    expect(report.bun).toBeNull();
    expect(Object.keys(report.loaded).sort()).toEqual([...subpaths].sort());
    expect(Object.entries(report.loaded).filter(([, count]) => count === 0)).toEqual([]);
    const question = { type: "noul", instructions: "Does the owner have to act?" } as const;
    expect(report.thresholds).toEqual({
      default: jevThresholdFor(question),
      critical: JEV_STAKES_THRESHOLDS.critical,
      override: 0.95,
    });
    expect(existsSync(fileURLToPath(report.pack))).toBe(true);
    expect(existsSync(fileURLToPath(report.skill))).toBe(true);
  });

  test("installs every bin as built JavaScript with a node shebang", () => {
    expect(Object.keys(manifest.bin).length).toBeGreaterThan(0);
    const broken = Object.entries(manifest.bin).filter(([, target]) => {
      const path = join(installed, target);
      return !existsSync(path) || !readFileSync(path, "utf8").startsWith(NODE_SHEBANG);
    });
    expect(broken).toEqual([]);
  });

  test("runs a bin under node", async () => {
    const result = await run([node, judgeBin(), "--help"], consumer);
    expect(result).toMatchObject({ code: 0 });
    expect(result.stdout).toContain("jev-judge --state");
  });

  test("a bin under node does not load the consumer cwd .env", async () => {
    const withEnvFile = join(workspace, "consumer-env");
    mkdirSync(withEnvFile, { recursive: true });
    writeFileSync(join(withEnvFile, ".env"), SYNTHETIC_ENV_FILE);
    const pack = join(installed, "questions", "agent-operations.json");
    const argv = [node, judgeBin(), "--state", "-", "--questions", pack];
    const result = await run(argv, withEnvFile, "sample state");
    expect(result).toMatchObject({ code: 0 });
    const verdicts: Record<string, { reason?: string }> = JSON.parse(result.stdout).verdicts;
    expect(new Set(Object.values(verdicts).map((verdict) => verdict.reason))).toEqual(
      new Set(["typesafe_api_key_missing"]),
    );
  });
});
