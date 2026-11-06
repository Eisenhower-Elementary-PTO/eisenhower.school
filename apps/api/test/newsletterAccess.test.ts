// The newsletter router's TWO gates, at the route (invariant 31).
//
// test/ptoAccess.test.ts proves the roster gate FUNCTION decides correctly —
// `newsletterAccess` is that same function keyed on a different setting, so
// nothing about `self_asserted` or the bootstrap case is re-proved here. This
// proves which routes ask which gate, which is the part a refactor can get
// wrong silently: an issue route that quietly kept `isSystemAdmin` locks the
// editors out of one screen, and a subscriber route that quietly took
// `requireEditor` hands every family's email address to the whole committee.
//
// Three properties:
//
//   1. Every issue route admits an editor — someone on the roster who is NOT a
//      system admin — and refuses a member who isn't.
//   2. Every system-admin route refuses that same editor.
//   3. GET /newsletter/access answers a non-editor, so the app can route them.
//
// The list is enumerated by hand. Add a route to routes/newsletter.ts, add it
// here — a route missing from this list is what nothing else will notice.

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AuthContext, HonoEnv } from "../src/env.js";
import { newsletter } from "../src/routes/newsletter.js";
import { NEWSLETTER_EDITOR_GROUP_SETTING } from "../src/lib/newsletter.js";
import { UnauthorizedError } from "../src/middleware/session.js";

const GROUP = "01GRP_EDITORS";

/** Signals that a handler got PAST its gate. The fake below throws it from the
 *  first read a handler makes of its own, so "admitted" is observed as this
 *  error rather than as a 200 that would need every handler's tables faked. */
class ReachedHandler extends Error {}

/** D1 stand-in for the statements the gate issues, and nothing else.
 *
 *  A statement that is not the gate's own is the handler's, and reaching one
 *  means the gate said yes. */
function testEnv(onRoster: boolean): HonoEnv["Bindings"] {
  return {
    // The settings routes build their defaults from these before their first
    // read, so they have to exist for the handler to be reached at all.
    SCHOOL_NAME: "Eisenhower",
    SCHOOL_TIMEZONE: "America/Chicago",
    DB: {
      prepare(sql: string) {
        let binds: unknown[] = [];
        const stmt = {
          bind(...args: unknown[]) {
            binds = args;
            return stmt;
          },
          async first() {
            // The settings ROUTES read a different `setting` key of their own;
            // only the gate's key is answered here.
            if (sql.includes("FROM setting")) {
              if (binds[0] === NEWSLETTER_EDITOR_GROUP_SETTING) return { value: GROUP };
              throw new ReachedHandler(sql);
            }
            if (sql.includes("FROM grp")) return { id: GROUP, name: "Newsletter committee" };
            if (sql.includes("FROM membership m")) return onRoster ? { ok: 1 } : null;
            throw new ReachedHandler(sql);
          },
          async all() {
            throw new ReachedHandler(sql);
          },
          async run() {
            throw new ReachedHandler(sql);
          },
          async batch() {
            throw new ReachedHandler(sql);
          },
        };
        return stmt;
      },
      batch() {
        throw new ReachedHandler("batch");
      },
    },
    NEWSLETTER_MEDIA: {
      put() {
        throw new ReachedHandler("r2 put");
      },
    },
  } as unknown as HonoEnv["Bindings"];
}

function auth(userId: string, isSystemAdmin = false): AuthContext {
  return {
    userId,
    realUserId: userId,
    email: `${userId}@eisenhower.edu`,
    isSystemAdmin,
    sessionId: "01SESSION",
    activePersonId: null,
    isMasquerading: false,
    isApproved: true,
  };
}

/** The status `ReachedHandler` becomes: 418, a code nothing in this API sends,
 *  so "admitted" and "refused" can be told apart without a real database. */
const ADMITTED = 418;

type Route = [method: string, path: string, body?: unknown, contentType?: string];

/** The router with a session injected, and `ReachedHandler` turned into
 *  `ADMITTED`. */
function appWith(session: AuthContext | null): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();
  app.use("*", async (c, next) => {
    c.set("audit", []);
    if (session) c.set("auth", session);
    await next();
  });
  app.route("/newsletter", newsletter);
  app.onError((err, c) => {
    if (err instanceof UnauthorizedError) return c.json({ error: "unauthorized" }, 401);
    if (err instanceof ReachedHandler) return c.json({ reached: err.message }, ADMITTED);
    throw err;
  });
  return app;
}

/** Routes behind `requireEditor`: everything about issues, the composer's
 *  settings read, and the image upload. */
