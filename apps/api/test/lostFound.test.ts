// Lost & found (invariant 33): the gate on every staff route, the member
// submission path (any session may add an item; it stays held until staff
// publish), the public projection's key set, the name scrub, and the claim
// form's uniform answer.
//
// The route lists are enumerated by hand, as test/ptoRoutes.test.ts's are: if
// you add a route to routes/lostFound.ts, add it to STAFF_ROUTES or — only for
// a route that is deliberately open to any session — MEMBER_ROUTES. A route
// that forgets `requireStaff` is exactly what nothing else will notice.

import { Hono } from "hono";
import { lfContactIsEmail, lfContactPhone, lostFoundReturnMessage } from "@sd/shared";
import { describe, expect, it } from "vitest";
import type { AuthContext, HonoEnv } from "../src/env.js";
import type { AuditDraft } from "../src/lib/audit.js";
import {
  LISTED,
  cleanFields,
  CROP_PADDING,
  cleanCrop,
  cleanRotation,
  parseCrop,
  extractJson,
  isListed,
  itemIdOfKey,
  normalizeContact,
  parseClaimNotifyEmails,
  publicItemOf,
  returnedEverCount,
  saveFields,
  staffItemOf,
  scrubNames,
  searchTextOf,
  searchWords,
  tagItem,
  type LfClaimRow,
  type LfItemRow,
} from "../src/lib/lostFound.js";
import { lostFound } from "../src/routes/lostFound.js";
import { lostFoundPublic } from "../src/routes/lostFoundPublic.js";
import { UnauthorizedError } from "../src/middleware/session.js";

const GROUP = "01GRP";

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

function row(over: Partial<LfItemRow> = {}): LfItemRow {
  return {
    id: "01ITEM",
    status: "found",
    hidden_at: null,
    held_at: null,
    tag_status: "tagged",
    tag_error: null,
    title: "Blue water bottle",
    description: "A blue metal bottle with a soccer sticker.",
    category: "Water bottle",
    colors: '["blue"]',
    brand: "Hydro Flask",
    material: "metal",
    visible_text: "MILO R. NIKE",
    name_text: "MILO R.",
    tags: '["bottle","flask"]',
    location: "Gym",
    search_text: "blue water bottle",
    photo_key: "01ITEM.jpg",
    thumb_key: "01ITEM-thumb.jpg",
    suggested_rotation: 0,
    suggested_crop: null,
    found_at: "2026-10-01T15:00:00.000Z",
    returned_at: null,
    created_by: "01U_STAFF",
    member_submitted: 0,
    updated_at: "2026-10-01T15:00:00.000Z",
    ...over,
  };
}

// ── The staff gate ──────────────────────────────────────────────────────────

/** D1 stand-in answering only the gate's own statements. A gated route that
 *  slipped through would hit `all`/`run` and throw — loud, on purpose. */
function gateEnv(onRoster: boolean): HonoEnv["Bindings"] {
  return {
    DB: {
      prepare(sql: string) {
        return {
          bind: () => ({
            async first() {
              if (sql.includes("FROM setting")) return { value: GROUP };
              if (sql.includes("FROM grp")) return { id: GROUP, name: "Front office" };
              if (sql.includes("FROM membership m")) return onRoster ? { ok: 1 } : null;
              throw new Error(`gateEnv: unhandled statement: ${sql}`);
            },
            async all() {
              throw new Error(`gateEnv: a gated route reached a read: ${sql}`);
            },
            async run() {
              throw new Error(`gateEnv: a gated route reached a write: ${sql}`);
            },
          }),
        };
      },
    },
  } as unknown as HonoEnv["Bindings"];
}

function appWith(session: AuthContext | null, audit: AuditDraft[] = []): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();
  app.use("*", async (c, next) => {
    c.set("audit", audit);
    if (session) c.set("auth", session);
    await next();
  });
  app.route("/lostfound", lostFound);
  app.route("/lostfound-public", lostFoundPublic);
  app.onError((err, c) => {
    if (err instanceof UnauthorizedError) return c.json({ error: "unauthorized" }, 401);
    throw err;
  });
  return app;
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

const STAFF_ROUTES: Array<[string, string, unknown?]> = [
  ["GET", "/lostfound/items"],
  ["GET", "/lostfound/items?view=attention"],
  ["GET", "/lostfound/items?ids=01ITEM,01OTHER"],
  ["GET", "/lostfound/items/01ITEM"],
  ["PUT", "/lostfound/items/01ITEM/photo", JPEG],
  ["PATCH", "/lostfound/items/01ITEM", { title: "x" }],
  ["POST", "/lostfound/items/01ITEM/publish", {}],
  ["POST", "/lostfound/items/01ITEM/hide", {}],
  ["POST", "/lostfound/items/01ITEM/unhide", {}],
  ["POST", "/lostfound/items/01ITEM/return", {}],
  ["POST", "/lostfound/items/01ITEM/restore", {}],
  ["POST", "/lostfound/items/01ITEM/retag", {}],
  ["POST", "/lostfound/items/bulk", { ids: ["01ITEM"], action: "publish" }],
  ["DELETE", "/lostfound/items/01ITEM", {}],
  ["GET", "/lostfound/claims"],
  ["GET", "/lostfound/media/01ITEM.jpg"],
  ["POST", "/lostfound/claims/01CLAIM/dismiss", {}],
  ["POST", "/lostfound/claims/01CLAIM/return", { method: "classroom" }],
  ["POST", "/lostfound/retag-failed", {}],
];

/** Open to ANY session — submitting a found item (routes/lostFound.ts's
 *  header). Still refused without a session, and still preflighted. */
const MEMBER_ROUTES: Array<[string, string, unknown?]> = [
  ["POST", "/lostfound/items?location=Gym", JPEG],
  ["PUT", "/lostfound/items/01ITEM/thumb", JPEG],
];

const ALL_ROUTES = [...STAFF_ROUTES, ...MEMBER_ROUTES];

/** A do-nothing ExecutionContext, for the routes that `waitUntil` a vector
 *  sync — without one, reaching `c.executionCtx` throws. */
const EXECUTION_CTX = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

function call(app: Hono<HonoEnv>, method: string, path: string, body: unknown, env: HonoEnv["Bindings"]) {
  const init: RequestInit = { method };
  if (body instanceof Uint8Array) {
    init.body = body;
    init.headers = { "content-type": "image/jpeg" };
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }
  return app.request(path, init, env, EXECUTION_CTX);
}

describe("every /lostfound route refuses without a session", () => {
  const app = appWith(null);
  for (const [method, path, body] of ALL_ROUTES) {
    it(`${method} ${path} → 401`, async () => {
      expect((await call(app, method, path, body, gateEnv(true))).status).toBe(401);
    });
  }
});

describe("every /lostfound staff route refuses a member who isn't on the staff roster", () => {
  const app = appWith(auth("01U_PARENT"));
  for (const [method, path, body] of STAFF_ROUTES) {
    it(`${method} ${path} → 403`, async () => {
      expect((await call(app, method, path, body, gateEnv(false))).status).toBe(403);
    });
  }
});

describe("a write a cross-site form could send is refused before anything else", () => {
  // `sd_session` is SameSite=Lax, which doesn't separate sibling subdomains;
  // only a body type that forces a CORS preflight does (routes/lostFound.ts).
  const app = appWith(auth("01U_STAFF"));
  for (const [method, path] of ALL_ROUTES.filter(([m]) => m !== "GET")) {
    it(`${method} ${path} with no body / a form body → 415`, async () => {
      expect((await app.request(path, { method }, gateEnv(true))).status).toBe(415);
      const form = await app.request(
        path,
        { method, body: "x=1", headers: { "content-type": "application/x-www-form-urlencoded" } },
        gateEnv(true),
      );
      expect(form.status).toBe(415);
    });
  }
});

