// The newsletter AI assist (lib/newsletterAssist.ts, invariant 9's edges).
//
// BEHAVIOURAL where it matters, for invariant 22's reason. The model is faked
// at the `AI.run` seam and the budget's D1 fake evaluates the upsert's own
// bound limit, so a guard that stopped guarding fails on a VALUE — a block that
// moved when it shouldn't, a 21st call that went through — rather than passing
// a text scan. The properties pinned here:
//
//   · The model can only reword prose. Images, events blocks and rules are
//     never sent and never touched; structure is never the model's to change.
//   · What comes back can only be text, hardBreak and the four inline marks —
//     a javascript: "link" or an invented node has no way in, and the whole
//     document passes sanitizeNewsletterDoc again regardless.
//   · An unchanged block is the ORIGINAL nodes, not a round-trip of them.
//   · The daily budget is a hard cap, claimed atomically, refused quietly.

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { NewsletterNode } from "@sd/shared";
import type { AuthContext, Env, HonoEnv } from "../src/env.js";
import { newsletter } from "../src/routes/newsletter.js";
import { NEWSLETTER_EDITOR_GROUP_SETTING } from "../src/lib/newsletter.js";
import {
  DAILY_ASSIST_LIMIT,
  REDUCE_MAX_PERCENT,
  REDUCE_MIN_PERCENT,
  assistSuccinct,
  assistSuggestions,
  claimAssistBudget,
  clampReduce,
  collectTextSlots,
  inlineToMarkdown,
  markdownToInline,
  pickEmphasis,
  slotsTextLength,
  slotsToPrompt,
  succinctPrompt,
  suggestionsPrompt,
} from "../src/lib/newsletterAssist.js";

/** A draft in ALREADY-SANITIZED shape, so "untouched means byte-identical"
 *  can be asserted against the fixture itself: assistSuccinct re-sanitizes its
 *  output, and a fixture the sanitizer would normalize would false-positive. */
function fixtureDoc(): NewsletterNode {
  return {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Fall festival" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "We are very excited to announce that the " },
          { type: "text", text: "fall festival", marks: [{ type: "bold" }] },
          { type: "text", text: " will be happening on " },
          {
            type: "text",
            text: "October 20",
            marks: [{ type: "link", attrs: { href: "https://calendar.eisenhower.school/e/2026-10-20/fall-festival" } }],
          },
          { type: "text", text: "." },
        ],
      },
      { type: "image", attrs: { src: "https://api.example/x.png", alt: "" } },
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Bring a chair" }] }] },
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Bring snacks" }] }] },
        ],
      },
      {
        type: "eventsBlock",
        attrs: { blockId: "b1", calendarIds: [], lookaheadDays: 14, heading: null },
      },
      { type: "horizontalRule" },
      { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "Thank you!" }] }] },
    ],
  };
}

/** An AI binding that answers with the given JSON and records what it was run
 *  with, so the call's own bounds (JSON mode, token cap, thinking off) are
 *  observable values rather than trusted. */
function fakeAi(reply: unknown): { env: Env; calls: { model: string; input: Record<string, unknown> }[] } {
  const calls: { model: string; input: Record<string, unknown> }[] = [];
  const env = {
    AI: {
      run: async (model: string, input: unknown) => {
        calls.push({ model, input: input as Record<string, unknown> });
        return { response: JSON.stringify(reply) };
      },
    },
  } as unknown as Env;
  return { env, calls };
}

describe("collectTextSlots", () => {
  it("collects prose only, in document order — never an image, events block or rule", () => {
    const slots = collectTextSlots(fixtureDoc());
    expect(slots.map((s) => s.kind)).toEqual(["heading", "paragraph", "list item", "list item", "quote"]);
    // The prompt the model sees carries the same five and nothing else.
    const prompt = slotsToPrompt(slots);
    expect(prompt.split("\n")).toHaveLength(5);
    expect(prompt).not.toContain("image");
    expect(prompt).not.toContain("eventsBlock");
  });

  it("measures only prose, so an image-heavy issue isn't refused as too long", () => {
    const slots = collectTextSlots(fixtureDoc());
    expect(slotsTextLength(slots)).toBeGreaterThan(0);
    expect(slotsTextLength(collectTextSlots({ type: "doc", content: [] }))).toBe(0);
  });
});

