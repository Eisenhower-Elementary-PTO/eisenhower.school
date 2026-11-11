// Lost & found similarity (invariant 33, migration 0046): the score, the
// vector round-trip, and the fingerprint's life — what a return leaves behind,
// what a hand delete removes, what the sweep keeps. The scoring is pure; the
// plumbing runs against a small in-memory D1 that evaluates the statements this
// module issues.

import { describe, expect, it } from "vitest";
import type { Env } from "../src/env.js";
import {
  COSINE_FLOOR,
  MIN_SIMILARITY,
  appearanceText,
  decodeVector,
  encodeVector,
  recordReturnOwner,
  repeatGroups,
  similarTo,
  similarity,
  writingWords,
  type Print,
} from "../src/lib/lostFoundSimilar.js";

const unit = (...xs: number[]): Float32Array => {
  const n = Math.hypot(...xs);
  return new Float32Array(xs.map((x) => x / n));
};

const bottle = (over: Partial<Print> = {}): Print => ({
  vector: unit(1, 0, 0),
  category: "Water bottle",
  colors: ["blue"],
  brand: "Hydro Flask",
  writing: [],
  ...over,
});

describe("vector text round-trip", () => {
  it("survives base64 float32 encoding", () => {
    const v = [0.25, -0.5, 0.125, 1];
    expect([...decodeVector(encodeVector(v))]).toEqual(v);
  });
});

describe("similarity", () => {
  it("scores an identical item at the top and says why", () => {
    const a = bottle({ writing: ["milo"] });
    const r = similarity(a, a);
    expect(r.score).toBeCloseTo(1, 5);
    expect(r.reasons).toEqual(["look", "color", "brand", "writing"]);
  });

  it("never matches across categories, however alike the words", () => {
    expect(similarity(bottle(), bottle({ category: "Jacket" })).score).toBe(0);
  });

  it("treats a raw cosine at the noise floor as no look signal", () => {
    // Orthogonal-ish vectors: cosine below the floor contributes nothing.
    const far = bottle({ vector: unit(0, 1, 0), colors: [], brand: "" });
    const near = bottle({ colors: [], brand: "" });
    expect(similarity(near, far).score).toBe(0);
    expect(COSINE_FLOOR).toBeGreaterThan(0.5);
  });

  it("recognises the same name on the writing even when the look differs", () => {
    const a = bottle({ vector: unit(1, 0, 0), colors: ["blue"], writing: ["milo"] });
    const b = bottle({ vector: unit(0, 1, 0), colors: ["green"], brand: "Stanley", writing: ["milo"] });
    const r = similarity(a, b);
    expect(r.reasons).toEqual(["writing"]);
    expect(r.score).toBeLessThan(MIN_SIMILARITY); // writing alone is a hint, not a match
  });

  it("does not let an initial match every other initial", () => {
    expect(writingWords("MILO R.")).toEqual(["milo"]);
    expect(writingWords("R.")).toEqual([]);
  });
});

describe("appearance text", () => {
  it("is built without writing (the public vector's rule)", () => {
    const text = appearanceText({
      title: "Blue bottle",
      category: "Water bottle",
      colors: '["blue"]',
      brand: "Hydro Flask",
      material: "metal",
      description: "A blue bottle.",
      tags: '["flask"]',
      // @ts-expect-error — writing is not part of the input type at all
      visible_text: "MILO R.",
    });
    expect(text).not.toMatch(/milo/i);
  });
});

// ── plumbing, against a tiny in-memory D1 ───────────────────────────────────

interface Fp {
  item_id: string;
  embedding: string;
  category: string;
  colors: string;
  brand: string;
  writing: string;
  title: string;
  found_at: string;
  returned_at: string | null;
  returned_to: string;
  returned_room: string;
}

function fakeEnv(fps: Fp[], liveItems: Record<string, { status: string; thumb_key: string }> = {}): { env: Env; fps: Fp[] } {
  const rowOf = (f: Fp) => ({
    ...f,
    live_status: liveItems[f.item_id]?.status ?? null,
    thumb_key: liveItems[f.item_id]?.thumb_key ?? null,
  });
  const db = {
    prepare(sql: string) {
      return {
        bind: (...b: unknown[]) => ({
          async first() {
            if (sql.includes("WHERE f.item_id = ?")) {
              const f = fps.find((x) => x.item_id === b[0]);
              return f ? rowOf(f) : null;
            }
            return null;
          },
          async all() {
            if (sql.includes("WHERE f.category = ?")) {
              return { results: fps.filter((x) => x.category === b[0] && x.item_id !== b[1]).map(rowOf) };
            }
            return { results: fps.map(rowOf) };
          },
          async run() {
            if (sql.startsWith("UPDATE lf_fingerprint SET returned_to")) {
              const f = fps.find((x) => x.item_id === b[3]);
              if (f) {
                f.returned_to = b[0] as string;
                f.returned_room = b[1] as string;
              }
            }
            return { meta: { changes: 1 } };
          },
        }),
      };
    },
  };
  return { env: { DB: db } as unknown as Env, fps };
}

