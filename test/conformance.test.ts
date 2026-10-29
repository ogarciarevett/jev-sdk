// The shared golden vectors. jev-py-sdk holds the canonical copy in conformance/vectors; this suite
// fetches it, so a changed vector fails here until this SDK agrees with it again.
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { type JevDependencies, type JevJudgeRequest, JevUsageError, judge } from "../src/judge.ts";
import { type JevJsonValue, maskJevState, maskJevText } from "../src/mask.ts";

// A directory or URL prefix that holds judge.json and mask.json; set it to run against a local copy.
const SOURCE =
  process.env.JEV_VECTORS ??
  "https://raw.githubusercontent.com/ogarciarevett/jev-py-sdk/main/conformance/vectors";

async function vectors(name: string): Promise<any> {
  if (!/^https?:/.test(SOURCE)) return JSON.parse(await readFile(`${SOURCE}/${name}`, "utf8"));
  const response = await fetch(`${SOURCE}/${name}`);
  if (!response.ok) throw new Error(`fetching ${SOURCE}/${name}: HTTP ${response.status}`);
  return response.json();
}

const MASK = await vectors("mask.json");
const JUDGE = await vectors("judge.json");

// Real drift from the Python SDK, tracked until maskJevState catches up. test.failing passes only
// while the case still fails, so a fix here shows up at once and the list must shrink.
// Tracked in https://github.com/ogarciarevett/jev-sdk/issues/11.
const KNOWN_DRIFT = new Set(["credential-named fields", "credential-shaped field name"]);

describe("mask vectors", () => {
  for (const vector of MASK.text) {
    test(`text: ${vector.name}`, () => expect(maskJevText(vector.raw)).toBe(vector.masked));
  }
  for (const vector of MASK.state) {
    const run = KNOWN_DRIFT.has(vector.name) ? test.failing : test;
    run(`state: ${vector.name}`, () => expect(maskJevState(vector.raw)).toEqual(vector.masked));
  }
});

describe("judge vectors", () => {
  for (const vector of JUDGE.cases) {
    test(vector.name, async () => {
      const sent: RequestInit[] = [];
      let clock = 1_000;
      const reply = vector.reply;
      const dependencies: JevDependencies = {
        apiKey: vector.options.apiKey ?? JUDGE.apiKey,
        fetch: (_url, init) => {
          sent.push(init ?? {});
          clock += 12;
          return Promise.resolve(
            reply
              ? new Response(reply.body, { status: reply.status, headers: reply.headers })
              : new Response("{}", { status: 599 }),
          );
        },
        now: () => clock,
        sleep: (milliseconds) => {
          clock += milliseconds;
          return Promise.resolve();
        },
      };
      const request: JevJudgeRequest = {
        state: vector.state as JevJsonValue,
        questions: vector.questions,
        ...vector.options,
      };
      const expected = vector.expect;

      if (expected.usageError) {
        await expect(judge(request, dependencies)).rejects.toBeInstanceOf(JevUsageError);
        expect(sent).toHaveLength(expected.requests);
        return;
      }

      const result = await judge(request, dependencies);
      expect(sent).toHaveLength(expected.requests);
      if (expected.body !== undefined) expect(sent[0]?.body).toBe(expected.body);
      const headers = (sent[0]?.headers ?? {}) as Record<string, string>;
      for (const [name, value] of Object.entries(expected.headers ?? {})) {
        expect(headers[name]).toBe(value as string);
      }
      expect(result.model).toBe(expected.model);
      expect(JSON.parse(JSON.stringify(result.verdicts))).toStrictEqual(expected.verdicts);
    });
  }
});
