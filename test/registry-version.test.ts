import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { RegistryCheckError, registryVersionState } from "../scripts/registry-version.ts";
import { nodeTools } from "./node-tools.ts";

const script = join(import.meta.dir, "..", "scripts", "registry-version.ts");
const SPEC = "@ogarciarevett/jev-sdk@0.1.0";

/** What `npm view <spec> version --json` prints for a failure. */
function npmError(code: string, summary: string): string {
  return `${JSON.stringify({ error: { code, summary, detail: "fixture detail" } }, null, 2)}\n`;
}

const PACKAGE_NOT_FOUND = npmError(
  "E404",
  "Not Found - GET https://registry.npmjs.org/@ogarciarevett%2fjev-sdk - Not found",
);
const VERSION_NOT_FOUND = npmError("E404", "No match found for version 0.1.0");
const UNAUTHORIZED = npmError("E401", "Unable to authenticate");
const NPM_WARNING = 'npm warn Unknown user config "fixture-setting".\n';
/** npm's human-readable error lines: they name E404 but are not the JSON the check trusts. */
const NPM_TEXT_ERROR = "npm error code E404\nnpm error 404 Not Found\n";

describe("whether a registry already has a version", () => {
  test("is published when npm view exits 0 with exactly that version", () => {
    const result = { status: 0, stdout: '"0.1.0"\n', stderr: "" };
    expect(registryVersionState(SPEC, "0.1.0", result)).toBe("published");
  });

  test.each([
    ["the package does not exist", PACKAGE_NOT_FOUND],
    ["the package exists without that version", VERSION_NOT_FOUND],
  ])("is absent only on npm's E404, when %s", (_case, stdout) => {
    expect(registryVersionState(SPEC, "0.1.0", { status: 1, stdout, stderr: "" })).toBe("absent");
  });

  test.each([
    ["alone", VERSION_NOT_FOUND],
    ["after npm's warnings", `${NPM_WARNING}${VERSION_NOT_FOUND}`],
  ])("reads the E404 JSON from stderr when stdout has none: %s", (_case, stderr) => {
    expect(registryVersionState(SPEC, "0.1.0", { status: 1, stdout: "", stderr })).toBe("absent");
  });

  const failed = (stdout: string, stderr = "") => ({ status: 1, stdout, stderr });
  const succeeded = (stdout: string) => ({ status: 0, stdout, stderr: "" });
  const forbidden = npmError("E403", "Forbidden");
  const networkError = npmError("ECONNRESET", "socket hang up");
  test.each([
    ["an auth error", failed(UNAUTHORIZED), "E401: Unable to authenticate"],
    ["a forbidden answer", failed(forbidden), "E403: Forbidden"],
    ["a network error", failed(networkError), "ECONNRESET: socket hang up"],
    ["an auth error on stderr", failed("", UNAUTHORIZED), "E401"],
    ["stdout's error over stderr's", failed(UNAUTHORIZED, VERSION_NOT_FOUND), "E401"],
    ["npm's text lines only", failed("", NPM_TEXT_ERROR), "without a JSON error"],
    ["a failure with no output", failed(""), "exited 1 without a JSON error"],
    ["npm that did not start", { status: null, stdout: "", stderr: "" }, "did not run"],
    ["a success that names another version", succeeded('"0.0.9"\n'), "not 0.1.0"],
    ["a success with nothing to read", succeeded(""), "not 0.1.0"],
  ])("refuses to guess on %s", (_case, result, message) => {
    expect(() => registryVersionState(SPEC, "0.1.0", result)).toThrow(RegistryCheckError);
    expect(() => registryVersionState(SPEC, "0.1.0", result)).toThrow(message);
  });
});

const tools = nodeTools(["node"], "the registry-version command under Node");

type FakeNpm = { readonly stdout?: string; readonly stderr?: string; readonly exit: number };

