// The archive readership counters (migration 0042).
//
// Three properties worth defending, in order of what going wrong would cost:
//
//   1. The beacon endpoint is not an oracle: a draft slug and a published slug
//      answer byte-identically, and only the published one writes (invariant
//      10's SQL gate, restated for the POST).
//   2. The client's word bounds nothing: `lang` is bucketed to LOCALES+"other",
//      a click is reduced to a parsed hostname (translate-proxy hosts decoded
//      back to the real one), and the distinct destinations one issue can mint
//      per day are capped — the tables can't be grown by a script.
//   3. `day` is the SCHOOL'S calendar date, not UTC's — pinned at an instant
//      where the two disagree.
//
// Driven through the real routers over a small in-memory D1 stand-in, like
// newsletterSubscribe.test.ts: what matters is which statement runs on which
// request, and a fixed-row fake would assert nothing about that.

import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newsletterPublic } from "../src/routes/newsletterPublic.js";
import { newsletter } from "../src/routes/newsletter.js";
import { destBucket, langBucket, newsletterMetrics } from "../src/lib/newsletterMetrics.js";
import type { AuthContext, HonoEnv } from "../src/env.js";

// 03:00 UTC on Nov 6 is 9 PM on Nov 5 in Chicago — the one kind of instant
// that catches a UTC day leaking into the `day` column.
const NOW = new Date("2026-11-06T03:00:00Z");
const SCHOOL_DAY = "2026-11-05";

interface IssueRow {
  id: string;
  slug: string;
  title: string;
  status: string;
  published_at: string | null;
  sent_at: string | null;
}