describe("the routes outside the staff gate", () => {
  it("GET /lostfound/access answers a member who isn't staff, so the app can say so", async () => {
    const res = await call(appWith(auth("01U_PARENT")), "GET", "/lostfound/access", undefined, gateEnv(false));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ canUse: false, isSystemAdmin: false, groupName: "Front office" });
  });

  it("the settings routes are system-admin only, even for staff", async () => {
    const staff = appWith(auth("01U_STAFF"));
    expect((await call(staff, "GET", "/lostfound/groups", undefined, gateEnv(true))).status).toBe(403);
    expect((await call(staff, "PUT", "/lostfound/settings", { groupId: GROUP }, gateEnv(true))).status).toBe(403);
    expect((await call(staff, "GET", "/lostfound/settings", undefined, gateEnv(true))).status).toBe(403);
    expect(
      (await call(staff, "PUT", "/lostfound/settings/claim-emails", { emails: [] }, gateEnv(true))).status,
    ).toBe(403);
  });
});

// ── Claim notification settings ─────────────────────────────────────────────

describe("PUT /lostfound/settings/claim-emails", () => {
  /** D1 stand-in: the stored setting, and a log of writes to it. */
  function settingsEnv(stored: string | null = null) {
    const writes: { sql: string; args: unknown[] }[] = [];
    const env = {
      DB: {
        prepare(sql: string) {
          return {
            bind: (...args: unknown[]) => ({
              async first() {
                if (sql.includes("FROM setting")) return stored === null ? null : { value: stored };
                throw new Error(`settingsEnv: unhandled first: ${sql}`);
              },
              async run() {
                writes.push({ sql, args });
                return { meta: { changes: 1 } };
              },
            }),
          };
        },
      },
    } as unknown as HonoEnv["Bindings"];
    return { env, writes };
  }

  async function putEmails(body: unknown, stored: string | null = null) {
    const audit: AuditDraft[] = [];
    const { env, writes } = settingsEnv(stored);
    const res = await call(appWith(auth("01U_ADMIN", true), audit), "PUT", "/lostfound/settings/claim-emails", body, env);
    return { res, writes, audit };
  }

  it("saves normalized, deduplicated addresses and audits a COUNT, never the addresses", async () => {
    const { res, writes, audit } = await putEmails({ emails: [" Office@School.example ", "office@school.example", "", "pto@x.org"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ claimNotifyEmails: ["office@school.example", "pto@x.org"] });
    expect(writes).toHaveLength(1);
    expect(writes[0]!.args).toContain(JSON.stringify(["office@school.example", "pto@x.org"]));
    expect(audit).toHaveLength(1);
    expect(audit[0]!).toMatchObject({ action: "lostfound.claim_notify.configured", detail: { count: 2 } });
    expect(JSON.stringify(audit[0])).not.toContain("office@school.example");
  });

  it("refuses the whole save on one bad address — a typo must not read as saved", async () => {
    const { res, writes, audit } = await putEmails({ emails: ["office@school.example", "not-an-address"] });
    expect(res.status).toBe(400);
    expect(writes).toEqual([]);
    expect(audit).toEqual([]);
  });

  it("refuses more than the cap, a missing list, and an empty list turns the mail off", async () => {
    expect((await putEmails({ emails: Array.from({ length: 11 }, (_, i) => `a${i}@x.org`) })).res.status).toBe(400);
    expect((await putEmails({})).res.status).toBe(400);
    const off = await putEmails({ emails: [] });
    expect(off.res.status).toBe(200);
    expect(await off.res.json()).toEqual({ claimNotifyEmails: [] });
  });

  it("GET /lostfound/settings reads the stored list back", async () => {
    const { env } = settingsEnv(JSON.stringify(["office@school.example"]));
    const res = await call(appWith(auth("01U_ADMIN", true)), "GET", "/lostfound/settings", undefined, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ claimNotifyEmails: ["office@school.example"] });
  });
});

describe("parseClaimNotifyEmails", () => {
  it("is forgiving on read: garbage, non-arrays and non-strings come back as what's recognisable", () => {
    expect(parseClaimNotifyEmails(null)).toEqual([]);
    expect(parseClaimNotifyEmails("not json")).toEqual([]);
    expect(parseClaimNotifyEmails('{"a":1}')).toEqual([]);
    expect(parseClaimNotifyEmails('["Office@X.org", 3, "office@x.org", "no-at-sign", ""]')).toEqual(["office@x.org"]);
  });

  it("caps the list even when the stored value is longer", () => {
    const many = JSON.stringify(Array.from({ length: 20 }, (_, i) => `a${i}@x.org`));
    expect(parseClaimNotifyEmails(many)).toHaveLength(10);
  });
});

// ── Member submission ───────────────────────────────────────────────────────
// Any session may POST an item, and there is deliberately NO per-member cap
// (one shipped and cut a parent off mid-rack). What makes that safe is that a
// non-staff item is flagged `member_submitted` and the model never releases
// its hold — only staff's Publish does. The fake below answers no COUNT query,
// so a cap quietly reintroduced fails these tests loudly.

/** D1 + R2 stand-ins for the submission path: the roster gate, the INSERT
 *  (recorded), and the reload that builds the response. */
function submitEnv(opts: { onRoster: boolean }) {
  const writes: { sql: string; args: unknown[] }[] = [];
  const media: string[] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind: (...args: unknown[]) => ({
            async first() {
              if (sql.includes("FROM setting")) return { value: GROUP };
              if (sql.includes("FROM grp")) return { id: GROUP, name: "Front office" };
              if (sql.includes("FROM membership m")) return opts.onRoster ? { ok: 1 } : null;
              if (sql.includes("FROM lf_item i")) {
                // getStaffItem's reload: echo back what the INSERT wrote.
                const ins = writes.find((w) => w.sql.includes("INSERT INTO lf_item"));
                if (!ins) return null;
                return {
                  ...row(),
                  id: ins.args[0],
                  visible_text: "",
                  name_text: "",
                  held_at: ins.args[4],
                  member_submitted: ins.args[7],
                  open_claims: 0,
                  created_by_email: null,
                };
              }
              throw new Error(`submitEnv: unhandled first: ${sql}`);
            },
            async run() {
              writes.push({ sql, args });
              return { meta: { changes: 1 } };
            },
          }),
        };
      },
    },
    LOSTFOUND_MEDIA: {
      put: async (key: string) => void media.push(`put ${key}`),
      delete: async (key: string) => void media.push(`delete ${key}`),
    },
  } as unknown as HonoEnv["Bindings"];
  return { env, writes, media };
}

