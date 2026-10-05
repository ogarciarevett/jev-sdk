// The tools a test needs to run something under plain Node, never Bun. A developer without them
// gets a skip with the reason; CI sets JEV_REQUIRE_NODE_SMOKE=1 so that a missing tool fails the
// run instead of letting the Node checks pass by not running at all.
import { test } from "bun:test";

export const REQUIRE_NODE_VARIABLE = "JEV_REQUIRE_NODE_SMOKE";

export type NodeToolsGate =
  | { readonly run: true }
  | { readonly run: false; readonly fail: boolean; readonly missing: string };

export function nodeToolsGate(
  missing: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): NodeToolsGate {
  if (missing.length === 0) return { run: true };
  return {
    run: false,
    fail: environment[REQUIRE_NODE_VARIABLE] === "1",
    missing: missing.join(" and "),
  };
}

/**
 * The path of every named tool, or undefined when one is missing. A missing tool registers one
 * failing test under the flag and prints a skip notice without it; the caller skips its suite.
 */
export function nodeTools<const Name extends string>(
  names: readonly Name[],
  suite: string,
): Readonly<Record<Name, string>> | undefined {
  const paths = Object.fromEntries(names.map((name) => [name, Bun.which(name) ?? ""]));
  const gate = nodeToolsGate(
    names.filter((name) => paths[name] === ""),
    Bun.env,
  );
  if (gate.run) return paths as Record<Name, string>;
  const reason = `${suite} needs ${gate.missing} on PATH`;
  if (gate.fail) {
    test(`${reason} (${REQUIRE_NODE_VARIABLE}=1)`, () => {
      throw new Error(`${reason}, and ${REQUIRE_NODE_VARIABLE}=1 forbids skipping it`);
    });
  } else {
    console.warn(`Skipping ${suite}: it needs ${gate.missing} on PATH.`);
  }
  return undefined;
}
