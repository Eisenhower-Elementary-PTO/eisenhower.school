// Double opt-in on the public subscribe form.
//
// The property under test is not "subscribing works" — it is that submitting
// the form does NOT subscribe anybody. The route is anonymous and public, so
// the address it receives is an unproven claim; everything here exists to prove
// that the claim stays unproven until the link mailed to that address comes
// back, and that the two halves can't be collapsed into one.
//
// Driven through the real router over a small in-memory D1 stand-in, rather
// than unit-testing helpers, because the guarantees ARE the sequencing: which
// statement runs on which request. A fake that only returned fixed rows would
// assert nothing about that.

import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newsletterPublic } from "../src/routes/newsletterPublic.js";
import type { HonoEnv } from "../src/env.js";

interface ConfirmationRow {
  id: string;
  email: string;
  token_hash: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

/** Minimal D1 stand-in: a real (tiny) store, so a write on one request is
 *  visible to the next. Matches on SQL fragments — narrow on purpose, so a
 *  statement this fake doesn't know about throws instead of silently
 *  no-op'ing and turning a missed write into a passing test. */
function fakeDb() {
  const store = {
    confirmations: [] as ConfirmationRow[],
    subscribers: new Map<string, { unsubscribed_at: string | null; confirmed_at: string | null }>(),
    users: new Map<string, { newsletter_opt_out_at: string | null }>(),
    settings: new Map<string, { value: string }>(),
    admins: [] as string[],
    /** Every statement executed, so a test can assert what did NOT run. */
    log: [] as string[],
  };

  const exec = (sql: string, args: unknown[]) => {
    store.log.push(sql);

    if (sql.includes("SELECT value FROM setting")) {
      const [key] = args as string[];
      return { first: async () => (key ? store.settings.get(key) ?? null : null) };
    }

    if (sql.includes("INSERT INTO setting")) {
      const [key, value] = args as string[];
      store.settings.set(key!, { value: value! });
      return { run: async () => ({ meta: { changes: 1 } }) };
    }

    if (sql.includes("FROM user WHERE is_system_admin = 1")) {
      return { all: async () => ({ results: store.admins.map((email) => ({ email })) }) };
    }

    if (sql.includes("FROM newsletter_confirmation") && sql.includes("COUNT(*) AS total")) {
      const [email, since] = args as [string, string];
      const inWindow = store.confirmations.filter((r) => r.created_at > since);
      return {
        first: async () => ({
          total: inWindow.length,
          mine: inWindow.filter((r) => r.email === email).length,
        }),
      };
    }

    if (sql.includes("INSERT INTO newsletter_confirmation")) {
      const [id, email, token_hash, expires_at, created_at] = args as string[];
      store.confirmations.push({
        id: id!,
        email: email!,
        token_hash: token_hash!,
        expires_at: expires_at!,
        consumed_at: null,
        created_at: created_at!,
      });
      return { run: async () => ({ meta: { changes: 1 } }) };
    }

    if (sql.includes("FROM newsletter_confirmation WHERE token_hash")) {
      const [hash] = args as string[];
      const row = store.confirmations.find((r) => r.token_hash === hash) ?? null;
      return { first: async () => row };
    }

    if (sql.includes("UPDATE newsletter_confirmation SET consumed_at = NULL")) {
      const [id] = args as string[];
      const row = store.confirmations.find((r) => r.id === id);
      if (row) row.consumed_at = null;
      return { run: async () => ({ meta: { changes: row ? 1 : 0 } }) };
    }

    // Sibling burn: every live token for one address, not one row by id.
    if (sql.includes("UPDATE newsletter_confirmation SET consumed_at") && sql.includes("email = ?")) {
      const [now, email] = args as string[];
      let n = 0;
      for (const r of store.confirmations) {
        if (r.email === email && r.consumed_at === null) {
          r.consumed_at = now!;
          n++;
        }
      }
      return { run: async () => ({ meta: { changes: n } }) };
    }

    if (sql.includes("UPDATE newsletter_confirmation SET consumed_at")) {
      const [now, id] = args as string[];
      const row = store.confirmations.find((r) => r.id === id && r.consumed_at === null);
      if (row) row.consumed_at = now!;
      return { run: async () => ({ meta: { changes: row ? 1 : 0 } }) };
    }

    if (sql.includes("INSERT INTO newsletter_subscriber")) {
      const [, email, , confirmed_at] = args as string[];
      store.subscribers.set(email!, { unsubscribed_at: null, confirmed_at: confirmed_at ?? null });
      return { run: async () => ({ meta: { changes: 1 } }) };
    }

    if (sql.includes("UPDATE user SET newsletter_opt_out_at = NULL")) {
      const [email] = args as string[];
      const u = store.users.get(email!);
      if (u) u.newsletter_opt_out_at = null;
      return { run: async () => ({ meta: { changes: u ? 1 : 0 } }) };
    }

    throw new Error(`fakeDb: unhandled SQL: ${sql}`);
  };

  /** A prepared+bound statement that has NOT run yet. Laziness is the point:
   *  real D1 executes a batch's statements inside `batch()`, not at `.bind()`,
   *  so a fake that wrote eagerly would report writes that a failing batch
   *  never actually performed. */
  const stmt = (sql: string, args: unknown[]) => ({
    run: async () =>
      (await (exec(sql, args) as { run?: () => Promise<unknown> }).run?.()) ?? {
        meta: { changes: 0 },
      },
    first: async () =>
      (await (exec(sql, args) as { first?: () => Promise<unknown> }).first?.()) ?? null,
    all: async () =>
      (await (exec(sql, args) as { all?: () => Promise<unknown> }).all?.()) ?? { results: [] },
  });

  const DB = {
    prepare(sql: string) {
      // The unbound forms matter too: adminRecipients queries with no
      // parameters, and a fake missing .all() throws inside notify's try/catch
      // — which would look exactly like "notifications are correctly off".
      return { bind: (...args: unknown[]) => stmt(sql, args), ...stmt(sql, []) };
    },
    async batch(stmts: { run: () => Promise<unknown> }[]) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };

  return { store, DB };
}

function appWith(DB: unknown) {
  const app = new Hono<HonoEnv>();
  // auditMiddleware isn't mounted here; the routes still push drafts, so give
  // them the array they expect and let a test read it.
  const audit: unknown[] = [];
  app.use("*", async (c, next) => {
    c.set("audit", audit as never);
    await next();
  });
  app.route("/newsletter-public", newsletterPublic);
  return { app, audit };
}

const ENV = {
  SCHOOL_NAME: "Eisenhower PTO",
  SCHOOL_TIMEZONE: "America/Chicago",
  NEWSLETTER_URL: "https://newsletter.eisenhower.school",
  CALENDAR_URL: "https://calendar.eisenhower.school",
  BULK_EMAIL_FROM: "Eisenhower PTO <newsletter@sitemail.eisenhower.school>",
  // The outbound channel, captured below. Reads `sent` at call time, so each
  // test's beforeEach reset is seen.
  EMAIL: {
    async send(b: { to: string; subject: string; text: string; html: string }) {
      sent.push({ to: b.to, subject: b.subject, text: b.text, html: b.html });
      return { messageId: "mid" };
    },
  },
} as const;

// Both the confirmation mail and the admin notification are fired through
// waitUntil, so a test that asserted on `sent` right after the response would
// race them. Collect the promises and drain them instead.
let pending: Promise<unknown>[] = [];
const CTX = {
  waitUntil: (p: Promise<unknown>) => void pending.push(p),
  passThroughOnException: () => {},
};

/** Await everything the handler deferred, including work queued by that work. */
async function drain(): Promise<void> {
  while (pending.length) {
    const batch = pending;
    pending = [];
    await Promise.allSettled(batch);
  }
}

/** Outbound mail, captured at the EMAIL binding. */
let sent: { to: string; subject: string; text: string; html: string }[] = [];

beforeEach(() => {
  sent = [];
  pending = [];
  // Mail rides the binding, so any fetch at all is a route doing something
  // unexpected.
  vi.stubGlobal("fetch", async (url: string) => {
    throw new Error(`unexpected fetch: ${url}`);
  });
});

afterEach(() => vi.unstubAllGlobals());

async function post(app: Hono<HonoEnv>, path: string, body: unknown, DB: unknown) {
  const res = await app.fetch(
    new Request(`https://api.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }),
    { ...ENV, DB } as never,
    CTX as never,
  );
  await drain();
  return res;
}

async function get(app: Hono<HonoEnv>, path: string, DB: unknown) {
  return app.fetch(new Request(`https://api.test${path}`), { ...ENV, DB } as never, CTX as never);
}

/** Pull the confirmation token back out of the email, the way a reader would. */
function tokenFromEmail(text: string): string {
  const m = /\/subscribe\/confirm\/([A-Za-z0-9_-]+)/.exec(text);
  if (!m) throw new Error(`no confirm link in email: ${text}`);
  return m[1]!;
}

describe("POST /newsletter-public/subscribe", () => {
  it("mails a confirmation link and subscribes NOBODY", async () => {
    const { store, DB } = fakeDb();
    const { app } = appWith(DB);

    const res = await post(app, "/newsletter-public/subscribe", { email: "Nan@Example.com " }, DB);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // The whole point: the address is on no list yet.
    expect(store.subscribers.size).toBe(0);
    expect(store.log.some((s) => s.includes("INSERT INTO newsletter_subscriber"))).toBe(false);
    // A pending confirmation exists, against the NORMALIZED address.
    expect(store.confirmations).toHaveLength(1);
    expect(store.confirmations[0]!.email).toBe("nan@example.com");
    expect(store.confirmations[0]!.consumed_at).toBeNull();
    // And the link went to the address that was typed in, nowhere else.
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("nan@example.com");
    expect(sent[0]!.text).toContain("https://newsletter.eisenhower.school/subscribe/confirm/");
  });

  it("stores only a hash of the token — never the token itself", async () => {
    const { store, DB } = fakeDb();
    const { app } = appWith(DB);
    await post(app, "/newsletter-public/subscribe", { email: "nan@example.com" }, DB);

    const token = tokenFromEmail(sent[0]!.text);
    expect(store.confirmations[0]!.token_hash).not.toBe(token);
    expect(store.confirmations[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("answers identically for a malformed address, and mails nothing", async () => {
    const { store, DB } = fakeDb();
    const { app } = appWith(DB);

    const res = await post(app, "/newsletter-public/subscribe", { email: "not-an-address" }, DB);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(store.confirmations).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("stops mailing one address past the daily cap, without changing its answer", async () => {
    const { store, DB } = fakeDb();
    const { app } = appWith(DB);

    for (let i = 0; i < 8; i++) {
      const res = await post(app, "/newsletter-public/subscribe", { email: "victim@example.com" }, DB);
      // Identical response every time — the limit must not be an oracle.
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }

    expect(sent).toHaveLength(5);
    // A suppressed attempt writes nothing, so the table grows only as fast as
    // we're willing to send, and the counts stay honest send counts.
    expect(store.confirmations).toHaveLength(5);
  });

  it("caps the instance's total confirmation mail, not just one address", async () => {
    const { store, DB } = fakeDb();
    const { app } = appWith(DB);

    // Distinct addresses, so the per-address cap never engages — this is the
    // harvested-list case, where the victim is our own sending reputation.
    for (let i = 0; i < 210; i++) {
      const res = await post(app, "/newsletter-public/subscribe", { email: `p${i}@example.com` }, DB);
      expect(res.status).toBe(200);
    }

    expect(sent).toHaveLength(200);
    expect(store.confirmations).toHaveLength(200);
  });
});

describe("GET /newsletter-public/subscribe/confirm/:token", () => {
  it("reveals the address but does not subscribe — a mail scanner must not opt anyone in", async () => {
    const { store, DB } = fakeDb();
    const { app } = appWith(DB);
    await post(app, "/newsletter-public/subscribe", { email: "nan@example.com" }, DB);
    const token = tokenFromEmail(sent[0]!.text);

    const res = await get(app, `/newsletter-public/subscribe/confirm/${token}`, DB);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "nan@example.com" });
    // The assertion that matters: still nobody on the list, token still live.
    expect(store.subscribers.size).toBe(0);
    expect(store.confirmations[0]!.consumed_at).toBeNull();
  });

  it("404s an unknown token", async () => {
    const { DB } = fakeDb();
    const { app } = appWith(DB);
    const res = await get(app, "/newsletter-public/subscribe/confirm/nope", DB);
    expect(res.status).toBe(404);
  });

  it("404s an expired token", async () => {
    const { store, DB } = fakeDb();
    const { app } = appWith(DB);
    await post(app, "/newsletter-public/subscribe", { email: "nan@example.com" }, DB);
    const token = tokenFromEmail(sent[0]!.text);
    store.confirmations[0]!.expires_at = "2000-01-01T00:00:00.000Z";

    expect((await get(app, `/newsletter-public/subscribe/confirm/${token}`, DB)).status).toBe(404);
    expect((await post(app, `/newsletter-public/subscribe/confirm/${token}`, {}, DB)).status).toBe(404);
  });
});

describe("POST /newsletter-public/subscribe/confirm/:token", () => {
  it("subscribes the address the token was mailed to, and clears a member opt-out", async () => {
    const { store, DB } = fakeDb();
    const { app, audit } = appWith(DB);
    store.users.set("nan@example.com", { newsletter_opt_out_at: "2026-01-01T00:00:00.000Z" });

    await post(app, "/newsletter-public/subscribe", { email: "nan@example.com" }, DB);
    const token = tokenFromEmail(sent[0]!.text);
    const res = await post(app, `/newsletter-public/subscribe/confirm/${token}`, {}, DB);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, email: "nan@example.com" });
    expect(store.subscribers.get("nan@example.com")).toMatchObject({ unsubscribed_at: null });
    // Stamped by the public confirm path only — this is what the digest reads.
    expect(store.subscribers.get("nan@example.com")!.confirmed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Otherwise mergeAudience would let the stale opt-out beat the new row.
    expect(store.users.get("nan@example.com")!.newsletter_opt_out_at).toBeNull();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "newsletter.subscribed" });
  });

  it("emails the admins when the setting is 'instant'", async () => {
    const { store, DB } = fakeDb();
    const { app } = appWith(DB);
    store.admins.push("principal@school.test", "pto-chair@school.test");
    store.settings.set("newsletter_settings", {
      value: JSON.stringify({ newSubscriberNotify: "instant" }),
    });

    await post(app, "/newsletter-public/subscribe", { email: "nan@example.com" }, DB);
    const token = tokenFromEmail(sent[0]!.text);
    await post(app, `/newsletter-public/subscribe/confirm/${token}`, {}, DB);

    // The confirmation mail, then one notification per admin.
    const notices = sent.filter((m) => m.subject.startsWith("New newsletter subscriber"));
    expect(notices.map((m) => m.to).sort()).toEqual([
      "principal@school.test",
      "pto-chair@school.test",
    ]);
    expect(notices[0]!.text).toContain("nan@example.com");
  });

  it("stays silent when the setting is off — the default", async () => {
    const { store, DB } = fakeDb();
    const { app } = appWith(DB);
    store.admins.push("principal@school.test");

    await post(app, "/newsletter-public/subscribe", { email: "nan@example.com" }, DB);
    const token = tokenFromEmail(sent[0]!.text);
    await post(app, `/newsletter-public/subscribe/confirm/${token}`, {}, DB);

    // Only the subscriber's own confirmation mail was ever sent.
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("nan@example.com");
  });

  it("does not notify an admin about their own subscription", async () => {
    const { store, DB } = fakeDb();
    const { app } = appWith(DB);
    store.admins.push("principal@school.test");
    store.settings.set("newsletter_settings", {
      value: JSON.stringify({ newSubscriberNotify: "instant" }),
    });

    await post(app, "/newsletter-public/subscribe", { email: "principal@school.test" }, DB);
    const token = tokenFromEmail(sent[0]!.text);
    await post(app, `/newsletter-public/subscribe/confirm/${token}`, {}, DB);

    expect(sent.filter((m) => m.subject.startsWith("New newsletter subscriber"))).toHaveLength(0);
  });

  it("subscribes even if the admin notification blows up", async () => {
    const { store, DB } = fakeDb();
    const { app } = appWith(DB);
    store.settings.set("newsletter_settings", { value: "{ not json" });

    await post(app, "/newsletter-public/subscribe", { email: "nan@example.com" }, DB);
    const token = tokenFromEmail(sent[0]!.text);
    const res = await post(app, `/newsletter-public/subscribe/confirm/${token}`, {}, DB);

    expect(res.status).toBe(200);
    expect(store.subscribers.has("nan@example.com")).toBe(true);
  });

  it("burns the address's other live tokens, so an unsubscribe can't be undone by an old email", async () => {
    const { store, DB } = fakeDb();
    const { app } = appWith(DB);

    // Two "send me a link" presses — two valid 7-day tokens.
    await post(app, "/newsletter-public/subscribe", { email: "nan@example.com" }, DB);
    await post(app, "/newsletter-public/subscribe", { email: "nan@example.com" }, DB);
    const first = tokenFromEmail(sent[0]!.text);
    const second = tokenFromEmail(sent[1]!.text);
    expect(first).not.toBe(second);

    await post(app, `/newsletter-public/subscribe/confirm/${second}`, {}, DB);
    // Nan later unsubscribes, then clears out her inbox and clicks the older
    // mail. It must not quietly put her back on the list.
    store.subscribers.set("nan@example.com", {
      unsubscribed_at: "2026-09-01T00:00:00.000Z",
      confirmed_at: null,
    });

    const stale = await post(app, `/newsletter-public/subscribe/confirm/${first}`, {}, DB);
    expect(stale.status).toBe(404);
    expect(store.subscribers.get("nan@example.com")!.unsubscribed_at).toBe("2026-09-01T00:00:00.000Z");
    expect(store.confirmations.every((r) => r.consumed_at !== null)).toBe(true);
  });

  it("hands the token back when the write fails, instead of burning it", async () => {
    const { store, DB } = fakeDb();
    const { app } = appWith(DB);
    await post(app, "/newsletter-public/subscribe", { email: "nan@example.com" }, DB);
    const token = tokenFromEmail(sent[0]!.text);

    const realBatch = DB.batch;
    DB.batch = async () => {
      throw new Error("D1_ERROR: storage");
    };
    const failed = await post(app, `/newsletter-public/subscribe/confirm/${token}`, {}, DB);
    expect(failed.status).toBe(500);
    expect(store.subscribers.size).toBe(0);
    // The link still works — otherwise a transient D1 blip would tell the
    // reader their link expired, with nothing subscribed.
    expect(store.confirmations[0]!.consumed_at).toBeNull();

    DB.batch = realBatch;
    const retry = await post(app, `/newsletter-public/subscribe/confirm/${token}`, {}, DB);
    expect(retry.status).toBe(200);
    expect(store.subscribers.has("nan@example.com")).toBe(true);
  });

  it("is single-use: a second POST changes nothing", async () => {
    const { store, DB } = fakeDb();
    const { app, audit } = appWith(DB);
    await post(app, "/newsletter-public/subscribe", { email: "nan@example.com" }, DB);
    const token = tokenFromEmail(sent[0]!.text);

    await post(app, `/newsletter-public/subscribe/confirm/${token}`, {}, DB);
    const again = await post(app, `/newsletter-public/subscribe/confirm/${token}`, {}, DB);

    // The token is consumed, so the second call resolves as "not found" rather
    // than re-running the write.
    expect(again.status).toBe(404);
    expect(audit).toHaveLength(1);
  });
});