describe("POST /lostfound/items as a signed-in member", () => {
  async function post(opts: Parameters<typeof submitEnv>[0], who = "01U_PARENT") {
    const audit: AuditDraft[] = [];
    const { env, writes, media } = submitEnv(opts);
    const res = await call(appWith(auth(who), audit), "POST", "/lostfound/items?location=Gym", JPEG, env);
    return { res, writes, media, audit };
  }

  it("creates the item flagged member_submitted, held, and says so in the audit detail", async () => {
    const { res, writes, audit } = await post({ onRoster: false });
    expect(res.status).toBe(201);
    const ins = writes.find((w) => w.sql.includes("INSERT INTO lf_item"))!;
    // (id, photo_key, location, search_text, held_at, found_at, created_by, member_submitted, updated_at)
    expect(ins.args[7]).toBe(1);
    expect(ins.args[4]).toBeTruthy(); // held from the first moment
    expect(audit).toHaveLength(1);
    expect(audit[0]!).toMatchObject({ action: "lostfound.item.created", detail: { memberSubmitted: true } });
    expect(((await res.json()) as { memberSubmitted: boolean }).memberSubmitted).toBe(true);
  });

  it("creates a staff upload unflagged, with no detail — the model may still release it", async () => {
    const { res, writes, audit } = await post({ onRoster: true }, "01U_STAFF");
    expect(res.status).toBe(201);
    expect(writes.find((w) => w.sql.includes("INSERT INTO lf_item"))!.args[7]).toBe(0);
    expect(audit[0]!.detail).toBeUndefined();
  });

});

describe("PUT /lostfound/items/:id/thumb ownership", () => {
  // The creator's window is EXACTLY "still held, still pending" — the second
  // half of submitting. Past it, the thumbnail is the public grid's image, so
  // only the roster may touch it (the route's comment; invariant 33).
  function thumbEnv(over: Partial<LfItemRow>, onRoster = false) {
    const writes: string[] = [];
    const env = {
      DB: {
        prepare(sql: string) {
          return {
            bind: () => ({
              async first() {
                if (sql.includes("FROM setting")) return { value: GROUP };
                if (sql.includes("FROM grp")) return { id: GROUP, name: "Front office" };
                if (sql.includes("FROM membership m")) return onRoster ? { ok: 1 } : null;
                if (sql.includes("FROM lf_item i")) {
                  return { ...row(), member_submitted: 1, open_claims: 0, created_by_email: null, ...over };
                }
                throw new Error(`thumbEnv: unhandled first: ${sql}`);
              },
              async run() {
                writes.push(sql);
                return { meta: { changes: 1 } };
              },
            }),
          };
        },
      },
      LOSTFOUND_MEDIA: { put: async () => {}, delete: async () => {} },
    } as unknown as HonoEnv["Bindings"];
    return { env, writes };
  }

  // The pending path launches `tagItem` through the execution context, so give
  // Hono one; with no AI binding the call fails onto the item, harmlessly here.
  const CTX = { waitUntil: () => {} } as unknown as ExecutionContext;
  const put = (who: string, env: HonoEnv["Bindings"]) =>
    appWith(auth(who)).request(
      "/lostfound/items/01ITEM/thumb",
      { method: "PUT", body: JPEG, headers: { "content-type": "image/jpeg" } },
      env,
      CTX,
    );

  const HELD_PENDING: Partial<LfItemRow> = {
    created_by: "01U_PARENT",
    held_at: "2026-10-01T15:00:00.000Z",
    tag_status: "pending",
    visible_text: "",
    name_text: "",
  };

  it("lets the item's creator send the thumbnail while it is held and pending, and nobody else off the roster", async () => {
    const own = thumbEnv(HELD_PENDING);
    expect((await put("01U_PARENT", own.env)).status).toBe(200);
    expect(own.writes.some((s) => s.includes("SET thumb_key"))).toBe(true);

    const other = thumbEnv(HELD_PENDING);
    expect((await put("01U_OTHER", other.env)).status).toBe(403);
    expect(other.writes).toEqual([]);
  });

  it("refuses the creator once the item is published or described — the public image is the roster's", async () => {
    // Published: staff looked and released the hold.
    const published = thumbEnv({ created_by: "01U_PARENT", held_at: null, tag_status: "tagged" });
    expect((await put("01U_PARENT", published.env)).status).toBe(403);
    expect(published.writes).toEqual([]);

    // Still held, but described: the model has written; staff review is next.
    const described = thumbEnv({ created_by: "01U_PARENT", held_at: "2026-10-01T15:00:00.000Z", tag_status: "tagged" });
    expect((await put("01U_PARENT", described.env)).status).toBe(403);
    expect(described.writes).toEqual([]);
  });

  it("staff keep the route whatever the item's state (rotation re-sends a thumbnail)", async () => {
    const staff = thumbEnv({ created_by: "01U_PARENT", held_at: null, tag_status: "tagged" }, true);
    expect((await put("01U_STAFF", staff.env)).status).toBe(200);
    expect(staff.writes.some((s) => s.includes("SET thumb_key"))).toBe(true);
  });
});

// ── The public projection ───────────────────────────────────────────────────

describe("publicItemOf", () => {
  const ORIGIN = "https://api-directory.eisenhower.school";

  it("has exactly the public keys", () => {
    expect(Object.keys(publicItemOf(row(), ORIGIN)).sort()).toEqual(
      [
        "brand",
        "category",
        "colors",
        "description",
        "foundAt",
        "id",
        "location",
        "material",
        "pending",
        "photoUrl",
        "tags",
        "thumbUrl",
        "title",
      ].sort(),
    );
  });

  it("never carries what was written on the item, who uploaded it, or a widened row's extras", () => {
    const widened = { ...row(), secret_column: "x", open_claims: 3, created_by_email: "office@school" } as LfItemRow;
    const out = JSON.stringify(publicItemOf(widened, ORIGIN));
    expect(out).not.toContain("MILO");
    expect(out).not.toContain("01U_STAFF");
    expect(out).not.toContain("secret_column");
    expect(out).not.toContain("office@school");
  });

  it("falls back to the photo until the thumbnail arrives", () => {
    expect(publicItemOf(row({ thumb_key: null }), ORIGIN).thumbUrl).toBe(`${ORIGIN}/lostfound-media/01ITEM.jpg`);
  });
});

// ── Names stay staff-only ───────────────────────────────────────────────────

describe("scrubNames", () => {
  const fields = (over: Partial<ReturnType<typeof cleanFields>>) => ({ ...cleanFields({ title: "x" }), ...over });

  it("cuts the NAME read off the item from the title, description and tags", () => {
    const out = scrubNames(
      fields({
        title: "Milo's blue jacket",
        description: "Blue jacket; the tag says Milo Rivera.",
        tags: ["jacket", "milo", "rivera"],
        visibleText: "Milo Rivera NIKE",
        nameText: "Milo Rivera",
      }),
    );
    expect(JSON.stringify([out.title, out.description, out.tags])).not.toMatch(/milo|rivera/i);
    expect(out.visibleText).toBe("Milo Rivera NIKE");
    expect(out.nameText).toBe("Milo Rivera");
  });

  it("keeps non-name writing — a brand on the item has to stay searchable (migration 0038)", () => {
    // The first scrub cut EVERY word read off the item, and parents searching
    // "Nike" couldn't find their children's clothing. Only `nameText` is cut;
    // the hold (any writing keeps the item held for staff) is the backstop.
    const out = scrubNames(
      fields({
        title: "Nike hoodie",
        description: "Gray Nike hoodie, Minnesota Twins patch.",
        tags: ["nike", "hoodie", "twins"],
        visibleText: "NIKE Minnesota Twins",
        nameText: "",
      }),
    );
    expect(out.title).toBe("Nike hoodie");
    expect(out.description).toContain("Nike");
    expect(out.tags).toEqual(["nike", "hoodie", "twins"]);
  });

  it("keeps the brand even when the brand is also the name read", () => {
    const out = scrubNames(fields({ title: "Hydro Flask bottle", brand: "Hydro Flask", nameText: "HYDRO FLASK" }));
    expect(out.title).toBe("Hydro Flask bottle");
  });

  it("handles names with accents", () => {
    const out = scrubNames(fields({ title: "Chaqueta de Zoë", nameText: "Zoë" }));
    expect(out.title).not.toContain("Zoë");
  });
});

