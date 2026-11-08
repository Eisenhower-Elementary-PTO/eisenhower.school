// One read across the whole suite, for the admin metrics screen
// (GET /admin/metrics — system admins only; the route holds the gate).
//
// Every statement here is an aggregate: COUNT and SUM, numbers never
// identities — the same carve-out invariant 21 makes for `member_count`. No
// name, email, address or free text is selected anywhere in this file, so the
// DTO cannot grow a "who" without someone editing a projection on purpose.
//
// No audit draft: this is a read, and `read_budget`'s reasoning applies — an
// admin glancing at counters is not a member action worth a hash-chained row.

import type { SuiteMetricsDTO } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { LISTED } from "./lostFound.js";
import { schoolDay } from "./newsletterMetrics.js";

type Env = HonoEnv["Bindings"];

/** The "recent" window every `…30d` field shares. */
const WINDOW_DAYS = 30;

export async function suiteMetrics(env: Env, now: Date = new Date()): Promise<SuiteMetricsDTO> {
  const cutoffIso = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  // newsletter_issue_view keys on the SCHOOL's calendar date, not UTC
  // (invariant 34), so its cutoff is a school-local day string.
  const cutoffDay = schoolDay(env, new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000));
  const nowIso = now.toISOString();

  // The tuple assertion is for noUncheckedIndexedAccess, like newsletterMetrics:
  // ten statements in produce ten results out.
  const [users, persons, groups, calendar, volunteers, newsletter, store, pto, lostFound, audit] =
    (await env.DB.batch([
      env.DB.prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN disabled_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS disabled,
                COALESCE(SUM(CASE WHEN is_system_admin = 1 AND disabled_at IS NULL THEN 1 ELSE 0 END), 0) AS admins,
                COALESCE(SUM(CASE WHEN access_approved_at IS NOT NULL AND disabled_at IS NULL THEN 1 ELSE 0 END), 0) AS approved,
                COALESCE(SUM(CASE WHEN access_submitted_at IS NOT NULL AND access_approved_at IS NULL
                                   AND access_declined_at IS NULL AND disabled_at IS NULL THEN 1 ELSE 0 END), 0) AS pending,
                COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS new_30d
           FROM user`,
      ).bind(cutoffIso),
      // A COUNT over `person`, with the enumeration gate's own column split out
      // rather than exempted: the caller is a system admin — the one audience
      // invariant 21 admits to every row — and the response is a pair of
      // numbers, never a listing. Reporting `unlisted` separately is the
      // point, not a flourish: the flag is admin-flipped, so "how many are
      // withheld" is this screen's business.
      env.DB.prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN unlisted_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS unlisted
           FROM person`,
      ),
      env.DB.prepare("SELECT kind, COUNT(*) AS n FROM grp GROUP BY kind"),
      env.DB.prepare(
        `SELECT (SELECT COUNT(*) FROM managed_calendar) AS calendars,
                (SELECT COUNT(*) FROM managed_event) AS managed_events,
                (SELECT COUNT(*) FROM calendar_source) AS sources,
                (SELECT COUNT(*) FROM calendar_event WHERE starts_at >= ?) AS upcoming`,
      ).bind(nowIso),
      env.DB.prepare(
        `SELECT (SELECT COUNT(*) FROM volunteer_sheet WHERE published_at IS NOT NULL) AS sheets,
                (SELECT COUNT(*) FROM volunteer_signup) AS signups,
                (SELECT COUNT(*) FROM volunteer_signup WHERE created_at >= ?) AS signups_30d`,
      ).bind(cutoffIso),
      env.DB.prepare(
        `SELECT (SELECT COUNT(*) FROM newsletter_subscriber WHERE unsubscribed_at IS NULL) AS subscribers,
                (SELECT COUNT(*) FROM newsletter_issue WHERE sent_at IS NOT NULL) AS issues_sent,
                (SELECT COALESCE(SUM(views), 0) FROM newsletter_issue_view) AS views,
                (SELECT COALESCE(SUM(views), 0) FROM newsletter_issue_view WHERE day >= ?) AS views_30d`,
      ).bind(cutoffDay),
      // Money facts from the order rows' own columns (invariant 26): `paid_at`
      // is stamped only by the webhook that verified payment, and covers every
      // later state (submitted, shipped, fulfillment_failed) — so this is
      // "money arrived", not "checkout attempted".
      env.DB.prepare(
        `SELECT COUNT(*) AS paid,
                COALESCE(SUM(total_cents), 0) AS revenue_cents,
                COALESCE(SUM(CASE WHEN paid_at >= ? THEN 1 ELSE 0 END), 0) AS paid_30d,
                COALESCE(SUM(CASE WHEN status = 'fulfillment_failed' THEN 1 ELSE 0 END), 0) AS failed
           FROM store_order WHERE paid_at IS NOT NULL`,
      ).bind(cutoffIso),
      env.DB.prepare(
        `SELECT (SELECT COUNT(*) FROM pto_board WHERE archived_at IS NULL) AS boards,
                (SELECT COUNT(*) FROM pto_card WHERE archived_at IS NULL) AS cards`,
      ),
      // `LISTED` is the public listing's own predicate (lib/lostFound.ts) —
      // composed, not restated, so the two can never disagree about what
      // "on the site" means.
      env.DB.prepare(
        `SELECT (SELECT COUNT(*) FROM lf_item WHERE ${LISTED}) AS listed,
                (SELECT COUNT(*) FROM lf_item WHERE status = 'found' AND held_at IS NOT NULL) AS held,
                (SELECT COUNT(*) FROM lf_item WHERE status = 'returned') AS returned,
                (SELECT COUNT(*) FROM lf_claim WHERE resolved_at IS NULL) AS open_claims`,
      ),
      env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE created_at >= ?").bind(cutoffIso),
    ])) as [
      D1Result, D1Result, D1Result, D1Result, D1Result,
      D1Result, D1Result, D1Result, D1Result, D1Result,
    ];

  const one = (r: D1Result): Record<string, number> =>
    ((r.results ?? [])[0] ?? {}) as Record<string, number>;
  const n = (row: Record<string, number>, key: string): number => Number(row[key] ?? 0);

  const groupRows = (groups.results ?? []) as { kind: string; n: number }[];
  const groupCount = (kind: string) => Number(groupRows.find((g) => g.kind === kind)?.n ?? 0);

  const u = one(users);
  const p = one(persons);
  const cal = one(calendar);
  const vol = one(volunteers);
  const nl = one(newsletter);
  const st = one(store);
  const pt = one(pto);
  const lf = one(lostFound);

  return {
    directory: {
      accounts: n(u, "total"),
      disabledAccounts: n(u, "disabled"),
      admins: n(u, "admins"),
      approvedAccounts: n(u, "approved"),
      pendingAccessRequests: n(u, "pending"),
      newAccounts30d: n(u, "new_30d"),
      people: n(p, "total"),
      unlistedPeople: n(p, "unlisted"),
      households: groupCount("household"),
      classrooms: groupCount("classroom"),
    },
    calendar: {
      calendars: n(cal, "calendars"),
      managedEvents: n(cal, "managed_events"),
      importedSources: n(cal, "sources"),
      upcomingOccurrences: n(cal, "upcoming"),
    },
    volunteers: {
      publishedSheets: n(vol, "sheets"),
      signups: n(vol, "signups"),
      signups30d: n(vol, "signups_30d"),
    },
    newsletter: {
      subscribers: n(nl, "subscribers"),
      issuesSent: n(nl, "issues_sent"),
      archiveViews: n(nl, "views"),
      archiveViews30d: n(nl, "views_30d"),
    },
    store: {
      paidOrders: n(st, "paid"),
      paidOrders30d: n(st, "paid_30d"),
      revenueCents: n(st, "revenue_cents"),
      fulfillmentFailed: n(st, "failed"),
    },
    pto: {
      boards: n(pt, "boards"),
      openCards: n(pt, "cards"),
    },
    lostAndFound: {
      listed: n(lf, "listed"),
      awaitingReview: n(lf, "held"),
      returned: n(lf, "returned"),
      openClaims: n(lf, "open_claims"),
    },
    auditEvents30d: n(one(audit), "n"),
  };
}
