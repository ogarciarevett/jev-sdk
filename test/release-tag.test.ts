import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { prereleaseFlagFrom, ReleaseTagError, releaseDistTag } from "../scripts/release-tag.ts";
import { nodeTools } from "./node-tools.ts";

const script = join(import.meta.dir, "..", "scripts", "release-tag.ts");

describe("the npm dist-tag of a GitHub release", () => {
  test.each([
    ["v1.2.0", "1.2.0", false, "latest"],
    ["v0.1.0", "0.1.0", false, "latest"],
    ["v1.2.0-rc.1", "1.2.0-rc.1", true, "rc"],
    ["v1.2.0-beta.2", "1.2.0-beta.2", true, "beta"],
    ["v1.2.0-alpha.3", "1.2.0-alpha.3", true, "alpha"],
    ["v10.20.30-rc.0", "10.20.30-rc.0", true, "rc"],
  ] as const)(
    "%s with version %s and prerelease %p publishes as %s",
    (tag, version, prerelease, distTag) => {
      expect(releaseDistTag({ tag, version, prerelease })).toBe(distTag);
    },
  );

  test.each([
    ["v1.2.1", "1.2.0"],
    ["1.2.0", "1.2.0"],
    ["v1.2.0-rc.2", "1.2.0-rc.1"],
    ["release-1.2.0", "1.2.0"],
  ])("refuses tag %s for version %s", (tag, version) => {
    const prerelease = version.includes("-");
    expect(() => releaseDistTag({ tag, version, prerelease })).toThrow(
      new ReleaseTagError(`tag ${tag} does not match package.json version ${version}: expected v${version}`),
    );
  });

  test.each([
    "1.2.0-next.1",
    "1.2",
    "01.2.0",
    "1.2.0-rc",
    "1.2.0-rc.01",
    "1.2.0-RC.1",
    "1.2.0+build.1",
    " 1.2.0",
  ])(
    "refuses version %p, which is neither X.Y.Z nor X.Y.Z-(alpha|beta|rc).N",
    (version) => {
      expect(() => releaseDistTag({ tag: `v${version}`, version, prerelease: true })).toThrow(
        new ReleaseTagError(
          `package.json version ${JSON.stringify(version)} is neither X.Y.Z nor X.Y.Z-(alpha|beta|rc).N`,
        ),
      );
    },
  );

  test("refuses a stable version on a release marked as a pre-release", () => {
    expect(() => releaseDistTag({ tag: "v1.2.0", version: "1.2.0", prerelease: true })).toThrow(
      new ReleaseTagError("v1.2.0 is a stable version, but the GitHub release is marked as a pre-release"),
    );
  });

  test.each([
    ["1.2.0-rc.1", "an rc"],
    ["1.2.0-beta.2", "a beta"],
    ["1.2.0-alpha.3", "an alpha"],
  ])("refuses %s on a release not marked as a pre-release", (version, kind) => {
    expect(() => releaseDistTag({ tag: `v${version}`, version, prerelease: false })).toThrow(
      new ReleaseTagError(
        `v${version} is ${kind} version, but the GitHub release is not marked as a pre-release`,
      ),
    );
  });

  test("never resolves a suffixed version to latest, whatever the flag says", () => {
    for (const version of ["1.0.0-alpha.1", "1.0.0-beta.1", "1.0.0-rc.1"]) {
      for (const prerelease of [true, false]) {
        let distTag: string | undefined;
        try {
          distTag = releaseDistTag({ tag: `v${version}`, version, prerelease });
        } catch (error) {
          expect(error).toBeInstanceOf(ReleaseTagError);
        }
        expect(distTag).not.toBe("latest");
      }
    }
  });

  test("reads the prerelease flag GitHub writes, and nothing else", () => {
    expect(prereleaseFlagFrom("true")).toBe(true);
    expect(prereleaseFlagFrom("false")).toBe(false);
    for (const raw of ["", "True", "yes", "1", undefined]) {
      expect(() => prereleaseFlagFrom(raw)).toThrow(ReleaseTagError);
    }
  });
});

const tools = nodeTools(["node"], "the release-tag command under Node");

describe.skipIf(tools === undefined)("the release-tag command under plain Node", () => {
  let workspace = "";
  beforeAll(() => {
    workspace = mkdtempSync(join(tmpdir(), "jev-release-tag-"));
  });
  afterAll(() => {
    if (workspace !== "") rmSync(workspace, { recursive: true, force: true });
  });

  /** The script as the release workflow runs it: plain Node, its own GITHUB_OUTPUT or none. */
  async function command(argv: readonly string[], output?: string) {
    const { GITHUB_OUTPUT: _output, NODE_OPTIONS: _options, ...environment } = Bun.env;
    const child = Bun.spawn([tools?.node ?? "node", script, ...argv], {
      env: output === undefined ? environment : { ...environment, GITHUB_OUTPUT: output },
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

  test("prints the dist-tag and appends it to GITHUB_OUTPUT", async () => {
    const output = join(workspace, "output-ok");
    writeFileSync(output, "earlier=kept\n");
    const result = await command(["v1.2.0-rc.1", "1.2.0-rc.1", "true"], output);
    expect(result).toMatchObject({ code: 0, stdout: "rc\n" });
    expect(readFileSync(output, "utf8")).toBe("earlier=kept\ntag=rc\n");
  });

  test.each([
    ["unset", undefined],
    ["empty", ""],
  ])("prints the dist-tag and writes nothing when GITHUB_OUTPUT is %s", async (_case, output) => {
    const result = await command(["v1.2.0", "1.2.0", "false"], output);
    expect(result).toMatchObject({ code: 0, stdout: "latest\n", stderr: "" });
  });

  test("exits 1 with the reason and writes nothing when the release does not add up", async () => {
    const output = join(workspace, "output-refused");
    writeFileSync(output, "");
    const result = await command(["v1.2.0", "1.2.0", "true"], output);
    expect(result).toMatchObject({ code: 1, stdout: "" });
    expect(result.stderr).toContain("marked as a pre-release");
    expect(readFileSync(output, "utf8")).toBe("");
  });

  test("exits 2 with the usage when an argument is missing", async () => {
    const result = await command(["v1.2.0", "1.2.0"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("release-tag.ts <tag> <package version> <prerelease>");
  });
});