describe("searchTextOf", () => {
  it("is built without visible_text or name_text, so the public search can't confirm a name", () => {
    const f = cleanFields({ title: "Red lunch box", visibleText: "AVA K wrote this", nameText: "AVA K" });
    expect(searchTextOf(f, "Cafeteria")).not.toContain("ava");
    expect(searchTextOf(f, "Cafeteria")).not.toContain("wrote");
  });
});

// ── The model's answer ──────────────────────────────────────────────────────

describe("cleanFields + extractJson", () => {
  it("reads both response shapes Workers AI uses", () => {
    expect(extractJson({ response: '{"title":"a"}' })).toEqual({ title: "a" });
    expect(extractJson({ choices: [{ message: { content: '```json\n{"title":"b"}\n```' } }] })).toEqual({ title: "b" });
  });

  it("keeps only known categories and colours and drops placeholders", () => {
    const f = cleanFields({ title: "Bottle", category: "Spaceship", colors: ["Blue", "teal", "blue"], brand: "not visible" });
    expect(f.category).toBe("Other");
    expect(f.colors).toEqual(["blue"]);
    expect(f.brand).toBe("");
  });
});

describe("searchWords", () => {
  it("is LIKE-safe: letters and digits only, each under D1's 50-byte pattern cap", () => {
    expect(searchWords('blue %_ "bottle" ' + "x".repeat(80))).toEqual(["blue", "bottle", "x".repeat(40)]);
  });
});

describe("normalizeContact", () => {
  it("treats one phone number written two ways as one contact", () => {
    expect(normalizeContact("(612) 555-0100")).toBe(normalizeContact("612.555.0100"));
    expect(normalizeContact(" Pat@Example.com ")).toBe("pat@example.com");
  });
});

// ── The all-time returned count ─────────────────────────────────────────────

describe("returnedEverCount", () => {
  /** A fake D1 that holds an audit log as action strings and EVALUATES the
   *  two COUNT subqueries, so a rewrite that forgot to net out `restored` —
   *  or started counting some other action — fails here, not in production. */
  function auditEnv(actions: string[]) {
    return {
      DB: {
        prepare(sql: string) {
          return {
            async first(col: string) {
              expect(col).toBe("n");
              const count = (action: string) => actions.filter((a) => a === action).length;
              const m = [...sql.matchAll(/WHERE action = '([^']+)'/g)].map((x) => x[1]!);
              expect(m).toHaveLength(2);
              return count(m[0]!) - count(m[1]!);
            },
          };
        },
      },
    } as unknown as HonoEnv["Bindings"];
  }

  it("counts returns net of restores, from the audit log", async () => {
    const env = auditEnv([
      "lostfound.item.returned",
      "lostfound.item.returned",
      "lostfound.item.restored", // one return undone: it did not go home
      "lostfound.item.returned",
      "lostfound.item.created", // unrelated actions never count
      "lostfound.claim.created",
    ]);
    expect(await returnedEverCount(env)).toBe(2);
  });

  it("clamps at zero rather than rendering a negative count", async () => {
    expect(await returnedEverCount(auditEnv(["lostfound.item.restored"]))).toBe(0);
    expect(await returnedEverCount(auditEnv([]))).toBe(0);
  });
});

// ── The claim form ──────────────────────────────────────────────────────────

/** D1 + EMAIL stand-ins for the claim route: one item, configurable counts,
 *  the notification setting, a log of every write, and every message the
 *  Cloudflare binding was handed (both its halves set, so `sendEmail` takes
 *  the binding rather than the dev console log). */
function claimEnv(opts: { item?: LfItemRow | null; total?: number; mine?: number; open?: number; notify?: string[] }) {
  const writes: string[] = [];
  const sent: Array<{ to: string; subject: string; text: string; html: string }> = [];
  const env = {
    BULK_EMAIL_FROM: "Lost & Found <lostfound@sitemail.eisenhower.school>",
    EMAIL: { send: async (msg: (typeof sent)[number]) => void sent.push(msg) },
    SCHOOL_NAME: "Eisenhower",
    LOSTFOUND_URL: "https://lostandfound.eisenhower.school",
    DB: {
      prepare(sql: string) {
        return {
          bind: (...args: unknown[]) => ({
            async first() {
              if (sql.includes("FROM lf_item WHERE id")) return opts.item === undefined ? row() : opts.item;
              if (sql.includes("AS total")) return { total: opts.total ?? 0, mine: opts.mine ?? 0, open: opts.open ?? 0 };
              if (sql.includes("FROM setting")) return opts.notify ? { value: JSON.stringify(opts.notify) } : null;
              throw new Error(`claimEnv: unhandled: ${sql}`);
            },
            async run() {
              writes.push(`${sql} ${JSON.stringify(args)}`);
              return { meta: { changes: 1 } };
            },
          }),
        };
      },
    },
  } as unknown as HonoEnv["Bindings"];
  return { env, writes, sent };
}