describe("inline Markdown round trip", () => {
  it("keeps bold, italic, strike, links and hard breaks through a round trip", () => {
    const nodes: NewsletterNode[] = [
      { type: "text", text: "Plain " },
      { type: "text", text: "bold", marks: [{ type: "bold" }] },
      { type: "text", text: " and " },
      { type: "text", text: "italic", marks: [{ type: "italic" }] },
      { type: "hardBreak" },
      { type: "text", text: "gone", marks: [{ type: "strike" }] },
      { type: "text", text: " see " },
      { type: "text", text: "the site", marks: [{ type: "link", attrs: { href: "https://example.org/x" } }] },
    ];
    expect(markdownToInline(inlineToMarkdown(nodes))).toEqual(nodes);
  });

  it("emits nothing but text, hardBreak and the four marks — a javascript: url is just words", () => {
    const nodes = markdownToInline("click [here](javascript:alert(1)) or [there](https://ok.example)");
    const types = new Set(nodes.map((n) => n.type));
    expect([...types].every((t) => t === "text" || t === "hardBreak")).toBe(true);
    const markTypes = nodes.flatMap((n) => (n.marks ?? []).map((m) => m.type));
    expect(markTypes.every((t) => ["bold", "italic", "strike", "link"].includes(t))).toBe(true);
    // The javascript: form never parses as a link, so its text (url and all)
    // stays literal — and the write-time sanitizer would refuse it again anyway.
    expect(nodes.some((n) => (n.marks ?? []).some((m) => m.attrs?.href === "javascript:alert(1)"))).toBe(false);
    expect(nodes.some((n) => (n.marks ?? []).some((m) => m.attrs?.href === "https://ok.example"))).toBe(true);
  });
});

// ── The shrink target ─────────────────────────────────────────────────────────
//
// The composer measures how many pages the draft would print as and, over the
// goal, sends a percentage to cut. The server's half: clamp it, say it in the
// system prompt, and mark the longest blocks as the place to cut.

/** A draft with one long-winded paragraph among short ones, so "the longest
 *  block" is unambiguous. */
function longDoc(): { doc: NewsletterNode; longText: string } {
  const longText =
    "We are absolutely delighted and thrilled to share with each and every one of you " +
    "that after a great deal of planning, discussion and coordination among many wonderful " +
    "volunteers, the annual fall festival will once again be taking place this year on the " +
    "playground behind the school, and we truly hope to see as many families there as possible.";
  return {
    doc: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Fall festival" }] },
        { type: "paragraph", content: [{ type: "text", text: longText }] },
        { type: "paragraph", content: [{ type: "text", text: "Doors open at 5 PM." }] },
      ],
    },
    longText,
  };
}

describe("the shrink target", () => {
  it("clampReduce holds the bounds the prompt is willing to state", () => {
    expect(clampReduce(0)).toBe(REDUCE_MIN_PERCENT);
    expect(clampReduce(33.4)).toBe(33);
    expect(clampReduce(400)).toBe(REDUCE_MAX_PERCENT);
  });

  it("succinctPrompt names the percentage only when a target was asked for", () => {
    expect(succinctPrompt()).not.toContain("%");
    expect(succinctPrompt(30)).toContain("about 30%");
    // Both forms still demand the same JSON answer.
    expect(succinctPrompt(30)).toContain('{"blocks":');
    expect(succinctPrompt()).toContain('{"blocks":');
  });

  it("pickEmphasis marks the longest block and leaves short ones alone", () => {
    const slots = collectTextSlots(longDoc().doc);
    const marked = pickEmphasis(slots, 30);
    expect(marked.has(1)).toBe(true); // the long paragraph
    expect(marked.has(0)).toBe(false); // a short heading has nothing to give
    expect(marked.has(2)).toBe(false);
    // The prompt line carries the annotation, on that block only.
    const prompt = slotsToPrompt(slots, marked);
    const lines = prompt.split("\n");
    expect(lines[1]).toContain("(too long — cut this one hardest)");
    expect(lines[0]).not.toContain("too long");
    expect(lines[2]).not.toContain("too long");
  });

  it("assistSuccinct with a target sends the shrink prompt and the annotations", async () => {
    const { env, calls } = fakeAi({ blocks: [] });
    await assistSuccinct(env, longDoc().doc, 30);
    const messages = calls[0]!.input.messages as { role: string; content: string }[];
    expect(messages[0]!.content).toContain("about 30%");
    expect(messages[1]!.content).toContain("(too long — cut this one hardest)");
  });

  it("assistSuccinct without a target sends the prompt it always has", async () => {
    const { env, calls } = fakeAi({ blocks: [] });
    await assistSuccinct(env, longDoc().doc);
    const messages = calls[0]!.input.messages as { role: string; content: string }[];
    expect(messages[0]!.content).not.toContain("%");
    expect(messages[1]!.content).not.toContain("too long");
  });
});

