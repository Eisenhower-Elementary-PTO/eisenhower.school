// The suite-wide admin metrics read (GET /admin/metrics, lib/suiteMetrics.ts).
//
// Three properties worth defending:
//
//   1. The gate: system admins only — a plain member gets a 403, byte-free.
//   2. The shape: aggregates top to bottom. The response must never carry an
//      identity, so the test seeds real-looking names/emails into every table
//      it fakes and asserts none of them survive into the JSON.
//   3. The arithmetic: each counter evaluates its own predicate (disabled
//      excluded from "approved", drafts excluded from "published", unpaid
//      orders excluded from revenue, the 30-day cutoffs actually bound) — the
//      fake D1 evaluates WHERE clauses from seeded rows rather than returning
//      canned numbers, so a dropped predicate fails with a wrong count.

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { admin } from "../src/routes/admin.js";
import { suiteMetrics } from "../src/lib/suiteMetrics.js";
import { schoolDay } from "../src/lib/newsletterMetrics.js";
import type { AuthContext, HonoEnv } from "../src/env.js";

const NOW = new Date("2026-11-08T18:00:00Z");
const RECENT = "2026-11-01T12:00:00Z"; // inside the 30-day window
const OLD = "2020-01-01T00:00:00Z"; // far outside it

interface Rows {
  users: {
    email: string;
    created_at: string;
    disabled_at: string | null;
    is_system_admin: number;
    access_submitted_at: string | null;
    access_approved_at: string | null;
    access_declined_at: string | null;
  }[];
  persons: { first_name: string; unlisted_at: string | null }[];
  groups: { kind: string }[];
  managedCalendars: number;
  managedEvents: number;
  sources: number;
  calendarEvents: { starts_at: string }[];
  sheets: { published_at: string | null }[];
  signups: { created_at: string }[];
  subscribers: { email: string; unsubscribed_at: string | null }[];
  issues: { sent_at: string | null }[];
  views: { day: string; views: number }[];
  orders: { paid_at: string | null; total_cents: number; status: string }[];
  boards: { archived_at: string | null }[];
  cards: { archived_at: string | null }[];
  items: { status: string; hidden_at: string | null; held_at: string | null }[];
  claims: { resolved_at: string | null }[];
  audit: { created_at: string }[];
}

function fakeDb(rows: Rows) {
  const exec = (sql: string, args: unknown[]): { results: unknown[]; meta: { changes: number } } => {
    const row = (r: Record<string, number>) => ({ results: [r], meta: { changes: 0 } });

    if (sql.includes("FROM user")) {
      const cutoff = String(args[0]);
      const u = rows.users;
      return row({
        total: u.length,
        disabled: u.filter((x) => x.disabled_at !== null).length,
        admins: u.filter((x) => x.is_system_admin === 1 && x.disabled_at === null).length,
        approved: u.filter((x) => x.access_approved_at !== null && x.disabled_at === null).length,
        pending: u.filter(
          (x) =>
            x.access_submitted_at !== null &&
            x.access_approved_at === null &&
            x.access_declined_at === null &&
            x.disabled_at === null,
        ).length,
        new_30d: u.filter((x) => x.created_at >= cutoff).length,
      });
    }
    if (sql.includes("FROM person")) {
      return row({
        total: rows.persons.length,
        unlisted: rows.persons.filter((p) => p.unlisted_at !== null).length,
      });
    }
    if (sql.includes("FROM grp GROUP BY kind")) {
      const byKind = new Map<string, number>();
      for (const g of rows.groups) byKind.set(g.kind, (byKind.get(g.kind) ?? 0) + 1);
      return { results: [...byKind.entries()].map(([kind, n]) => ({ kind, n })), meta: { changes: 0 } };
    }
    if (sql.includes("FROM managed_calendar")) {
      const nowIso = String(args[0]);
      return row({
        calendars: rows.managedCalendars,
        managed_events: rows.managedEvents,
        sources: rows.sources,
        upcoming: rows.calendarEvents.filter((e) => e.starts_at >= nowIso).length,
      });
    }
    if (sql.includes("FROM volunteer_sheet")) {
      const cutoff = String(args[0]);
      return row({
        sheets: rows.sheets.filter((s) => s.published_at !== null).length,
        signups: rows.signups.length,
        signups_30d: rows.signups.filter((s) => s.created_at >= cutoff).length,
      });
    }
    if (sql.includes("FROM newsletter_subscriber")) {
      const cutoffDay = String(args[0]);
      return row({
        subscribers: rows.subscribers.filter((s) => s.unsubscribed_at === null).length,
        issues_sent: rows.issues.filter((i) => i.sent_at !== null).length,
        views: rows.views.reduce((a, v) => a + v.views, 0),
        views_30d: rows.views.filter((v) => v.day >= cutoffDay).reduce((a, v) => a + v.views, 0),
      });
    }
    if (sql.includes("FROM store_order")) {
      const cutoff = String(args[0]);
      const paid = rows.orders.filter((o) => o.paid_at !== null);
      return row({
        paid: paid.length,
        revenue_cents: paid.reduce((a, o) => a + o.total_cents, 0),
        paid_30d: paid.filter((o) => (o.paid_at as string) >= cutoff).length,
        failed: paid.filter((o) => o.status === "fulfillment_failed").length,
      });
    }
    if (sql.includes("FROM pto_board")) {
      return row({
        boards: rows.boards.filter((b) => b.archived_at === null).length,
        cards: rows.cards.filter((c) => c.archived_at === null).length,
      });
    }
    if (sql.includes("FROM lf_item")) {
      // The public listing's predicate must be COMPOSED from lib/lostFound.ts,
      // not restated — evaluate exactly it, and fail if the statement stopped
      // carrying it.
      expect(sql).toContain("status = 'found' AND hidden_at IS NULL AND held_at IS NULL");
      return row({
        listed: rows.items.filter((i) => i.status === "found" && i.hidden_at === null && i.held_at === null).length,
        held: rows.items.filter((i) => i.status === "found" && i.held_at !== null).length,
        returned: rows.items.filter((i) => i.status === "returned").length,
        open_claims: rows.claims.filter((c) => c.resolved_at === null).length,
      });
    }
    if (sql.includes("FROM audit_log")) {
      const cutoff = String(args[0]);
      return row({ n: rows.audit.filter((a) => a.created_at >= cutoff).length });
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
      _exec() {
        return exec(sql, binds);
      },
    };
    return stmt;
  };

  return {
    prepare,
    async batch(stmts: ReturnType<typeof prepare>[]) {
      return stmts.map((s) => s._exec());
    },
  };
}