function fakeDb() {
  const store = {
    issues: [] as IssueRow[],
    /** key `${issue}|${day}|${lang}` → views */
    views: new Map<string, number>(),
    /** key `${issue}|${day}|${dest}` → clicks */
    clicks: new Map<string, number>(),
    log: [] as string[],
  };

  const deletableGuard = (id: string) => {
    const issue = store.issues.find((i) => i.id === id);
    return !!issue && issue.status === "draft" && issue.published_at === null;
  };

  const exec = (sql: string, args: unknown[]): { results: unknown[]; meta: { changes: number } } => {
    store.log.push(sql);

    if (sql.includes("SELECT id FROM newsletter_issue WHERE slug")) {
      const row = store.issues.find((i) => i.slug === args[0] && i.published_at !== null);
      return { results: row ? [{ id: row.id }] : [], meta: { changes: 0 } };
    }
    if (sql.includes("UPDATE newsletter_issue_click SET clicks")) {
      const key = args.join("|");
      if (!store.clicks.has(key)) return { results: [], meta: { changes: 0 } };
      store.clicks.set(key, store.clicks.get(key)! + 1);
      return { results: [], meta: { changes: 1 } };
    }
    if (sql.includes("COUNT(*) AS n FROM newsletter_issue_click")) {
      const prefix = `${String(args[0])}|${String(args[1])}|`;
      const n = [...store.clicks.keys()].filter((k) => k.startsWith(prefix)).length;
      return { results: [{ n }], meta: { changes: 0 } };
    }
    if (sql.includes("INSERT INTO newsletter_issue_click")) {
      const key = args.join("|");
      store.clicks.set(key, (store.clicks.get(key) ?? 0) + 1);
      return { results: [], meta: { changes: 1 } };
    }
    if (sql.includes("INSERT INTO newsletter_issue_view")) {
      const key = args.join("|");
      store.views.set(key, (store.views.get(key) ?? 0) + 1);
      return { results: [], meta: { changes: 1 } };
    }

    // The admin read (newsletterMetrics), four statements in one batch.
    if (sql.includes("FROM newsletter_issue") && sql.includes("published_at IS NOT NULL") && sql.includes("ORDER BY published_at DESC")) {
      return {
        results: store.issues
          .filter((i) => i.published_at !== null)
          .map(({ id, slug, title, published_at, sent_at }) => ({ id, slug, title, published_at, sent_at })),
        meta: { changes: 0 },
      };
    }
    if (sql.includes("SELECT issue_id, lang, SUM(views)")) {
      return {
        results: [...store.views.entries()].map(([key, views]) => {
          const [issue_id, , lang] = key.split("|");
          return { issue_id, lang, views };
        }),
        meta: { changes: 0 },
      };
    }
    if (sql.includes("SELECT day, SUM(views)")) {
      const since = String(args[0]);
      const byDay = new Map<string, number>();
      for (const [key, views] of store.views) {
        const day = key.split("|")[1]!;
        if (day >= since) byDay.set(day, (byDay.get(day) ?? 0) + views);
      }
      return {
        results: [...byDay.entries()].sort().map(([day, views]) => ({ day, views })),
        meta: { changes: 0 },
      };
    }
    if (sql.includes("SELECT dest, SUM(clicks)")) {
      const byDest = new Map<string, number>();
      for (const [key, clicks] of store.clicks) {
        const dest = key.split("|")[2]!;
        byDest.set(dest, (byDest.get(dest) ?? 0) + clicks);
      }
      return {
        results: [...byDest.entries()].map(([dest, clicks]) => ({ dest, clicks })),
        meta: { changes: 0 },
      };
    }

    // The drafts-only delete and its counter cleanup.
    if (sql.includes("SELECT status, published_at FROM newsletter_issue")) {
      const row = store.issues.find((i) => i.id === args[0]);
      return {
        results: row ? [{ status: row.status, published_at: row.published_at }] : [],
        meta: { changes: 0 },
      };
    }
    if (sql.includes("DELETE FROM newsletter_issue_view")) {
      const id = String(args[0]);
      let changes = 0;
      if (deletableGuard(id)) {
        for (const key of [...store.views.keys()]) {
          if (key.startsWith(`${id}|`)) {
            store.views.delete(key);
            changes++;
          }
        }
      }
      return { results: [], meta: { changes } };
    }
    if (sql.includes("DELETE FROM newsletter_issue_click")) {
      const id = String(args[0]);
      let changes = 0;
      if (deletableGuard(id)) {
        for (const key of [...store.clicks.keys()]) {
          if (key.startsWith(`${id}|`)) {
            store.clicks.delete(key);
            changes++;
          }
        }
      }
      return { results: [], meta: { changes } };
    }
    if (sql.includes("DELETE FROM newsletter_issue WHERE id")) {
      const id = String(args[0]);
      if (!deletableGuard(id)) return { results: [], meta: { changes: 0 } };
      store.issues = store.issues.filter((i) => i.id !== id);
      return { results: [], meta: { changes: 1 } };
    }

    throw new Error(`fakeDb: unhandled statement: ${sql}`);
  };

  const prepare = (sql: string) => {
    let binds: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        binds = args;
        return stmt;
      },
      async first() {
        return (exec(sql, binds).results[0] as Record<string, unknown>) ?? null;
      },
      async all() {
        return { results: exec(sql, binds).results };
      },
      async run() {
        return { meta: exec(sql, binds).meta };
      },
      /** For DB.batch below. */
      _exec() {
        const r = exec(sql, binds);
        return { results: r.results, meta: r.meta };
      },
    };
    return stmt;
  };

  const db = {
    prepare,
    async batch(stmts: ReturnType<typeof prepare>[]) {
      return stmts.map((s) => s._exec());
    },
  };

  return { db, store };
}

function env(db: unknown): HonoEnv["Bindings"] {
  return { SCHOOL_TIMEZONE: "America/Chicago", DB: db } as HonoEnv["Bindings"];
}

function publicApp(): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();
  app.route("/newsletter-public", newsletterPublic);
  return app;
}

function adminApp(auth: AuthContext): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();
  app.use("*", async (c, next) => {
    c.set("audit", []);
    c.set("auth", auth);
    await next();
  });
  app.route("/newsletter", newsletter);
  return app;
}

const admin: AuthContext = {
  userId: "01U_ADMIN",
  realUserId: "01U_ADMIN",
  email: "admin@eisenhower.edu",
  isSystemAdmin: true,
  sessionId: "01SESSION",
  activePersonId: null,
  isMasquerading: false,
  isApproved: true,
};

const PUBLISHED: IssueRow = {
  id: "01ISSUE_PUB",
  slug: "2026-11-05-november",
  title: "November",
  status: "sent",
  published_at: "2026-11-05T13:00:00Z",
  sent_at: "2026-11-05T13:05:00Z",
};
const DRAFT: IssueRow = {
  id: "01ISSUE_DRAFT",
  slug: "2026-12-01-december",
  title: "December",
  status: "draft",
  published_at: null,
  sent_at: null,
};

