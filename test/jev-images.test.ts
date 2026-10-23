import { describe, expect, test } from "bun:test";
import { jevDecisionLine } from "../src/decision-log.ts";

import {
  JEV_BOX_MODEL,
  JEV_MODEL,
  type JevDependencies,
  type JevJudgeRequest,
  JevUsageError,
  judge,
  maskedJevRequest,
} from "../src/judge.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const PHOTO = "3f0c9a52-photo";
const EDGES = { top: 0.25, bottom: 0.82, left: 0.44, right: 0.84 };
const BOX: JevJudgeRequest = {
  state: { photo: PHOTO },
  questions: { mug: { type: "box", instructions: "the coffee mug in `photo`" } },
  images: { [PHOTO]: PNG },
  model: JEV_BOX_MODEL,
};

function capture(answers: unknown) {
  const calls: RequestInit[] = [];
  const dependencies: JevDependencies = {
    apiKey: ["fixture", "key", "value", "0003"].join("-"),
    fetch: (_url, init) => {
      calls.push(init ?? {});
      const body = JSON.stringify({ model: "jev-1.14.0", answers });
      return Promise.resolve(new Response(body, { status: 200 }));
    },
    now: () => 1_000,
    sleep: () => Promise.resolve(),
  };
  const body = (index = 0) => JSON.parse(String(calls[index]?.body));
  const headers = (index = 0) => (calls[index]?.headers ?? {}) as Record<string, string>;
  return { calls, dependencies, body, headers };
}

describe("box questions", () => {
  test("a box is decided with its edges and sends the images header", async () => {
    const sent = capture({ mug: { type: "box", box: EDGES, confidence: 0.92 } });
    const verdict = (await judge(BOX, sent.dependencies)).verdicts.mug;
    expect(verdict).toEqual({
      type: "box",
      verdict: "box",
      value: 0.92,
      valueKind: "confidence",
      threshold: 0.8,
      leaning: "box",
      box: EDGES,
    });
    expect(sent.headers()["typesafe-danger-zone-images"]).toBe("true");
    expect(sent.headers()["typesafe-danger-zone-long-context"]).toBeUndefined();
    expect(Object.keys(sent.body())).toEqual(["state", "model", "questions", "assets"]);
    expect(sent.body().model).toBe("jev-1.14.0");
    expect(sent.body().assets).toEqual({
      [PHOTO]: { type: "image", format: "png", data_base64: Buffer.from(PNG).toString("base64") },
    });
  });

  test("a box below the bar is undecided but keeps its edges", async () => {
    const sent = capture({ mug: { type: "box", box: EDGES, confidence: 0.4 } });
    const verdict = (await judge(BOX, sent.dependencies)).verdicts.mug;
    expect(verdict?.reason).toBe("below_threshold");
    expect(verdict?.box).toEqual(EDGES);
  });

  for (const edges of [
    { top: 0.5, bottom: 0.4, left: 0.1, right: 0.2 },
    { top: 0.1, bottom: 0.4, left: 0.3, right: 0.3 },
    { top: 0.1, bottom: 1.4, left: 0.1, right: 0.2 },
    { top: 0.1, bottom: 0.4, left: 0.1 },
    null,
  ]) {
    test(`a malformed box is a schema mismatch: ${JSON.stringify(edges)}`, async () => {
      const sent = capture({ mug: { type: "box", box: edges, confidence: 0.95 } });
      const verdict = (await judge(BOX, sent.dependencies)).verdicts.mug;
      expect(verdict?.reason).toBe("response_schema_mismatch");
      expect(verdict?.box).toBeUndefined();
    });
  }
});

describe("images and the danger zone headers", () => {
  test("an image in a text question sends a jpeg asset and the header", async () => {
    const sent = capture({ same: { type: "noul", noul: 0.97 } });
    const result = await judge(
      {
        state: { photo: PHOTO },
        questions: {
          same: { type: "noul", instructions: "Is `photo` the same dog as this: 77b0d4a1-poster?" },
        },
        images: { [PHOTO]: PNG, "77b0d4a1-poster": JPEG },
      },
      sent.dependencies,
    );
    expect(result.verdicts.same?.verdict).toBe("yes");
    expect(sent.body().model).toBe(JEV_MODEL);
    expect(sent.body().assets["77b0d4a1-poster"].format).toBe("jpg");
    expect(sent.headers()["typesafe-danger-zone-images"]).toBe("true");
  });

  test("a text-only request is unchanged", async () => {
    const sent = capture({ q: { type: "noul", noul: 0.9 } });
    await judge(
      { state: "state", questions: { q: { type: "noul", instructions: "Is it?" } } },
      sent.dependencies,
    );
    expect(Object.keys(sent.body())).toEqual(["state", "model", "questions"]);
    expect(sent.headers()["typesafe-danger-zone-images"]).toBeUndefined();
  });

  test("long context sends its header and raises the state budget", async () => {
    const request: JevJudgeRequest = {
      state: "word ".repeat(30_000),
      questions: { q: { type: "noul", instructions: "Is it?" } },
    };
    expect(() => maskedJevRequest(request)).toThrow("larger than 96000");
    const sent = capture({ q: { type: "noul", noul: 0.9 } });
    await judge({ ...request, longContext: true }, sent.dependencies);
    expect(sent.headers()["typesafe-danger-zone-long-context"]).toBe("true");
  });

  const mistakes: [string, Partial<JevJudgeRequest>, string][] = [
    ["a gif", { images: { [PHOTO]: new TextEncoder().encode("GIF89a") } }, "only PNG and JPEG"],
    ["an unused reference", { images: { [PHOTO]: PNG, "unused-ref": PNG } }, "does not appear"],
    ["an empty reference", { images: { " ": PNG } }, "non-empty"],
    [
      "box criteria",
      { questions: { mug: { type: "box", instructions: "the mug", criteria: ["a", "b"] } } },
      "no criteria",
    ],
    ["an empty model", { model: " " }, "model"],
    [
      "a reference the masking rewrites",
      { state: { photo: "user@example.com" }, images: { "user@example.com": PNG } },
      "does not appear",
    ],
  ];
  for (const [name, change, message] of mistakes) {
    test(`a caller mistake raises: ${name}`, () => {
      expect(() => maskedJevRequest({ ...BOX, ...change })).toThrow(JevUsageError);
      expect(() => maskedJevRequest({ ...BOX, ...change })).toThrow(message);
    });
  }

  test("the decision line never holds the image bytes", async () => {
    const sent = capture({ mug: { type: "box", box: EDGES, confidence: 0.92 } });
    const result = await judge(BOX, sent.dependencies);
    const line = jevDecisionLine(BOX, result, "2026-10-23T00:00:00.000Z");
    expect(line).not.toContain(Buffer.from(PNG).toString("base64"));
    expect(JSON.parse(line).verdicts.mug.box).toEqual(EDGES);
  });
});