describe("assistSuccinct", () => {
  it("rewrites the named block, keeps every other node byte for byte, and reports the change", async () => {
    const { env, calls } = fakeAi({
      blocks: [{ i: 1, text: "The **fall festival** is [October 20](https://calendar.eisenhower.school/e/2026-10-20/fall-festival)." }],
    });
    const doc = fixtureDoc();
    const { content, changes } = await assistSuccinct(env, doc);
    expect(content).not.toBeNull();
    // The one change, before and after, for the review sheet.
    expect(changes).toHaveLength(1);
    expect(changes[0]!.before).toContain("very excited to announce");
    expect(changes[0]!.after).toContain("[October 20]");
    // The paragraph was rebuilt with its bold and its link intact…
    const para = content!.content![1]!;
    expect(para.content!.some((n) => (n.marks ?? []).some((m) => m.type === "bold"))).toBe(true);
    expect(
      para.content!.some((n) =>
        (n.marks ?? []).some(
          (m) => m.type === "link" && m.attrs?.href === "https://calendar.eisenhower.school/e/2026-10-20/fall-festival",
        ),
      ),
    ).toBe(true);
    // …and nothing else moved: same shape, same image, same events block.
    const untouched = (i: number) => expect(content!.content![i]).toEqual(fixtureDoc().content![i]);
    [0, 2, 3, 4, 5, 6].forEach(untouched);
    // The call itself is bounded: JSON mode, a token cap, thinking off.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.input.response_format).toEqual({ type: "json_object" });
    expect(calls[0]!.input.max_tokens).toBeLessThanOrEqual(3000);
    expect(calls[0]!.input.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it("ignores an out-of-range index, an emptied block and an unchanged echo", async () => {
    const { env } = fakeAi({
      blocks: [
        { i: 99, text: "An invented block" },
        { i: 0, text: "" },
        { i: 1, text: inlineToMarkdown(fixtureDoc().content![1]!.content) },
      ],
    });
    const { content, changes } = await assistSuccinct(env, fixtureDoc());
    // Nothing the model was allowed to do survived, so there is nothing to apply.
    expect(content).toBeNull();
    expect(changes).toEqual([]);
  });

  it("answers null content when the model changes nothing", async () => {
    const { env } = fakeAi({ blocks: [] });
    const { content, changes } = await assistSuccinct(env, fixtureDoc());
    expect(content).toBeNull();
    expect(changes).toEqual([]);
  });
});

describe("suggestionsPrompt", () => {
  it("carries the admins' standing guidance only when there is any, keeping the answer format last", () => {
    expect(suggestionsPrompt()).not.toContain("standing editorial guidance");
    expect(suggestionsPrompt("")).toBe(suggestionsPrompt());
    expect(suggestionsPrompt("   ")).toBe(suggestionsPrompt());
    const withGuidance = suggestionsPrompt("Always flag missing RSVP links.");
    expect(withGuidance).toContain("Always flag missing RSVP links.");
    // The output contract stays ours and stays last, whatever the guidance says.
    expect(withGuidance.trimEnd().endsWith('{"suggestions":["<suggestion>", "..."]}')).toBe(true);
    expect(suggestionsPrompt()).toContain('{"suggestions":');
  });
});

describe("assistSuggestions", () => {
  it("puts the guidance into the system prompt the model is actually run with", async () => {
    const { env, calls } = fakeAi({ suggestions: ["ok"] });
    await assistSuggestions(env, fixtureDoc(), "Always flag missing RSVP links.");
    const messages = calls[0]!.input.messages as { role: string; content: string }[];
    expect(messages[0]!.role).toBe("system");
    expect(messages[0]!.content).toContain("Always flag missing RSVP links.");
  });

  it("returns trimmed strings and nothing else, capped in count and length", async () => {
    const { env } = fakeAi({
      suggestions: [
        "  Lead with the date. ",
        42,
        null,
        "x".repeat(2000),
        ...Array.from({ length: 10 }, (_, i) => `Suggestion ${i}`),
      ],
    });
    const out = await assistSuggestions(env, fixtureDoc());
    expect(out.length).toBeLessThanOrEqual(8);
    expect(out[0]).toBe("Lead with the date.");
    expect(out.every((s) => typeof s === "string" && s.length <= 500)).toBe(true);
  });
});

describe("claimAssistBudget", () => {
  /** Evaluates the upsert the way D1 would — honouring the statement's own
   *  bound limit, not its text — so a claim that stopped enforcing the cap
   *  fails here on the 21st call going through. */
  function budgetEnv() {
    const store = new Map<string, number>();
    const env = {
      DB: {
        prepare(sql: string) {
          expect(sql).toContain("ON CONFLICT (day) DO UPDATE");
          let binds: unknown[] = [];
          return {
            bind(...args: unknown[]) {
              binds = args;
              return this;
            },
            async run() {
              const day = String(binds[0]);
              const limit = Number(binds[1]);
              const current = store.get(day);
              if (current === undefined) {
                store.set(day, 1);
                return { meta: { changes: 1 } };
              }
              if (current < limit) {
                store.set(day, current + 1);
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            },
          };
        },
      },
    } as unknown as Env;
    return { env, store };
  }

  it("admits exactly the daily limit, then refuses — and a new day starts fresh", async () => {
    const { env } = budgetEnv();
    for (let i = 0; i < DAILY_ASSIST_LIMIT; i++) {
      expect(await claimAssistBudget(env, "2026-10-11")).toBe(true);
    }
    expect(await claimAssistBudget(env, "2026-10-11")).toBe(false);
    expect(await claimAssistBudget(env, "2026-10-12")).toBe(true);
  });
});

// ── The route ────────────────────────────────────────────────────────────────
//
// POST /newsletter/issues/:id/assist, end to end over a fake D1 that answers
// the editors gate, the issue row and the budget upsert — the gate itself is
// pinned by test/newsletterAccess.test.ts; this pins the route's own refusals
// and that a refusal for budget says when to come back.

const GROUP = "01GRP_EDITORS";

function editorAuth(): AuthContext {
  return {
    userId: "01U_EDITOR",
    realUserId: "01U_EDITOR",
    email: "editor@eisenhower.edu",
    isSystemAdmin: false,
    sessionId: "01SESSION",
    activePersonId: null,
    isMasquerading: false,
    isApproved: true,
  };
}

function routeApp(env: Env): { post: (body: unknown) => Response | Promise<Response> } {
  const app = new Hono<HonoEnv>();
  app.use("*", async (c, next) => {
    c.set("audit", []);
    c.set("auth", editorAuth());
    await next();
  });
  app.route("/newsletter", newsletter);
  return {
    post: (body: unknown) =>
      app.request(
        "/newsletter/issues/01ISSUE/assist",
        { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } },
        env,
      ),
  };
}

function routeEnv(opts: {
  ai?: unknown;
  status?: string;
  doc?: NewsletterNode;
  budgetSpent?: number;
  /** Stored newsletter settings blob (the `newsletter_settings` key), when a
   *  test wants one to exist — absent, the route runs on the defaults. */
  storedSettings?: unknown;
}): Env {
  const budget = new Map<string, number>();
  return {
    SCHOOL_NAME: "Eisenhower",
    AI: opts.ai,
    DB: {
      prepare(sql: string) {
        let binds: unknown[] = [];
        const stmt = {
          bind(...args: unknown[]) {
            binds = args;
            return stmt;
          },
          async first() {
            if (sql.includes("FROM setting")) {
              if (binds[0] === NEWSLETTER_EDITOR_GROUP_SETTING) return { value: GROUP };
              if (binds[0] === "newsletter_settings" && opts.storedSettings !== undefined) {
                return { value: JSON.stringify(opts.storedSettings) };
              }
              return null;
            }
            if (sql.includes("FROM grp")) return { id: GROUP, name: "Newsletter committee" };
            if (sql.includes("FROM membership m")) return { ok: 1 };
            if (sql.includes("FROM newsletter_issue")) {
              return {
                id: "01ISSUE",
                status: opts.status ?? "draft",
                content_json: JSON.stringify(opts.doc ?? fixtureDoc()),
              };
            }
            throw new Error(`unexpected first(): ${sql}`);
          },
          async run() {
            if (sql.includes("INSERT INTO ai_budget")) {
              const day = String(binds[0]);
              const limit = Number(binds[1]);
              const current = budget.get(day) ?? opts.budgetSpent ?? 0;
              if (current < limit) {
                budget.set(day, current + 1);
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            }
            throw new Error(`unexpected run(): ${sql}`);
          },
        };
        return stmt;
      },
    },
  } as unknown as Env;
}

describe("POST /newsletter/issues/:id/assist", () => {
  const suggestionsAi = {
    run: async () => ({ response: JSON.stringify({ suggestions: ["Lead with the date."] }) }),
  };

  it("answers suggestions for an editor on a draft", async () => {
    const res = await routeApp(routeEnv({ ai: suggestionsAi })).post({ mode: "suggestions" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { suggestions: string[]; content: unknown } };
    expect(body.result.suggestions).toEqual(["Lead with the date."]);
    expect(body.result.content).toBeNull();
  });

  it("rides the stored suggestions guidance into the model's system prompt", async () => {
    const calls: { input: Record<string, unknown> }[] = [];
    const ai = {
      run: async (_model: string, input: unknown) => {
        calls.push({ input: input as Record<string, unknown> });
        return { response: JSON.stringify({ suggestions: ["ok"] }) };
      },
    };
    const res = await routeApp(
      routeEnv({ ai, storedSettings: { suggestionsGuidance: "We always lead with volunteer asks." } }),
    ).post({ mode: "suggestions" });
    expect(res.status).toBe(200);
    const messages = calls[0]!.input.messages as { role: string; content: string }[];
    expect(messages[0]!.content).toContain("We always lead with volunteer asks.");
    // The succinct pass is untouched by it — the guidance speaks to the review,
    // not to the rewrite.
    calls.length = 0;
    const res2 = await routeApp(
      routeEnv({ ai, storedSettings: { suggestionsGuidance: "We always lead with volunteer asks." } }),
    ).post({ mode: "succinct" });
    expect(res2.status).toBe(200);
    const messages2 = calls[0]!.input.messages as { role: string; content: string }[];
    expect(messages2[0]!.content).not.toContain("We always lead with volunteer asks.");
  });

  it("refuses an unknown mode before anything is spent", async () => {
    const res = await routeApp(routeEnv({ ai: suggestionsAi })).post({ mode: "rewrite-everything" });
    expect(res.status).toBe(400);
  });

  it("refuses a reduce that isn't a number before anything is spent", async () => {
    const res = await routeApp(routeEnv({ ai: suggestionsAi })).post({ mode: "succinct", reduce: "lots" });
    expect(res.status).toBe(400);
  });

  it("clamps an outlandish reduce and says the clamped figure to the model", async () => {
    const calls: { input: Record<string, unknown> }[] = [];
    const ai = {
      run: async (_model: string, input: unknown) => {
        calls.push({ input: input as Record<string, unknown> });
        return { response: JSON.stringify({ blocks: [] }) };
      },
    };
    const res = await routeApp(routeEnv({ ai })).post({ mode: "succinct", reduce: 400 });
    expect(res.status).toBe(200);
    const messages = calls[0]!.input.messages as { role: string; content: string }[];
    expect(messages[0]!.content).toContain(`about ${REDUCE_MAX_PERCENT}%`);
  });

  it("is 503 with no AI binding — absent means off, like every optional binding", async () => {
    const res = await routeApp(routeEnv({})).post({ mode: "suggestions" });
    expect(res.status).toBe(503);
  });

  it("is 409 on a sent issue, like every other write-shaped act on one", async () => {
    const res = await routeApp(routeEnv({ ai: suggestionsAi, status: "sent" })).post({ mode: "suggestions" });
    expect(res.status).toBe(409);
  });

  it("is 400 on an empty draft rather than spending a model call on nothing", async () => {
    const res = await routeApp(
      routeEnv({ ai: suggestionsAi, doc: { type: "doc", content: [] } }),
    ).post({ mode: "suggestions" });
    expect(res.status).toBe(400);
  });

  it("is 429 once the day's budget is spent, and says when it resets", async () => {
    const res = await routeApp(
      routeEnv({ ai: suggestionsAi, budgetSpent: DAILY_ASSIST_LIMIT }),
    ).post({ mode: "suggestions" });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("is 502, not a 500, when the model derails — the budget stays spent", async () => {
    const failing = { run: async () => ({ response: "not json at all" }) };
    const res = await routeApp(routeEnv({ ai: failing })).post({ mode: "suggestions" });
    expect(res.status).toBe(502);
  });
});
