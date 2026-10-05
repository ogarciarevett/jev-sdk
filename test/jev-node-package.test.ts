import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { JEV_STAKES_THRESHOLDS, jevThresholdFor } from "../src/judge.ts";
import { nodeTools } from "./node-tools.ts";

// The published package as a Node consumer sees it. Bun runs the TypeScript sources directly, so
// every other test would pass on a package that plain Node refuses to load (Node does not strip
// types under node_modules). This one builds and packs the package the way `npm publish` does,
// installs the tarball into a throwaway consumer, and imports, type-checks, and runs it with
// `node`, never Bun.

const PACKAGE_NAME = "@ogarciarevett/jev-sdk";
const NODE_SHEBANG = "#!/usr/bin/env node\n";
const repositoryRoot = join(import.meta.dir, "..");
const tscBin = join(repositoryRoot, "node_modules", "typescript", "bin", "tsc");
const tools = nodeTools(["node", "npm"], "the Node package smoke test");
const node = tools?.node ?? "";
const npm = tools?.npm ?? "";

/** What the tarball may hold: the build, the question packs, the skill, the package documents. */
const SHIPPED_DIRECTORIES = ["dist/", "questions/", "skills/"];
const SHIPPED_FILES = ["package.json", "README.md", "LICENSE"];
/** What it must never hold, whatever `files` says: local state, plans, tests, sources, keys. */
const NEVER_SHIPPED = /^(\.local|odd|test|src)\/|(^|\/)\.env/;
const SYNTHETIC_ENV_FILE = `${["TYPESAFE_API_KEY", "synthetic-never-send"].join("=")}\n`;
/** The one question and the one override that both the consumers and the expectations use. */
const SAMPLE_QUESTION = { type: "noul", instructions: "Does the owner have to act?" } as const;
const THRESHOLD_OVERRIDE = 0.95;
/** The module settings a TypeScript consumer is likely to have. */
const TYPESCRIPT_CONSUMERS = [
  ["NodeNext", { module: "NodeNext", moduleResolution: "NodeNext" }],
  ["Bundler", { module: "Preserve", moduleResolution: "Bundler" }],
] as const;

type Run = { code: number; stdout: string; stderr: string };
type ExportTarget = string | { readonly types?: string; readonly default?: string };
type Manifest = {
  readonly exports: Readonly<Record<string, ExportTarget>>;
  readonly bin: Readonly<Record<string, string>>;
};

// Neither the key nor NODE_OPTIONS reaches a child: the CLI must answer without a key, and a loader
// injected through NODE_OPTIONS could make a broken package look importable. The Node the suite
// found leads PATH, so a bin's `#!/usr/bin/env node` starts that Node, not a Bun stand-in.
const { TYPESAFE_API_KEY: _key, NODE_OPTIONS: _nodeOptions, ...inherited } = Bun.env;
const environment = {
  ...inherited,
  PATH: node === "" ? inherited.PATH : [dirname(node), inherited.PATH].join(delimiter),
};

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

function specifierOf(subpath: string): string {
  return subpath === "." ? PACKAGE_NAME : `${PACKAGE_NAME}/${subpath.slice(2)}`;
}

/** The module a JavaScript consumer runs, written in that consumer's own directory. */
function consumerScript(subpaths: readonly string[]): string {
  const specifiers = Object.fromEntries(subpaths.map((subpath) => [subpath, specifierOf(subpath)]));
  return `const specifiers = ${JSON.stringify(specifiers)};
const loaded = {};
for (const [subpath, specifier] of Object.entries(specifiers)) {
  loaded[subpath] = Object.keys(await import(specifier)).length;
}
const { jevThresholdFor } = await import("${PACKAGE_NAME}/judge");
const question = ${JSON.stringify(SAMPLE_QUESTION)};
process.stdout.write(JSON.stringify({
  bun: process.versions.bun ?? null,
  loaded,
  thresholds: {
    default: jevThresholdFor(question),
    critical: jevThresholdFor({ ...question, stakes: "critical" }),
    override: jevThresholdFor({ ...question, stakes: "critical" }, ${THRESHOLD_OVERRIDE}),
  },
  pack: import.meta.resolve("${PACKAGE_NAME}/questions/agent-operations.json"),
  skill: import.meta.resolve("${PACKAGE_NAME}/skills/jev/SKILL.md"),
}));
`;
}