describe("POST /lostfound-public/items/:id/claims", () => {
  const claim = {
    name: "Pat",
    contact: "pat@example.com",
    childName: "Milo",
    teacher: "Ms. Shrestha",
    message: "Dent on the bottom",
  };

  async function post(
    body: unknown,
    opts: Parameters<typeof claimEnv>[0] = {},
    session: AuthContext | null = null,
  ) {
    const audit: AuditDraft[] = [];
    const { env, writes, sent } = claimEnv(opts);
    // Collect waitUntil promises so the notification (fired after the row
    // commits) has finished before anything is asserted.
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) } as unknown as ExecutionContext;
    const res = await appWith(session, audit).request(
      "/lostfound-public/items/01ITEM/claims",
      { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } },
      env,
      ctx,
    );
    await Promise.all(pending);
    return { status: res.status, json: await res.json(), writes, audit, sent };
  }

  /** The INSERT's bind values back out of the write log. */
  const argsOf = (w: string) => JSON.parse(w.slice(w.indexOf("["))) as unknown[];

  it("stores a claim, audits it with no claimant details, and answers ok", async () => {
    const r = await post(claim);
    expect(r.json).toEqual({ ok: true });
    expect(r.writes).toHaveLength(1);
    expect(r.writes[0]).toContain("contact_key");
    // The child's name and teacher (migration 0043) land on the row…
    expect(r.writes[0]).toContain("child_name");
    expect(r.writes[0]).toContain("Milo");
    expect(r.writes[0]).toContain("Ms. Shrestha");
    expect(r.audit).toHaveLength(1);
    expect(r.audit[0]!.action).toBe("lostfound.claim.created");
    // …and nowhere else: audit rows are forever, claims are swept.
    expect(JSON.stringify(r.audit[0])).not.toMatch(/Pat|example\.com|Milo|Shrestha|Dent/);
  });

  it("mails each configured address — the item's title and the queue link, never the claimant", async () => {
    const r = await post(claim, { notify: ["office@school.example", "pto@x.org"] });
    expect(r.json).toEqual({ ok: true });
    expect(r.sent.map((m) => m.to)).toEqual(["office@school.example", "pto@x.org"]);
    for (const m of r.sent) {
      expect(m.subject).toContain("Blue water bottle");
      expect(m.text).toContain("https://lostandfound.eisenhower.school/staff?claim=");
      // The claimant's name, contact, child, teacher and message stay behind
      // the session.
      expect(`${m.subject} ${m.text} ${m.html}`).not.toMatch(/Pat|example\.com|Milo|Shrestha|Dent/);
    }
  });

  it("mails nobody when no address is configured", async () => {
    expect((await post(claim)).sent).toEqual([]);
  });

  it("answers identically — and stores and mails nothing — for a honeypot, a cap, or an unlisted item", async () => {
    const notify = ["office@school.example"];
    for (const r of [
      await post({ ...claim, website: "http://spam" }, { notify }),
      await post(claim, { total: 50, notify }),
      await post(claim, { mine: 3, notify }),
      await post(claim, { open: 10, notify }),
      await post(claim, { item: row({ hidden_at: "2026-10-01T00:00:00Z" }), notify }),
      await post(claim, { item: row({ status: "returned" }), notify }),
      await post(claim, { item: row({ held_at: "2026-10-01T00:00:00Z" }), notify }),
      await post(claim, { item: null, notify }),
    ]) {
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ ok: true });
      expect(r.writes).toEqual([]);
      expect(r.audit).toEqual([]);
      expect(r.sent).toEqual([]);
    }
  });

  it("refuses a claim with no name or contact — about the caller's own input only", async () => {
    expect((await post({ name: "", contact: "pat@example.com" })).status).toBe(400);
    expect((await post({ name: "Pat", contact: "" })).status).toBe(400);
  });

  it("records the form's language, BUCKETED to LOCALES — never free text (migration 0044)", async () => {
    const es = await post({ ...claim, lang: "es" });
    expect(argsOf(es.writes[0]!)[8]).toBe("es");
    for (const lang of ["xx-pirate", "<script>", 42, undefined]) {
      const r = await post({ ...claim, lang });
      expect(argsOf(r.writes[0]!)[8]).toBe("en");
    }
  });

  it("marks the contact verified only when it IS the signed-in account's email", async () => {
    const me = auth("01U_PARENT"); // email 01U_PARENT@eisenhower.edu
    // Their own address, case aside → verified.
    const match = await post({ ...claim, contact: "01U_PARENT@EISENHOWER.edu" }, {}, me);
    expect(argsOf(match.writes[0]!)[9]).toBe(1);
    // Signed in but a different contact → not verified.
    expect(argsOf((await post(claim, {}, me)).writes[0]!)[9]).toBe(0);
    // Anonymous → not verified.
    expect(argsOf((await post(claim)).writes[0]!)[9]).toBe(0);
    // A masquerading admin typing the member's address → not verified: the
    // chip means the CLAIMANT was signed in with it, and this one wasn't.
    const masq = await post({ ...claim, contact: "01U_PARENT@eisenhower.edu" }, {}, { ...me, isMasquerading: true });
    expect(argsOf(masq.writes[0]!)[9]).toBe(0);
  });
});

describe("GET /lostfound-public/items/:id", () => {
  it("404s anything not currently listed", async () => {
    for (const item of [
      row({ hidden_at: "2026-10-01T00:00:00Z" }),
      row({ held_at: "2026-10-01T00:00:00Z" }),
      row({ status: "returned" }),
      null,
    ]) {
      const { env } = claimEnv({ item });
      const res = await call(appWith(null), "GET", "/lostfound-public/items/01ITEM", undefined, env);
      expect(res.status).toBe(404);
    }
  });
});

// ── The model never writes over staff ───────────────────────────────────────

describe("tagItem", () => {
  it("writes the model's answer only while the item is still pending, and records failure the same way", async () => {
    const sqls: string[] = [];
    const env = {
      AI: {
        run: async () => ({ response: { title: "Red mitten", category: "Hat, gloves, or scarf", colors: ["red"] } }),
      },
      DB: {
        prepare(sql: string) {
          return {
            bind: () => ({
              async first() {
                return null; // location lookup: none
              },
              async run() {
                sqls.push(sql);
                // Staff saved first: the guarded UPDATE matches nothing.
                return { meta: { changes: 0 } };
              },
            }),
          };
        },
      },
    } as unknown as HonoEnv["Bindings"];

    await tagItem(env, "01ITEM", new Uint8Array([0xff, 0xd8, 0xff]).buffer);
    expect(sqls).toHaveLength(1);
    expect(sqls[0]).toContain("AND tag_status = 'pending'");

    sqls.length = 0;
    const failing = { ...env, AI: { run: async () => ({ response: "not json" }) } } as unknown as HonoEnv["Bindings"];
    await tagItem(failing, "01ITEM", new Uint8Array([0xff, 0xd8, 0xff]).buffer);
    expect(sqls).toHaveLength(1);
    expect(sqls[0]).toMatch(/SET tag_status = 'failed'.*AND tag_status = 'pending'/s);
  });
});

describe("the hold (a name can be in the PHOTO)", () => {
  async function aiWrite(response: Record<string, unknown>) {
    const sqls: string[] = [];
    const env = {
      AI: { run: async () => ({ response }) },
      DB: {
        prepare(sql: string) {
          return {
            bind: () => ({
              first: async () => null,
              run: async () => {
                sqls.push(sql);
                return { meta: { changes: 1 } };
              },
            }),
          };
        },
      },
    } as unknown as HonoEnv["Bindings"];
    await tagItem(env, "01ITEM", new Uint8Array([0xff, 0xd8, 0xff]).buffer);
    return sqls[0]!;
  }

  it("is released by the model only when it reads no writing AND never read any before AND staff submitted it", async () => {
    // SET expressions see the OLD row, so this releases only an item whose
    // stored visible_text was empty — a retag that misses a name it read the
    // first time leaves the hold for staff. A member-submitted item is never
    // released by the model at all (migration 0037): only staff publish it.
    expect(await aiWrite({ title: "Red mitten" })).toContain(
      "held_at = CASE WHEN visible_text = '' AND member_submitted = 0 THEN NULL ELSE held_at END",
    );
  });

  it("is kept when the model read writing", async () => {
    expect(await aiWrite({ title: "Red mitten", visible_text: "AVA" })).toContain("held_at = COALESCE(held_at, ?)");
  });

  it("is kept for NON-NAME writing too — the narrower scrub (migration 0038) leans on this", async () => {
    // Only `name_text` is scrubbed from public fields now, so the hold is the
    // one guarantee left when the model misfiles a name as a brand: staff see
    // the photo before anything goes public.
    const sql = await aiWrite({ title: "Gray hoodie", visible_text: "NIKE", name_text: "" });
    expect(sql).toContain("held_at = COALESCE(held_at, ?)");
  });

  it("is never touched by a staff save — publishing is its own act", async () => {
    let sql = "";
    const env = {
      DB: {
        prepare(s: string) {
          sql = s;
          return { bind: () => ({ run: async () => ({ meta: { changes: 1 } }) }) };
        },
      },
    } as unknown as HonoEnv["Bindings"];
    await saveFields(env, "01ITEM", cleanFields({ title: "Mitten" }), { location: "Gym" });
    expect(sql).not.toContain("held_at");
  });

  it("is part of the public listing gate, in SQL and for a row in hand", () => {
    expect(LISTED).toContain("held_at IS NULL");
    expect(isListed(row())).toBe(true);
    expect(isListed(row({ held_at: "2026-10-01T00:00:00Z" }))).toBe(false);
    expect(isListed(row({ hidden_at: "2026-10-01T00:00:00Z" }))).toBe(false);
    expect(isListed(row({ status: "returned" }))).toBe(false);
  });
});

