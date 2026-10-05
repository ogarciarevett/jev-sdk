import { describe, expect, test } from "bun:test";

import { runsAsScript } from "../scripts/entry-point.ts";

describe("whether a CI script runs its main", () => {
  test("runs when the runtime says the file is the entry point", () => {
    expect(runsAsScript(true)).toBe(true);
  });

  test("stays quiet when another module imported it, as the tests do", () => {
    expect(runsAsScript(false)).toBe(false);
  });

  test("runs on a runtime without import.meta.main instead of exiting 0 having done nothing", () => {
    expect(runsAsScript(undefined)).toBe(true);
  });
});