/** A TypeScript consumer of every module subpath, compiled against the installed declarations. */
function typesConsumer(subpaths: readonly string[]): string {
  const modules = subpaths.map((subpath, index) => ({ name: `module${index}`, subpath }));
  const imports = modules.map(
    ({ name, subpath }) => `import type * as ${name} from "${specifierOf(subpath)}";`,
  );
  return `${imports.join("\n")}
import { jevThresholdFor, type JevQuestion } from "${PACKAGE_NAME}/judge";
import type { JevCliOptions } from "${PACKAGE_NAME}/jev-judge";

export type Modules = [${modules.map(({ name }) => `typeof ${name}`).join(", ")}];
const question: JevQuestion = ${JSON.stringify(SAMPLE_QUESTION)};
export const threshold: number = jevThresholdFor(question, ${THRESHOLD_OVERRIDE});
// jev-judge.d.ts reaches this type through a \`./judge.ts\` specifier: real, never \`any\`.
// @ts-expect-error "not-a-stakes-word" is not a stakes level.
export const stakes: JevCliOptions["stakes"] = "not-a-stakes-word";
`;
}

describe.skipIf(tools === undefined)("the packed package under plain Node", () => {
  let workspace = "";
  let consumer = "";
  let installed = "";
  let entries: string[] = [];
  let manifest: Manifest = { exports: {}, bin: {} };

  /** The `jev-judge` file the manifest names. A missing entry is a packaging bug, not a skip. */
  function judgeBinTarget(): string {
    const target = manifest.bin["jev-judge"];
    if (target === undefined) throw new Error("the packed package.json has no jev-judge bin");
    return join(installed, target);
  }

  /** The link npm made for `jev-judge`, which starts the file through its shebang. */
  const binLink = (name: string) => join(consumer, "node_modules", ".bin", name);

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

    // A real install, offline: the tarball has no dependencies, and npm links the bins exactly as
    // it does for any consumer.
    consumer = join(workspace, "consumer");
    mkdirSync(consumer);
    writeFileSync(join(consumer, "package.json"), '{ "private": true, "type": "module" }\n');
    const install = [npm, "install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"];
    await succeed([...install, tarball], consumer);
    installed = join(consumer, "node_modules", "@ogarciarevett", "jev-sdk");
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
    expect(report.thresholds).toEqual({
      default: jevThresholdFor(SAMPLE_QUESTION),
      critical: JEV_STAKES_THRESHOLDS.critical,
      override: THRESHOLD_OVERRIDE,
    });
    expect(existsSync(fileURLToPath(report.pack))).toBe(true);
    expect(existsSync(fileURLToPath(report.skill))).toBe(true);
  });

  test.each(TYPESCRIPT_CONSUMERS)(
    "type-checks a %s TypeScript consumer against the declarations",
    async (name, moduleOptions) => {
      writeFileSync(join(consumer, "types.ts"), typesConsumer(javascriptSubpaths(manifest)));
      const config = join(consumer, `tsconfig.${name}.json`);
      const compilerOptions = {
        target: "ES2022",
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        types: [],
        ...moduleOptions,
      };
      writeFileSync(config, JSON.stringify({ compilerOptions, files: ["types.ts"] }));
      expect(await run([node, tscBin, "-p", config], consumer)).toMatchObject({ code: 0 });
    },
    30_000,
  );

  test("installs every bin as built JavaScript with a node shebang and a link", () => {
    expect(Object.keys(manifest.bin).length).toBeGreaterThan(0);
    const broken = Object.entries(manifest.bin).filter(([name, target]) => {
      const path = join(installed, target);
      if (!existsSync(path) || !existsSync(binLink(name))) return true;
      return !readFileSync(path, "utf8").startsWith(NODE_SHEBANG);
    });
    expect(broken).toEqual([]);
  });

  test("runs a bin file under node", async () => {
    const result = await run([node, judgeBinTarget(), "--help"], consumer);
    expect(result).toMatchObject({ code: 0 });
    expect(result.stdout).toContain("jev-judge --state");
  });

  test("runs the installed bin link through its shebang", async () => {
    const result = await run([binLink("jev-judge"), "--help"], consumer);
    expect(result).toMatchObject({ code: 0 });
    expect(result.stdout).toContain("jev-judge --state");
  });

  test("an installed bin does not load the consumer cwd .env", async () => {
    const withEnvFile = join(workspace, "consumer-env");
    mkdirSync(withEnvFile, { recursive: true });
    writeFileSync(join(withEnvFile, ".env"), SYNTHETIC_ENV_FILE);
    const pack = join(installed, "questions", "agent-operations.json");
    const argv = [binLink("jev-judge"), "--state", "-", "--questions", pack];
    const result = await run(argv, withEnvFile, "sample state");
    expect(result).toMatchObject({ code: 0 });
    const verdicts: Record<string, { reason?: string }> = JSON.parse(result.stdout).verdicts;
    expect(new Set(Object.values(verdicts).map((verdict) => verdict.reason))).toEqual(
      new Set(["typesafe_api_key_missing"]),
    );
  });
});