describe("the suggested rotation", () => {
  async function aiWrite(response: Record<string, unknown>) {
    const writes: { sql: string; args: unknown[] }[] = [];
    const env = {
      AI: { run: async () => ({ response }) },
      DB: {
        prepare(sql: string) {
          return {
            bind: (...args: unknown[]) => ({
              first: async () => null,
              run: async () => {
                writes.push({ sql, args });
                return { meta: { changes: 1 } };
              },
            }),
          };
        },
      },
    } as unknown as HonoEnv["Bindings"];
    await tagItem(env, "01ITEM", new Uint8Array([0xff, 0xd8, 0xff]).buffer);
    return writes[0]!;
  }

  it("is snapped to a quarter turn, and anything else means leave it", () => {
    expect([0, 90, 180, 270].map(cleanRotation)).toEqual([0, 90, 180, 270]);
    expect(cleanRotation("90")).toBe(90);
    for (const v of [45, -90, 360, "sideways", null, undefined]) expect(cleanRotation(v)).toBe(0);
  });

  it("cleans a crop: padded, clamped, and null for anything unusable", () => {
    const c = cleanCrop({ left: 0.3, top: 0.3, right: 0.6, bottom: 0.7 })!;
    expect(c.x).toBeCloseTo(0.3 - CROP_PADDING, 3);
    expect(c.w).toBeCloseTo(0.3 + 2 * CROP_PADDING, 3);
    expect(c.y + c.h).toBeCloseTo(0.7 + CROP_PADDING, 3);
    // Padding never leaves the photo.
    expect(cleanCrop({ left: 0, top: 0, right: 0.5, bottom: 0.5 })).toMatchObject({ x: 0, y: 0 });
    // Percentages, as models sometimes answer.
    expect(cleanCrop({ left: 30, top: 30, right: 60, bottom: 70 })).toEqual(c);
    // Strings are read like the rotation's.
    expect(cleanCrop({ left: "0.3", top: "0.3", right: "0.6", bottom: "0.7" })).toEqual(c);
    for (const v of [
      null,
      "box",
      {},
      { left: 0.6, top: 0.3, right: 0.3, bottom: 0.7 }, // inverted
      { left: 0.4, top: 0.4, right: 0.5, bottom: 0.5 }, // a logo, not the item
      { left: 0.02, top: 0.02, right: 0.98, bottom: 0.98 }, // fills the frame
      { left: -1, top: 0, right: 0.5, bottom: 0.5 },
      { left: NaN, top: 0, right: 0.5, bottom: 0.5 },
    ]) {
      expect(cleanCrop(v)).toBeNull();
    }
  });

  it("reads a stored crop back, or null when the cell is bad", () => {
    expect(parseCrop(JSON.stringify({ x: 0.1, y: 0.2, w: 0.5, h: 0.6 }))).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.6 });
    for (const v of [null, "", "not json", "{}", JSON.stringify({ x: 0.9, y: 0, w: 0.5, h: 0.5 })]) {
      expect(parseCrop(v)).toBeNull();
    }
  });

  it("saves the crop with the model's write, ahead of the rotation", async () => {
    const w = await aiWrite({
      title: "Red mitten",
      rotation: 90,
      crop: { left: 0.3, top: 0.3, right: 0.6, bottom: 0.7 },
    });
    expect(w.sql).toMatch(/suggested_crop = \?, suggested_rotation = \?.*AND tag_status = 'pending'/s);
    expect(w.args.slice(-3)).toEqual([expect.stringContaining('"x"'), 90, "01ITEM"]);
  });

  it("rides the model's guarded write, so staff edits made first still win", async () => {
    const w = await aiWrite({ title: "Red mitten", rotation: 270 });
    expect(w.sql).toMatch(/suggested_rotation = \?.*AND tag_status = 'pending'/s);
    // The id is last; the rotation is the bind just before it.
    expect(w.args.slice(-2)).toEqual([270, "01ITEM"]);
  });

  it("is never written by a staff save", async () => {
    let sql = "";
    const env = {
      DB: {
        prepare(s: string) {
          sql = s;
          return { bind: () => ({ run: async () => ({ meta: { changes: 1 } }) }) };
        },
      },
    } as unknown as HonoEnv["Bindings"];
    await saveFields(env, "01ITEM", cleanFields({ title: "Mitten" }), { location: "Gym" });
    expect(sql).not.toContain("suggested_rotation");
    expect(sql).not.toContain("suggested_crop");
  });

  it("is staff-only", () => {
    const ORIGIN = "https://api-directory.eisenhower.school";
    const r = row({ suggested_rotation: 90 });
    expect(staffItemOf({ ...r, open_claims: 0, created_by_email: null }, ORIGIN).suggestedRotation).toBe(90);
    expect(publicItemOf(r, ORIGIN)).not.toHaveProperty("suggestedRotation");
    const withCrop = row({ suggested_crop: JSON.stringify({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }) });
    expect(staffItemOf({ ...withCrop, open_claims: 0, created_by_email: null }, ORIGIN).suggestedCrop).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
    expect(publicItemOf(withCrop, ORIGIN)).not.toHaveProperty("suggestedCrop");
  });
});

describe("itemIdOfKey (the public photo route's gate)", () => {
  it("maps a photo or thumbnail key to its item, and nothing else", () => {
    const id = "01M3Z5G57Q0DGBMRZVE1FSSSMS";
    expect(itemIdOfKey(`${id}.jpg`)).toBe(id);
    expect(itemIdOfKey(`${id}-thumb.jpg`)).toBe(id);
    expect(itemIdOfKey(`${id}-mfx1k2a.jpg`)).toBe(id);
    expect(itemIdOfKey(`${id}-mfx1k2a-thumb.jpg`)).toBe(id);
    expect(itemIdOfKey(`${id}-../x.jpg`)).toBeNull();
    expect(itemIdOfKey("../secret.jpg")).toBeNull();
    expect(itemIdOfKey(`${id}.png`)).toBeNull();
  });
});

// ── Bulk actions (the dashboard's selection mode) ───────────────────────────
// POST /lostfound/items/bulk must stay a thin fan-out of what the single-item
// routes already do: the SAME guarded transition SQL per id, audit drafts only
// for rows that actually changed, `deleteItem` for deletes. These tests are
// behavioural — the fake D1 evaluates nothing, it records statements where they
// execute and answers `meta.changes` per id, so a bulk route that stopped
// asking the CAS guard or started auditing no-ops fails loudly.

function bulkEnv(opts: {
  unchanged?: string[];
  deletable?: Array<{ id: string; photo_key: string; thumb_key: string | null }>;
} = {}) {
  const writes: { sql: string; args: unknown[] }[] = [];
  const batches: number[] = [];
  const media: string[] = [];
  type Stmt = { run: () => Promise<{ meta: { changes: number } }> };
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind: (...args: unknown[]) => ({
            async first() {
              if (sql.includes("FROM setting")) return { value: GROUP };
              if (sql.includes("FROM grp")) return { id: GROUP, name: "Front office" };
              if (sql.includes("FROM membership m")) return { ok: 1 };
              throw new Error(`bulkEnv: unhandled first: ${sql}`);
            },
            async all() {
              if (sql.startsWith("SELECT id, photo_key, thumb_key FROM lf_item")) {
                return { results: (opts.deletable ?? []).filter((r) => args.includes(r.id)) };
              }
              throw new Error(`bulkEnv: unhandled all: ${sql}`);
            },
            async run() {
              writes.push({ sql, args });
              return { meta: { changes: (opts.unchanged ?? []).some((id) => args.includes(id)) ? 0 : 1 } };
            },
          }),
        };
      },
      async batch(stmts: Stmt[]) {
        batches.push(stmts.length);
        const out = [];
        for (const s of stmts) out.push(await s.run());
        return out;
      },
    },
    LOSTFOUND_MEDIA: {
      delete: async (keys: string | string[]) => void media.push(...(Array.isArray(keys) ? keys : [keys])),
    },
  } as unknown as HonoEnv["Bindings"];
  return { env, writes, batches, media };
}