const fp = (id: string, over: Partial<Fp> = {}): Fp => ({
  item_id: id,
  embedding: encodeVector([1, 0, 0]),
  category: "Water bottle",
  colors: '["blue"]',
  brand: "Hydro Flask",
  writing: "",
  title: `Bottle ${id}`,
  found_at: "2026-10-01T15:00:00.000Z",
  returned_at: null,
  returned_to: "",
  returned_room: "",
  ...over,
});

describe("similarTo", () => {
  it("finds a swept item by its fingerprint and says who it went home to", async () => {
    const { env } = fakeEnv([
      fp("NEW"),
      fp("OLD", { returned_at: "2026-09-01T00:00:00.000Z", returned_to: "Milo R.", returned_room: "Gr 2 - Shrestha" }),
      fp("COAT", { category: "Jacket" }),
    ]);
    const out = await similarTo(env, "NEW", "https://api.test");
    expect(out.map((o) => o.title)).toEqual(["Bottle OLD"]);
    expect(out[0]).toMatchObject({ itemId: null, here: false, thumbUrl: null, returnedTo: "Milo R.", returnedRoom: "Gr 2 - Shrestha" });
  });

  it("links the photo only while the item still exists, through the STAFF media route", async () => {
    const { env } = fakeEnv([fp("NEW"), fp("HERE")], { HERE: { status: "found", thumb_key: "HERE-thumb.jpg" } });
    const [r] = await similarTo(env, "NEW", "https://api.test");
    expect(r).toMatchObject({ itemId: "HERE", here: true, thumbUrl: "https://api.test/lostfound/media/HERE-thumb.jpg" });
  });

  it("excludes the item itself and answers [] for an item with no fingerprint", async () => {
    const { env } = fakeEnv([fp("A"), fp("B")]);
    expect((await similarTo(env, "A", "o")).map((o) => o.title)).toEqual(["Bottle B"]);
    expect(await similarTo(env, "NOPE", "o")).toEqual([]);
  });

  it("drops weak candidates", async () => {
    const { env } = fakeEnv([fp("NEW"), fp("DIFF", { embedding: encodeVector([0, 1, 0]), colors: '["red"]', brand: "Stanley" })]);
    expect(await similarTo(env, "NEW", "o")).toEqual([]);
  });
});

describe("repeatGroups", () => {
  it("clusters the same bottle across months, lists who got it, and leaves loners out", async () => {
    const { env } = fakeEnv([
      fp("3", { found_at: "2026-11-01T00:00:00.000Z" }),
      fp("2", { found_at: "2026-10-01T00:00:00.000Z", returned_to: "Milo R." }),
      fp("1", { found_at: "2026-09-01T00:00:00.000Z", returned_to: "Milo R." }),
      fp("J", { category: "Jacket", embedding: encodeVector([0, 0, 1]) }),
    ]);
    const groups = await repeatGroups(env, "o");
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      count: 3,
      category: "Water bottle",
      firstFoundAt: "2026-09-01T00:00:00.000Z",
      lastFoundAt: "2026-11-01T00:00:00.000Z",
      returnedTo: ["Milo R."],
    });
  });
});

describe("recordReturnOwner", () => {
  it("prefers the child's name, falls back to the claimant, and never takes the contact", async () => {
    const { env, fps } = fakeEnv([fp("A"), fp("B")]);
    await recordReturnOwner(env, "A", { name: "Dana Parent", child_name: "Milo R.", teacher: "Shrestha" });
    await recordReturnOwner(env, "B", { name: "Dana Parent", child_name: "", teacher: "" });
    expect(fps.find((f) => f.item_id === "A")).toMatchObject({ returned_to: "Milo R.", returned_room: "Shrestha" });
    expect(fps.find((f) => f.item_id === "B")).toMatchObject({ returned_to: "Dana Parent", returned_room: "" });
  });
});
