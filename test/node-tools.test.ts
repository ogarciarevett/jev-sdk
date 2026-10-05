import { describe, expect, test } from "bun:test";

import {
  type NodeToolsHooks,
  nodeTools,
  nodeToolsGate,
  REQUIRE_NODE_VARIABLE,
} from "./node-tools.ts";

/** Hooks that find only `present`, and record what `nodeTools` registers or prints. */
function recordingHooks(present: readonly string[], environment: Record<string, string>) {
  const failures: { name: string; body: () => void }[] = [];
  const warnings: string[] = [];
  const hooks: NodeToolsHooks = {
    which: (name) => (present.includes(name) ? `/fixture/bin/${name}` : null),
    environment,
    registerFailure: (name, body) => failures.push({ name, body }),
    warn: (message) => warnings.push(message),
  };
  return { hooks, failures, warnings };
}

describe("the gate in front of tests that need plain Node", () => {
  test("runs when every tool is on PATH, whatever the flag says", () => {
    expect(nodeToolsGate([], {})).toEqual({ run: true });
    expect(nodeToolsGate([], { [REQUIRE_NODE_VARIABLE]: "1" })).toEqual({ run: true });
  });

  test("skips a missing tool by default, naming it", () => {
    expect(nodeToolsGate(["node"], {})).toEqual({ run: false, fail: false, missing: "node" });
    expect(nodeToolsGate(["node", "npm"], { [REQUIRE_NODE_VARIABLE]: "0" })).toEqual({
      run: false,
      fail: false,
      missing: "node and npm",
    });
  });

  test("turns a missing tool into a failure when the flag is 1, as CI sets it", () => {
    expect(REQUIRE_NODE_VARIABLE).toBe("JEV_REQUIRE_NODE_SMOKE");
    expect(nodeToolsGate(["npm"], { [REQUIRE_NODE_VARIABLE]: "1" })).toEqual({
      run: false,
      fail: true,
      missing: "npm",
    });
  });
});

describe("resolving the tools for a suite", () => {
  test("returns every path and registers nothing when the tools are present", () => {
    const { hooks, failures, warnings } = recordingHooks(["node", "npm"], {});
    expect(nodeTools(["node", "npm"], "the suite", hooks)).toEqual({
      node: "/fixture/bin/node",
      npm: "/fixture/bin/npm",
    });
    expect({ failures, warnings }).toEqual({ failures: [], warnings: [] });
  });

  test("warns and returns nothing, so the suite skips, without the flag", () => {
    const { hooks, failures, warnings } = recordingHooks(["npm"], {});
    expect(nodeTools(["node", "npm"], "the suite", hooks)).toBeUndefined();
    expect(failures).toEqual([]);
    expect(warnings).toEqual(["Skipping the suite: it needs node on PATH."]);
  });

  test("registers one failing test, and prints nothing, under the flag", () => {
    const { hooks, failures, warnings } = recordingHooks([], { [REQUIRE_NODE_VARIABLE]: "1" });
    expect(nodeTools(["node"], "the suite", hooks)).toBeUndefined();
    expect(warnings).toEqual([]);
    expect(failures.map((failure) => failure.name)).toEqual([
      "the suite needs node on PATH (JEV_REQUIRE_NODE_SMOKE=1)",
    ]);
    expect(() => failures[0]?.body()).toThrow(
      "the suite needs node on PATH, and JEV_REQUIRE_NODE_SMOKE=1 forbids skipping it",
    );
  });
});