describe("POST /lostfound/items/bulk", () => {
  async function bulkCall(body: unknown, opts: Parameters<typeof bulkEnv>[0] = {}) {
    const audit: AuditDraft[] = [];
    const fake = bulkEnv(opts);
    const res = await call(appWith(auth("01U_STAFF"), audit), "POST", "/lostfound/items/bulk", body, fake.env);
    return { res, audit, ...fake };
  }

  it("rides the single route's guarded SQL per id, in ONE batch, and audits only the rows that changed", async () => {
    const { res, audit, writes, batches } = await bulkCall(
      { ids: ["01AAA", "01BBB", "01CCC"], action: "publish" },
      { unchanged: ["01BBB"] },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, changed: 2 });
    expect(batches).toEqual([3]);
    expect(writes).toHaveLength(3);
    for (const w of writes) {
      expect(w.sql).toContain("SET held_at = NULL");
      expect(w.sql).toContain("AND held_at IS NOT NULL"); // the CAS guard — a repeat records nothing
    }
    expect(audit.map((d) => [d.action, d.entityId])).toEqual([
      ["lostfound.item.published", "01AAA"],
      ["lostfound.item.published", "01CCC"],
    ]);
  });

  it("a bulk return settles open claims for the CHANGED items only, like the single route", async () => {
    const { res, writes } = await bulkCall(
      { ids: ["01AAA", "01BBB"], action: "return" },
      { unchanged: ["01BBB"] },
    );
    expect(res.status).toBe(200);
    const claims = writes.filter((w) => w.sql.includes("UPDATE lf_claim"));
    expect(claims).toHaveLength(1);
    expect(claims[0]!.args).toContain("01AAA");
  });

  it("a bulk delete runs deleteItem per found row — row, photos — and audits each", async () => {
    const deletable = [
      { id: "01AAA", photo_key: "01AAA.jpg", thumb_key: "01AAA-thumb.jpg" },
      { id: "01BBB", photo_key: "01BBB.jpg", thumb_key: null },
    ];
    const { res, audit, writes, media } = await bulkCall(
      { ids: ["01AAA", "01BBB", "01GONE"], action: "delete" },
      { deletable },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, changed: 2 });
    expect(writes.filter((w) => w.sql.includes("DELETE FROM lf_item"))).toHaveLength(2);
    expect([...media].sort()).toEqual(["01AAA-thumb.jpg", "01AAA.jpg", "01BBB.jpg"]);
    expect(audit.map((d) => [d.action, d.entityId])).toEqual([
      ["lostfound.item.deleted", "01AAA"],
      ["lostfound.item.deleted", "01BBB"],
    ]);
  });

  it("refuses an empty list, an unknown action (a prototype name included), retag, and too many ids", async () => {
    const bodies: unknown[] = [
      { ids: [], action: "publish" },
      { ids: ["01AAA"], action: "donate" },
      // `constructor` exists on every object; the route must not find it.
      { ids: ["01AAA"], action: "constructor" },
      // Re-running the model is deliberately a one-item judgement.
      { ids: ["01AAA"], action: "retag" },
      { ids: Array.from({ length: 51 }, (_, i) => `01ID${String(i).padStart(3, "0")}`), action: "publish" },
    ];
    for (const body of bodies) {
      const { res, writes, audit } = await bulkCall(body);
      expect(res.status).toBe(400);
      expect(writes).toEqual([]);
      expect(audit).toEqual([]);
    }
  });
});

// ── Returning an item against a claim, and telling the family ───────────────
// The notify route (migration 0044): the same guarded return transition the
// item routes run, then ONE email to the claimant — claimed by CAS on
// `notified_at`, released on a failed send, in the claim's own language,
// naming the item and never a child.

function claimJoinRow(over: Partial<LfClaimRow & { item_title: string }> = {}): LfClaimRow & { item_title: string } {
  return {
    id: "01CLAIM",
    item_id: "01ITEM",
    name: "Pat",
    contact: "pat@example.com",
    child_name: "Milo",
    teacher: "Ms. Shrestha",
    message: "Dent on the bottom",
    lang: "en",
    contact_verified: 0,
    notified_at: null,
    created_at: "2026-11-01T15:00:00.000Z",
    resolved_at: null,
    resolution: null,
    item_title: "Blue water bottle",
    ...over,
  };
}

function returnEnv(opts: {
  claim?: Partial<LfClaimRow & { item_title: string }> | null;
  itemChanges?: number;
  notifyChanges?: number;
  sendFails?: boolean;
  /** The item's OTHER open claims (the count the route reports). */
  others?: number;
  /** Leave the mail channel unconfigured — the route must say so, not "sent". */
  channelOff?: boolean;
} = {}) {
  const writes: { sql: string; args: unknown[] }[] = [];
  const sent: Array<{ to: string; subject: string; text: string; html: string }> = [];
  type Stmt = { run: () => Promise<{ meta: { changes: number } }> };
  const env = {
    ...(opts.channelOff
      ? {}
      : {
          BULK_EMAIL_FROM: "Lost & Found <lostfound@sitemail.eisenhower.school>",
          EMAIL: {
            send: async (msg: (typeof sent)[number]) => {
              if (opts.sendFails) throw new Error("smtp down");
              sent.push(msg);
            },
          },
        }),
    SCHOOL_NAME: "Eisenhower PTO",
    DB: {
      prepare(sql: string) {
        return {
          bind: (...args: unknown[]) => ({
            async first() {
              if (sql.includes("FROM setting")) return { value: GROUP };
              if (sql.includes("FROM grp")) return { id: GROUP, name: "Front office" };
              if (sql.includes("FROM membership m")) return { ok: 1 };
              if (sql.includes("FROM lf_claim cl JOIN lf_item")) {
                return opts.claim === null ? null : claimJoinRow(opts.claim);
              }
              if (sql.includes("SELECT COUNT(*) AS n FROM lf_claim")) return { n: opts.others ?? 0 };
              throw new Error(`returnEnv: unhandled first: ${sql}`);
            },
            async run() {
              writes.push({ sql, args });
              if (sql.includes("UPDATE lf_item")) return { meta: { changes: opts.itemChanges ?? 1 } };
              if (sql.includes("SET notified_at = ?")) return { meta: { changes: opts.notifyChanges ?? 1 } };
              return { meta: { changes: 1 } };
            },
          }),
        };
      },
      async batch(stmts: Stmt[]) {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        return out;
      },
    },
  } as unknown as HonoEnv["Bindings"];
  return { env, writes, sent };
}