function env(db: unknown): HonoEnv["Bindings"] {
  return { SCHOOL_TIMEZONE: "America/Chicago", DB: db } as HonoEnv["Bindings"];
}

function app(auth: AuthContext): Hono<HonoEnv> {
  const a = new Hono<HonoEnv>();
  a.use("*", async (c, next) => {
    c.set("audit", []);
    c.set("auth", auth);
    await next();
  });
  a.route("/admin", admin);
  return a;
}

const adminAuth: AuthContext = {
  userId: "01U_ADMIN",
  realUserId: "01U_ADMIN",
  email: "admin@eisenhower.edu",
  isSystemAdmin: true,
  sessionId: "01SESSION",
  activePersonId: null,
  isMasquerading: false,
  isApproved: true,
};
const memberAuth: AuthContext = { ...adminAuth, userId: "01U_MEMBER", realUserId: "01U_MEMBER", email: "member@example.com", isSystemAdmin: false };

/** Seeds whose names/emails must never appear in the response. */
function seed(bindings: HonoEnv["Bindings"]): Rows {
  const today = schoolDay(bindings, NOW);
  return {
    users: [
      { email: "admin@eisenhower.edu", created_at: OLD, disabled_at: null, is_system_admin: 1, access_submitted_at: OLD, access_approved_at: OLD, access_declined_at: null },
      { email: "milo.ruiz@example.com", created_at: RECENT, disabled_at: null, is_system_admin: 0, access_submitted_at: RECENT, access_approved_at: RECENT, access_declined_at: null },
      { email: "gone@example.com", created_at: OLD, disabled_at: OLD, is_system_admin: 0, access_submitted_at: OLD, access_approved_at: OLD, access_declined_at: null },
      { email: "waiting@example.com", created_at: OLD, disabled_at: null, is_system_admin: 0, access_submitted_at: OLD, access_approved_at: null, access_declined_at: null },
      { email: "declined@example.com", created_at: OLD, disabled_at: null, is_system_admin: 0, access_submitted_at: OLD, access_approved_at: null, access_declined_at: OLD },
    ],
    persons: [
      { first_name: "Milo", unlisted_at: null },
      { first_name: "Vera", unlisted_at: null },
      { first_name: "Hidden", unlisted_at: OLD },
    ],
    groups: [{ kind: "household" }, { kind: "household" }, { kind: "classroom" }, { kind: "classroom" }, { kind: "classroom" }, { kind: "generic" }],
    managedCalendars: 1,
    managedEvents: 4,
    sources: 2,
    calendarEvents: [{ starts_at: "2026-11-09T00:00:00Z" }, { starts_at: "2026-12-01T00:00:00Z" }, { starts_at: OLD }],
    sheets: [{ published_at: OLD }, { published_at: RECENT }, { published_at: null }],
    signups: [{ created_at: OLD }, { created_at: OLD }, { created_at: RECENT }],
    subscribers: [
      { email: "reader@example.com", unsubscribed_at: null },
      { email: "also@example.com", unsubscribed_at: null },
      { email: "left@example.com", unsubscribed_at: OLD },
    ],
    issues: [{ sent_at: OLD }, { sent_at: RECENT }, { sent_at: null }],
    views: [
      { day: today, views: 7 },
      { day: "2020-01-01", views: 5 },
    ],
    orders: [
      { paid_at: RECENT, total_cents: 2500, status: "paid" },
      { paid_at: OLD, total_cents: 1000, status: "shipped" },
      { paid_at: OLD, total_cents: 3000, status: "fulfillment_failed" },
      { paid_at: null, total_cents: 9999, status: "awaiting_payment" },
    ],
    boards: [{ archived_at: null }, { archived_at: null }, { archived_at: OLD }],
    cards: [
      { archived_at: null }, { archived_at: null }, { archived_at: null },
      { archived_at: null }, { archived_at: null }, { archived_at: OLD },
    ],
    items: [
      { status: "found", hidden_at: null, held_at: null },
      { status: "found", hidden_at: null, held_at: null },
      { status: "found", hidden_at: null, held_at: RECENT },
      { status: "found", hidden_at: RECENT, held_at: null },
      { status: "returned", hidden_at: null, held_at: null },
    ],
    claims: [{ resolved_at: null }, { resolved_at: null }, { resolved_at: OLD }],
    audit: [{ created_at: RECENT }, { created_at: RECENT }, { created_at: RECENT }, { created_at: OLD }],
  };
}

