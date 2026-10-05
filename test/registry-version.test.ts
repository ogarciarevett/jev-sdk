import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { RegistryCheckError, registryVersionState } from "../scripts/registry-version.ts";
import { nodeTools } from "./node-tools.ts";

const script = join(import.meta.dir, "..", "scripts", "registry-version.ts");
const SPEC = "@ogarciarevett/jev-sdk@0.1.0";

/** What `npm view <spec> version --json` prints on stdout for a failure. */
function npmError(code: string, summary: string): string {
  return `${JSON.stringify({ error: { code, summary, detail: "fixture detail" } }, null, 2)}\n`;
}

const PACKAGE_NOT_FOUND = npmError(
  "E404",
  "Not Found - GET https://registry.npmjs.org/@ogarciarevett%2fjev-sdk - Not found",
);
const VERSION_NOT_FOUND = npmError("E404", "No match found for version 0.1.0");
const UNAUTHORIZED = npmError("E401", "Unable to authenticate");

describe("whether a registry already has a version", () => {
  test("is published when npm view exits 0 with exactly that version", () => {
    expect(registryVersionState(SPEC, "0.1.0", { status: 0, stdout: '"0.1.0"\n' })).toBe(
      "published",
    );
  });

  test.each([
    ["the package does not exist", PACKAGE_NOT_FOUND],
    ["the package exists without that version", VERSION_NOT_FOUND],
  ])("is absent only on npm's E404, when %s", (_case, stdout) => {
    expect(registryVersionState(SPEC, "0.1.0", { status: 1, stdout })).toBe("absent");
  });

  const forbidden = npmError("E403", "Forbidden");
  const networkError = npmError("ECONNRESET", "socket hang up");
  test.each([
    ["an auth error", { status: 1, stdout: UNAUTHORIZED }, "E401: Unable to authenticate"],
    ["a forbidden answer", { status: 1, stdout: forbidden }, "E403: Forbidden"],
    ["a network error", { status: 1, stdout: networkError }, "ECONNRESET: socket hang up"],
    ["a failure without a JSON error", { status: 1, stdout: "" }, "exited 1 without a JSON error"],
    ["npm that did not start", { status: null, stdout: "" }, "did not run"],
    ["a success that names another version", { status: 0, stdout: '"0.0.9"\n' }, "not 0.1.0"],
    ["a success with nothing to read", { status: 0, stdout: "" }, "not 0.1.0"],
  ])("refuses to guess on %s", (_case, result, message) => {
    expect(() => registryVersionState(SPEC, "0.1.0", result)).toThrow(RegistryCheckError);
    expect(() => registryVersionState(SPEC, "0.1.0", result)).toThrow(message);
  });
});

const tools = nodeTools(["node"], "the registry-version command under Node");

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
      `exit "$FAKE_NPM_EXIT"`,
    ];
    writeFileSync(fakeNpm, `${fakeNpmScript.join("\n")}\n`);
    chmodSync(fakeNpm, 0o755);
  });
  afterAll(() => {
    if (workspace !== "") rmSync(workspace, { recursive: true, force: true });
  });

  async function command(npmStdout: string, npmExit: number, output: string) {
    const { NODE_OPTIONS: _options, ...environment } = Bun.env;
    const child = Bun.spawn([tools?.node ?? "node", script], {
      cwd: project,
      env: {
        ...environment,
        PATH: [fakeBin, environment.PATH].join(delimiter),
        FAKE_NPM_ARGS: join(workspace, "npm-args"),
        FAKE_NPM_STDOUT: npmStdout,
        FAKE_NPM_EXIT: String(npmExit),
        GITHUB_OUTPUT: output,
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

  test("asks npm for the package.json name and version, and reports a published one", async () => {
    const output = join(workspace, "output-published");
    writeFileSync(output, "");
    const result = await command('"0.1.0"', 0, output);
    expect(result).toMatchObject({ code: 0 });
    expect(result.stdout).toContain(`${SPEC} is already published`);
    expect(readFileSync(join(workspace, "npm-args"), "utf8")).toBe(`view ${SPEC} version --json\n`);
    expect(readFileSync(output, "utf8")).toBe("published=true\n");
  });

  test("reports an absent version on E404", async () => {
    const output = join(workspace, "output-absent");
    writeFileSync(output, "");
    const result = await command(PACKAGE_NOT_FOUND, 1, output);
    expect(result).toMatchObject({ code: 0 });
    expect(result.stdout).toContain(`${SPEC} is not published yet`);
    expect(readFileSync(output, "utf8")).toBe("published=false\n");
  });

  test("exits 1 and writes nothing on any other npm error", async () => {
    const output = join(workspace, "output-error");
    writeFileSync(output, "");
    const result = await command(UNAUTHORIZED, 1, output);
    expect(result).toMatchObject({ code: 1, stdout: "" });
    expect(result.stderr).toContain("E401: Unable to authenticate");
    expect(readFileSync(output, "utf8")).toBe("");
  });
});