describe("POST /lostfound/claims/:id/return", () => {
  async function post(body: unknown, opts: Parameters<typeof returnEnv>[0] = {}) {
    const audit: AuditDraft[] = [];
    const fake = returnEnv(opts);
    const res = await call(appWith(auth("01U_STAFF"), audit), "POST", "/lostfound/claims/01CLAIM/return", body, fake.env);
    return { status: res.status, json: await res.json(), audit, ...fake };
  }

  it("marks the item returned, settles its claims, and emails the claimant — in the claim's language, naming no child", async () => {
    const r = await post({ method: "classroom" }, { claim: { lang: "es" } });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, notified: true, otherOpenClaims: 0 });
    // The same guarded transition the item route runs…
    expect(r.writes.some((w) => w.sql.includes("SET status = 'returned'") && w.sql.includes("AND status = 'found'"))).toBe(true);
    // …settling every open claim on the item…
    expect(r.writes.some((w) => w.sql.includes("resolution = 'returned'"))).toBe(true);
    // …and the CAS claim on the send, so a double-tap mails nobody twice.
    expect(r.writes.some((w) => w.sql.includes("SET notified_at = ? WHERE id = ? AND notified_at IS NULL"))).toBe(true);
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]!.to).toBe("pat@example.com");
    // The claim was filled in Spanish; the answer is Spanish.
    expect(r.sent[0]!.subject).toContain("camino");
    expect(r.sent[0]!.text).toContain("Blue water bottle");
    // Item and school only — never the claimant, the child, the room or the
    // message (a mistyped address must not deliver a child's name).
    expect(`${r.sent[0]!.subject} ${r.sent[0]!.text} ${r.sent[0]!.html}`).not.toMatch(/Pat|Milo|Shrestha|Dent/);
    expect(r.audit.map((d) => d.action)).toEqual(["lostfound.item.returned", "lostfound.claim.return_notified"]);
    expect(r.audit[1]!.detail).toEqual({ itemId: "01ITEM", method: "classroom" });
    // Claimant fields never reach a row that lives forever (migration 0043's rule).
    expect(JSON.stringify(r.audit)).not.toMatch(/Pat|example\.com|Milo|Shrestha|Dent/);
  });

  it("notify: false marks returned and mails nobody", async () => {
    const r = await post({ method: "office", notify: false });
    expect(r.json).toEqual({ ok: true, notified: false, otherOpenClaims: 0 });
    expect(r.sent).toEqual([]);
    expect(r.writes.some((w) => w.sql.includes("notified_at"))).toBe(false);
    expect(r.audit.map((d) => d.action)).toEqual(["lostfound.item.returned"]);
  });

  it("a non-email contact is never mailed — the manual links are the path", async () => {
    const r = await post({ method: "classroom" }, { claim: { contact: "612-555-0100 after 3pm" } });
    expect(r.json).toEqual({ ok: true, notified: false, reason: "not_email", otherOpenClaims: 0 });
    expect(r.sent).toEqual([]);
    expect(r.writes.some((w) => w.sql.includes("notified_at"))).toBe(false);
  });

  it("an already-notified claim mails nobody twice (the CAS lost)", async () => {
    const r = await post({ method: "classroom" }, { notifyChanges: 0 });
    expect(r.json).toEqual({ ok: true, notified: false, reason: "already_notified", otherOpenClaims: 0 });
    expect(r.sent).toEqual([]);
    expect(r.audit.map((d) => d.action)).toEqual(["lostfound.item.returned"]);
  });

  it("a failed send releases its own claim — matched by value — and records no notification", async () => {
    const r = await post({ method: "classroom" }, { sendFails: true });
    expect(r.json).toEqual({ ok: true, notified: false, reason: "send_failed", otherOpenClaims: 0 });
    const release = r.writes.find((w) => w.sql.includes("SET notified_at = NULL"));
    expect(release).toBeDefined();
    expect(release!.sql).toContain("AND notified_at = ?");
    expect(r.audit.map((d) => d.action)).toEqual(["lostfound.item.returned"]);
  });

  it("an item already returned (the transition's CAS lost) still notifies, and re-audits nothing", async () => {
    const r = await post({ method: "office" }, { itemChanges: 0 });
    expect(r.json).toEqual({ ok: true, notified: true, otherOpenClaims: 0 });
    expect(r.sent).toHaveLength(1);
    // No second lostfound.item.returned, and the claim-settling batch never ran.
    expect(r.audit.map((d) => d.action)).toEqual(["lostfound.claim.return_notified"]);
    expect(r.writes.some((w) => w.sql.includes("resolution = 'returned'"))).toBe(false);
  });

  it("refuses an unknown method and a missing claim", async () => {
    expect((await post({ method: "donate" })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ method: "classroom" }, { claim: null })).status).toBe(404);
  });

  it("refuses a DISMISSED claim — staff judged that person not the owner, and a stale tab must not mail them 'good news'", async () => {
    const r = await post(
      { method: "classroom" },
      { claim: { resolved_at: "2026-11-02T10:00:00.000Z", resolution: "dismissed" } },
    );
    expect(r.status).toBe(409);
    expect(r.sent).toEqual([]);
    expect(r.writes).toEqual([]);
    expect(r.audit).toEqual([]);
  });

  it("reports how many OTHER open claims the return settled with no message of their own", async () => {
    const r = await post({ method: "classroom" }, { others: 2 });
    expect(r.json).toEqual({ ok: true, notified: true, otherOpenClaims: 2 });
  });

  it("a mail channel that is off answers channel_off — never 'emailed them' about a logged message — and claims no send", async () => {
    const r = await post({ method: "classroom" }, { channelOff: true });
    expect(r.json).toEqual({ ok: true, notified: false, reason: "channel_off", otherOpenClaims: 0 });
    expect(r.writes.some((w) => w.sql.includes("notified_at"))).toBe(false);
    expect(r.audit.map((d) => d.action)).toEqual(["lostfound.item.returned"]);
  });
});

// ── The shared return message ───────────────────────────────────────────────

describe("lostFoundReturnMessage (@sd/shared)", () => {
  it("renders subject and body in the claim's language, naming the item and the school", () => {
    for (const [locale, probe] of [
      ["en", "on its way"],
      ["es", "camino"],
      ["zh", "正在归还"],
      ["so", "soo socotaa"],
    ] as const) {
      const m = lostFoundReturnMessage(locale, "classroom", "Blue water bottle");
      expect(m.subject).toContain(probe);
      expect(m.subject).toContain("Blue water bottle");
      expect(m.body).toContain("Blue water bottle");
      expect(m.body).toContain("Eisenhower");
    }
  });

  it("an untitled item falls back to prose, not the browse grid's progress placeholder", () => {
    const m = lostFoundReturnMessage("en", "classroom", "  ");
    expect(m.subject).toContain("the item you claimed");
    expect(m.body).not.toContain("Being described");
  });

  it("each method gets its own sentence", () => {
    const bodies = (["classroom", "office", "family"] as const).map(
      (m) => lostFoundReturnMessage("en", m, "Blue water bottle").body,
    );
    expect(new Set(bodies).size).toBe(3);
  });

  it("the contact-shape rules behind 'email them' vs the manual links", () => {
    expect(lfContactIsEmail("pat@example.com")).toBe(true);
    expect(lfContactIsEmail(" pat@example.com ")).toBe(true);
    expect(lfContactIsEmail("612-555-0100")).toBe(false);
    expect(lfContactIsEmail("pat at example")).toBe(false);
    expect(lfContactPhone("(612) 555-0100")).toBe("6125550100");
    expect(lfContactPhone("+1 612.555.0100")).toBe("+16125550100");
    expect(lfContactPhone("pat@example.com")).toBeNull();
    expect(lfContactPhone("call me")).toBeNull();
  });
});