describe("GET /admin/metrics", () => {
  it("refuses a plain member", async () => {
    const bindings = env(fakeDb(seed(env(null))));
    const res = await app(memberAuth).request("/admin/metrics", {}, bindings);
    expect(res.status).toBe(403);
  });

  it("aggregates every app, each predicate doing its job", async () => {
    const bindings = env(null);
    const rows = seed(bindings);
    bindings.DB = fakeDb(rows) as unknown as typeof bindings.DB;

    const metrics = await suiteMetrics(bindings, NOW);
    expect(metrics).toEqual({
      directory: {
        accounts: 5,
        disabledAccounts: 1,
        admins: 1,
        approvedAccounts: 2, // disabled-but-approved excluded
        pendingAccessRequests: 1, // declined and approved both excluded
        newAccounts30d: 1,
        people: 3,
        unlistedPeople: 1,
        households: 2,
        classrooms: 3,
      },
      calendar: { calendars: 1, managedEvents: 4, importedSources: 2, upcomingOccurrences: 2 },
      volunteers: { publishedSheets: 2, signups: 3, signups30d: 1 },
      newsletter: { subscribers: 2, issuesSent: 2, archiveViews: 12, archiveViews30d: 7 },
      store: { paidOrders: 3, paidOrders30d: 1, revenueCents: 6500, fulfillmentFailed: 1 },
      pto: { boards: 2, openCards: 5 },
      lostAndFound: { listed: 2, awaitingReview: 1, returned: 1, openClaims: 2 },
      auditEvents30d: 3,
    });
  });

  it("serves an admin numbers and nothing that names anyone", async () => {
    const bindings = env(null);
    bindings.DB = fakeDb(seed(bindings)) as unknown as typeof bindings.DB;
    const res = await app(adminAuth).request("/admin/metrics", {}, bindings);
    expect(res.status).toBe(200);

    const text = await res.text();
    const body = JSON.parse(text) as { metrics: Record<string, unknown> };
    expect(body.metrics).toBeTruthy();
    // The seeds put names and addresses in every faked table; none may reach
    // the wire. "Numbers, never identities" — invariant 21's carve-out is the
    // whole licence this endpoint has.
    for (const needle of ["milo", "ruiz", "vera", "example.com", "eisenhower.edu", "@"]) {
      expect(text.toLowerCase()).not.toContain(needle);
    }
  });
});