describe.skipIf(tools === undefined)("the registry-version command under plain Node", () => {
  let workspace = "";
  let project = "";
  let fakeBin = "";

  beforeAll(() => {
    workspace = mkdtempSync(join(tmpdir(), "jev-registry-version-"));
    project = join(workspace, "project");
    mkdirSync(project);
    writeFileSync(
      join(project, "package.json"),
      JSON.stringify({ name: "@ogarciarevett/jev-sdk", version: "0.1.0" }),
    );
    // A stand-in `npm` that records its arguments and answers what the test asks for.
    fakeBin = join(workspace, "bin");
    mkdirSync(fakeBin);
    const fakeNpm = join(fakeBin, "npm");
    const fakeNpmScript = [
      "#!/bin/sh",
      `printf '%s\\n' "$*" > "$FAKE_NPM_ARGS"`,
      `printf '%s' "$FAKE_NPM_STDOUT"`,
      `printf '%s' "$FAKE_NPM_STDERR" >&2`,
      `exit "$FAKE_NPM_EXIT"`,
    ];
    writeFileSync(fakeNpm, `${fakeNpmScript.join("\n")}\n`);
    chmodSync(fakeNpm, 0o755);
  });
  afterAll(() => {
    if (workspace !== "") rmSync(workspace, { recursive: true, force: true });
  });

  /** Runs the script under Node; `output` undefined leaves GITHUB_OUTPUT unset. */
  async function command(npm: FakeNpm, output: string | undefined, argv: readonly string[] = []) {
    const { NODE_OPTIONS: _options, GITHUB_OUTPUT: _output, ...environment } = Bun.env;
    const child = Bun.spawn([tools?.node ?? "node", script, ...argv], {
      cwd: project,
      env: {
        ...environment,
        PATH: [fakeBin, environment.PATH].join(delimiter),
        FAKE_NPM_ARGS: join(workspace, "npm-args"),
        FAKE_NPM_STDOUT: npm.stdout ?? "",
        FAKE_NPM_STDERR: npm.stderr ?? "",
        FAKE_NPM_EXIT: String(npm.exit),
        ...(output === undefined ? {} : { GITHUB_OUTPUT: output }),
      },
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

  /** A fresh, empty GITHUB_OUTPUT file. */
  function outputFile(name: string): string {
    const output = join(workspace, name);
    writeFileSync(output, "");
    return output;
  }

  test("asks npm for the package.json name and version, and reports a published one", async () => {
    const output = outputFile("output-published");
    const result = await command({ stdout: '"0.1.0"', exit: 0 }, output);
    expect(result).toMatchObject({ code: 0 });
    expect(result.stdout).toContain(`${SPEC} is already published`);
    expect(readFileSync(join(workspace, "npm-args"), "utf8")).toBe(`view ${SPEC} version --json\n`);
    expect(readFileSync(output, "utf8")).toBe("published=true\n");
  });

  test("reports an absent version on E404", async () => {
    const output = outputFile("output-absent");
    const result = await command({ stdout: PACKAGE_NOT_FOUND, exit: 1 }, output);
    expect(result).toMatchObject({ code: 0 });
    expect(result.stdout).toContain(`${SPEC} is not published yet`);
    expect(readFileSync(output, "utf8")).toBe("published=false\n");
  });

  test("reads npm's E404 JSON from stderr when stdout has none", async () => {
    const output = outputFile("output-stderr");
    const stderr = `${NPM_WARNING}${PACKAGE_NOT_FOUND}`;
    const result = await command({ stderr, exit: 1 }, output);
    expect(result).toMatchObject({ code: 0 });
    expect(readFileSync(output, "utf8")).toBe("published=false\n");
  });

  test("exits 1 and writes nothing on any other npm error", async () => {
    const output = outputFile("output-error");
    const result = await command({ stdout: UNAUTHORIZED, exit: 1 }, output);
    expect(result).toMatchObject({ code: 1, stdout: "" });
    expect(result.stderr).toContain("E401: Unable to authenticate");
    expect(readFileSync(output, "utf8")).toBe("");
  });

  test.each([
    ["unset", undefined],
    ["empty", ""],
  ])("prints the answer and writes no output file when GITHUB_OUTPUT is %s", async (_c, output) => {
    const result = await command({ stdout: '"0.1.0"', exit: 0 }, output);
    expect(result).toMatchObject({ code: 0, stdout: `${SPEC} is already published\n` });
    expect(readdirSync(project)).toEqual(["package.json"]);
  });

  test("exits 2 with the usage when given an argument", async () => {
    const result = await command({ stdout: '"0.1.0"', exit: 0 }, undefined, ["extra"]);
    expect(result).toMatchObject({ code: 2, stdout: "" });
    expect(result.stderr).toContain("usage: node scripts/registry-version.ts");
  });
});
