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

/** Where `nodeTools` looks tools up and how it reports a missing one; tests replace them. */
export type NodeToolsHooks = {
  readonly which: (name: string) => string | null;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly registerFailure: (name: string, body: () => void) => void;
  readonly warn: (message: string) => void;
};

const BUN_HOOKS: NodeToolsHooks = {
  which: (name) => Bun.which(name),
  environment: Bun.env,
  registerFailure: (name, body) => test(name, body),
  warn: (message) => console.warn(message),
};

/**
 * The path of every named tool, or undefined when one is missing. A missing tool registers one
 * failing test under the flag and prints a skip notice without it; the caller skips its suite.
 */
export function nodeTools<const Name extends string>(
  names: readonly Name[],
  suite: string,
  hooks: NodeToolsHooks = BUN_HOOKS,
): Readonly<Record<Name, string>> | undefined {
  const paths = Object.fromEntries(names.map((name) => [name, hooks.which(name) ?? ""]));
  const gate = nodeToolsGate(
    names.filter((name) => paths[name] === ""),
    hooks.environment,
  );
  if (gate.run) return paths as Record<Name, string>;
  const reason = `${suite} needs ${gate.missing} on PATH`;
  if (gate.fail) {
    hooks.registerFailure(`${reason} (${REQUIRE_NODE_VARIABLE}=1)`, () => {
      throw new Error(`${reason}, and ${REQUIRE_NODE_VARIABLE}=1 forbids skipping it`);
    });
  } else {
    hooks.warn(`Skipping ${suite}: it needs ${gate.missing} on PATH.`);
  }
  return undefined;
}
