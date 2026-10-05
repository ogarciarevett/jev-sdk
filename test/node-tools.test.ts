import { describe, expect, test } from "bun:test";

import { nodeToolsGate, REQUIRE_NODE_VARIABLE } from "./node-tools.ts";

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