const EDITOR_ROUTES: Route[] = [
  ["GET", "/newsletter/issues"],
  ["POST", "/newsletter/issues", { title: "September" }],
  ["GET", "/newsletter/issues/01ISSUE"],
  ["PATCH", "/newsletter/issues/01ISSUE", { title: "x" }],
  ["DELETE", "/newsletter/issues/01ISSUE"],
  ["POST", "/newsletter/issues/01ISSUE/preview-link"],
  ["DELETE", "/newsletter/issues/01ISSUE/preview-link"],
  ["GET", "/newsletter/issues/01ISSUE/preview"],
  ["POST", "/newsletter/issues/01ISSUE/test-send", { to: ["a@x.test"] }],
  ["POST", "/newsletter/issues/01ISSUE/assist", { mode: "succinct" }],
  ["POST", "/newsletter/issues/01ISSUE/publish"],
  ["DELETE", "/newsletter/issues/01ISSUE/publish"],
  ["POST", "/newsletter/issues/01ISSUE/send"],
  ["POST", "/newsletter/issues/01ISSUE/retry"],
  ["GET", "/newsletter/settings"],
  ["GET", "/newsletter/metrics"],
  ["POST", "/newsletter/media", "png-bytes", "image/png"],
];

/** Routes that stay with system admins: writing settings, the subscriber list,
 *  and the editors setting itself. */
const ADMIN_ROUTES: Route[] = [
  ["PUT", "/newsletter/settings", {}],
  ["GET", "/newsletter/subscribers"],
  ["POST", "/newsletter/subscribers", { email: "a@x.test" }],
  ["POST", "/newsletter/subscribers/import", { text: "a@x.test" }],
  ["DELETE", "/newsletter/subscribers/01SUB"],
  ["GET", "/newsletter/groups"],
  ["PUT", "/newsletter/editors", { groupId: GROUP }],
];

function call(app: Hono<HonoEnv>, [method, path, body, contentType]: Route, onRoster: boolean) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    init.headers = { "content-type": contentType ?? "application/json" };
  }
  return app.request(path, init, testEnv(onRoster));
}

describe("every /newsletter route refuses without a session", () => {
  const app = appWith(null);
  for (const route of [...EDITOR_ROUTES, ...ADMIN_ROUTES]) {
    it(`${route[0]} ${route[1]} → 401`, async () => {
      expect((await call(app, route, true)).status).toBe(401);
    });
  }
});

describe("issue routes admit an editor who is not a system admin", () => {
  const app = appWith(auth("01U_EDITOR"));
  for (const route of EDITOR_ROUTES) {
    it(`${route[0]} ${route[1]} → handler`, async () => {
      expect((await call(app, route, true)).status).toBe(ADMITTED);
    });
  }
});

describe("issue routes refuse a member who is not on the editors roster", () => {
  const app = appWith(auth("01U_OUTSIDER"));
  for (const route of EDITOR_ROUTES) {
    it(`${route[0]} ${route[1]} → 403`, async () => {
      expect((await call(app, route, false)).status).toBe(403);
    });
  }
});

describe("system-admin routes refuse an editor", () => {
  // On the roster, and still refused: the subscriber list is email addresses
  // the committee has no need to see, and the editors setting is the lever
  // over who gets in — an editor who could move it could add anyone.
  const app = appWith(auth("01U_EDITOR"));
  for (const route of ADMIN_ROUTES) {
    it(`${route[0]} ${route[1]} → 403`, async () => {
      expect((await call(app, route, true)).status).toBe(403);
    });
  }
});

describe("system-admin routes still admit a system admin", () => {
  const app = appWith(auth("01U_ADMIN", true));
  for (const route of ADMIN_ROUTES) {
    it(`${route[0]} ${route[1]} → handler`, async () => {
      expect((await call(app, route, false)).status).toBe(ADMITTED);
    });
  }
});

describe("GET /newsletter/access is the one route outside both gates", () => {
  it("answers a member who is not an editor, so the app can route them", async () => {
    const res = await appWith(auth("01U_OUTSIDER")).request("/newsletter/access", {}, testEnv(false));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { canUse: boolean; isSystemAdmin: boolean; groupName: string | null };
    expect(body).toEqual({
      canUse: false,
      isSystemAdmin: false,
      groupName: "Newsletter committee",
      groupId: GROUP,
    });
  });

  it("answers yes to an editor", async () => {
    const res = await appWith(auth("01U_EDITOR")).request("/newsletter/access", {}, testEnv(true));
    expect(((await res.json()) as { canUse: boolean }).canUse).toBe(true);
  });

  it("still needs a session", async () => {
    const res = await appWith(null).request("/newsletter/access", {}, testEnv(true));
    expect(res.status).toBe(401);
  });

  it("is keyed on its own setting, not the PTO board's", () => {
    // The two committees are different groups. A shared key would make every
    // PTO board member a newsletter editor and vice versa.
    expect(NEWSLETTER_EDITOR_GROUP_SETTING).toBe("newsletter_editor_group_id");
    expect(NEWSLETTER_EDITOR_GROUP_SETTING).not.toBe("pto_board_group_id");
  });
});