function beacon(app: Hono<HonoEnv>, bindings: HonoEnv["Bindings"], slug: string, body: unknown) {
  return app.request(
    `/newsletter-public/issues/${slug}/view`,
    // text/plain, exactly as navigator.sendBeacon sends it.
    { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "text/plain" } },
    bindings,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("langBucket / destBucket", () => {
  it("admits the site's own locales and buckets everything else", () => {
    expect(langBucket("es")).toBe("es");
    expect(langBucket("so")).toBe("so");
    expect(langBucket("fr")).toBe("other");
    expect(langBucket(undefined)).toBe("other");
    expect(langBucket(42)).toBe("other");
  });

  it("reduces a click to its hostname and refuses non-links", () => {
    expect(destBucket("https://calendar.eisenhower.school/e/2026-11-07/carnival?x=1")).toBe(
      "calendar.eisenhower.school",
    );
    expect(destBucket("mailto:pto@eisenhower.school")).toBeNull();
    expect(destBucket("tel:+16125551212")).toBeNull();
    expect(destBucket("not a url")).toBeNull();
    expect(destBucket(7)).toBeNull();
  });

  it("decodes a translate-proxy host back to the real one", () => {
    // Google's scheme: "-" doubled, then "." → "-". A click inside the proxy
    // sees only rewritten hrefs, so this is how translated readers' clicks
    // land on the same row as everyone else's.
    expect(destBucket("https://calendar-eisenhower-school.translate.goog/e/x?_x_tr_tl=es")).toBe(
      "calendar.eisenhower.school",
    );
    expect(destBucket("https://my--site-com.translate.goog/")).toBe("my-site.com");
  });
});

describe("POST /newsletter-public/issues/:slug/view", () => {
  it("counts a view against the SCHOOL-local day, bucketing the language", async () => {
    const { db, store } = fakeDb();
    store.issues.push(PUBLISHED);
    const app = publicApp();
    const bindings = env(db);

    await beacon(app, bindings, PUBLISHED.slug, { kind: "view", lang: "es" });
    await beacon(app, bindings, PUBLISHED.slug, { kind: "view", lang: "es" });
    await beacon(app, bindings, PUBLISHED.slug, { kind: "view", lang: "fr" });

    expect(store.views.get(`${PUBLISHED.id}|${SCHOOL_DAY}|es`)).toBe(2);
    // An unrecognized language is "other", never the client's string.
    expect(store.views.get(`${PUBLISHED.id}|${SCHOOL_DAY}|other`)).toBe(1);
    expect([...store.views.keys()].some((k) => k.includes("|fr"))).toBe(false);
    // Never UTC's day.
    expect([...store.views.keys()].some((k) => k.includes("2026-11-06"))).toBe(false);
  });

  it("answers a draft slug byte-identically to a published one, writing nothing", async () => {
    const { db, store } = fakeDb();
    store.issues.push(PUBLISHED, DRAFT);
    const app = publicApp();
    const bindings = env(db);

    const pub = await beacon(app, bindings, PUBLISHED.slug, { kind: "view", lang: "en" });
    const draft = await beacon(app, bindings, DRAFT.slug, { kind: "view", lang: "en" });
    const missing = await beacon(app, bindings, "2027-01-01-nope", { kind: "view", lang: "en" });

    expect(draft.status).toBe(pub.status);
    expect(await draft.text()).toBe(await pub.text());
    expect(await missing.text()).toBe("{\"ok\":true}");
    expect(draft.headers.get("cache-control")).toBe("no-store");
    expect([...store.views.keys()].some((k) => k.startsWith(DRAFT.id))).toBe(false);
  });

  it("still counts an unparseable body as a view (the beacon always sends one)", async () => {
    const { db, store } = fakeDb();
    store.issues.push(PUBLISHED);
    await beacon(publicApp(), env(db), PUBLISHED.slug, "garbage{{");
    expect(store.views.get(`${PUBLISHED.id}|${SCHOOL_DAY}|other`)).toBe(1);
  });

  it("ignores an oversized body without touching the database", async () => {
    const { db, store } = fakeDb();
    store.issues.push(PUBLISHED);
    const res = await beacon(publicApp(), env(db), PUBLISHED.slug, "x".repeat(5000));
    expect(await res.json()).toEqual({ ok: true });
    expect(store.log).toEqual([]);
  });

  it("counts clicks by destination host, translate-proxy hrefs included", async () => {
    const { db, store } = fakeDb();
    store.issues.push(PUBLISHED);
    const app = publicApp();
    const bindings = env(db);

    await beacon(app, bindings, PUBLISHED.slug, {
      kind: "click",
      href: "https://calendar.eisenhower.school/e/2026-11-07/carnival",
    });
    await beacon(app, bindings, PUBLISHED.slug, {
      kind: "click",
      href: "https://calendar-eisenhower-school.translate.goog/e/2026-11-07/carnival?_x_tr_tl=es",
    });
    await beacon(app, bindings, PUBLISHED.slug, { kind: "click", href: "mailto:pto@x.test" });

    expect(store.clicks.get(`${PUBLISHED.id}|${SCHOOL_DAY}|calendar.eisenhower.school`)).toBe(2);
    expect(store.clicks.size).toBe(1);
  });

  it("caps the distinct destinations one issue can mint per day, still counting known ones", async () => {
    const { db, store } = fakeDb();
    store.issues.push(PUBLISHED);
    const app = publicApp();
    const bindings = env(db);

    for (let i = 0; i < 50; i++) {
      store.clicks.set(`${PUBLISHED.id}|${SCHOOL_DAY}|host${i}.example`, 1);
    }
    await beacon(app, bindings, PUBLISHED.slug, { kind: "click", href: "https://brand-new.example/" });
    expect(store.clicks.has(`${PUBLISHED.id}|${SCHOOL_DAY}|brand-new.example`)).toBe(false);

    await beacon(app, bindings, PUBLISHED.slug, { kind: "click", href: "https://host3.example/x" });
    expect(store.clicks.get(`${PUBLISHED.id}|${SCHOOL_DAY}|host3.example`)).toBe(2);
  });
});

describe("GET /newsletter/metrics", () => {
  it("aggregates per issue, per language, per day and per destination", async () => {
    const { db, store } = fakeDb();
    store.issues.push(PUBLISHED, DRAFT);
    store.views.set(`${PUBLISHED.id}|2026-11-04|en`, 7);
    store.views.set(`${PUBLISHED.id}|${SCHOOL_DAY}|es`, 3);
    store.clicks.set(`${PUBLISHED.id}|${SCHOOL_DAY}|calendar.eisenhower.school`, 5);

    const res = await adminApp(admin).request("/newsletter/metrics", {}, env(db));
    expect(res.status).toBe(200);
    const { metrics } = (await res.json()) as {
      metrics: Awaited<ReturnType<typeof newsletterMetrics>>;
    };

    // The draft has no page, so it has no row here.
    expect(metrics.issues.map((i) => i.issueId)).toEqual([PUBLISHED.id]);
    expect(metrics.issues[0]).toMatchObject({
      slug: PUBLISHED.slug,
      title: "November",
      total: 10,
      byLang: { en: 7, es: 3 },
    });
    expect(metrics.totalViews).toBe(10);
    expect(metrics.days).toEqual([
      { day: "2026-11-04", views: 7 },
      { day: SCHOOL_DAY, views: 3 },
    ]);
    expect(metrics.clicks).toEqual([{ dest: "calendar.eisenhower.school", clicks: 5 }]);
  });
});

describe("DELETE /newsletter/issues/:id clears the counters it would trip on", () => {
  it("removes a deletable draft's tallies with the draft", async () => {
    // Published once, viewed, unpublished back to a deletable draft: without
    // the cleanup, the counter rows' REFERENCES would fail the delete.
    const { db, store } = fakeDb();
    const unpublished: IssueRow = { ...PUBLISHED, id: "01ISSUE_BACK", slug: "x", status: "draft", published_at: null };
    store.issues.push(unpublished);
    store.views.set(`${unpublished.id}|2026-11-01|en`, 4);
    store.clicks.set(`${unpublished.id}|2026-11-01|pto.eisenhower.school`, 1);

    const res = await adminApp(admin).request(`/newsletter/issues/${unpublished.id}`, { method: "DELETE" }, env(db));
    expect(res.status).toBe(200);
    expect(store.issues).toEqual([]);
    expect(store.views.size).toBe(0);
    expect(store.clicks.size).toBe(0);
  });

  it("leaves a published issue AND its tallies alone", async () => {
    const { db, store } = fakeDb();
    store.issues.push(PUBLISHED);
    store.views.set(`${PUBLISHED.id}|2026-11-01|en`, 4);

    const res = await adminApp(admin).request(`/newsletter/issues/${PUBLISHED.id}`, { method: "DELETE" }, env(db));
    expect(res.status).toBe(409);
    expect(store.views.size).toBe(1);
  });
});
