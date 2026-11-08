// Suite-wide metrics: one screen of counters across every app — directory,
// calendar, volunteers, newsletter, store, PTO, lost & found.
//
// Everything on it is an aggregate the API computed (GET /admin/metrics,
// lib/suiteMetrics.ts): counts and sums, numbers never identities. The screen
// deliberately has no drill-down — the places that can name people (the user
// list, the access queue, the audit log) are their own screens with their own
// reasoning, and this one stays safe to leave open on a projector.
//
// Admin-screen English like Admin.tsx; admin chrome is operator tooling and is
// exempt from invariant 6 by the decision recorded there.

import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import type { SuiteMetricsDTO } from "@sd/shared";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader, SectLabel } from "../components/parts.js";
import { useSession } from "../lib/session.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api } from "../lib/api.js";

function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** One number with its label; `warn` renders the value in the warning colour
 *  so a count that means "a human is needed" reads that way at a glance. */
function Stat({ value, label, sub, warn }: { value: string | number; label: string; sub?: string; warn?: boolean }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.5px", color: warn ? "var(--warn)" : undefined }}>
        {value}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 1 }}>{label}</div>
      {sub && <div className="sd-meta" style={{ marginTop: 1, lineHeight: 1.35 }}>{sub}</div>}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <SectLabel>{label}</SectLabel>
      <div
        className="sd-card sd-card-pad"
        style={{
          marginTop: 9,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: "14px 16px",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function Metrics() {
  const { me } = useSession();
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const [m, setM] = useState<SuiteMetricsDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .suiteMetrics()
      .then((r) => setM(r.metrics))
      .catch(() => setError("Couldn't load the metrics."));
  }, []);

  if (me && !me.user.isSystemAdmin) return <Navigate to="/" replace />;

  const body = (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {error && <p className="sd-lead" style={{ color: "var(--warn)", margin: 0 }}>{error}</p>}
      {!m && !error && <div className="sd-spinner" style={{ margin: "24px auto" }} />}

      {m && (
        <>
          <Section label="Last 30 days">
            <Stat value={m.directory.newAccounts30d} label="New accounts" />
            <Stat value={m.volunteers.signups30d} label="Volunteer sign-ups" />
            <Stat value={m.newsletter.archiveViews30d} label="Newsletter reads" />
            <Stat value={m.store.paidOrders30d} label="Store orders" />
            <Stat value={m.auditEvents30d} label="Actions logged" sub="Audit-log entries across every app." />
          </Section>

          <Section label="Directory">
            <Stat
              value={m.directory.accounts}
              label="Sign-in accounts"
              sub={[
                m.directory.admins === 1 ? "1 admin" : `${m.directory.admins} admins`,
                m.directory.disabledAccounts > 0 ? `${m.directory.disabledAccounts} disabled` : null,
              ].filter(Boolean).join(" · ")}
            />
            <Stat value={m.directory.approvedAccounts} label="With directory access" />
            <Stat
              value={m.directory.pendingAccessRequests}
              label="Access requests waiting"
              warn={m.directory.pendingAccessRequests > 0}
              sub={m.directory.pendingAccessRequests > 0 ? "Review them on the Access tab." : undefined}
            />
            <Stat
              value={m.directory.people}
              label="People"
              sub={m.directory.unlistedPeople > 0 ? `${m.directory.unlistedPeople} unlisted` : undefined}
            />
            <Stat value={m.directory.households} label="Households" />
            <Stat value={m.directory.classrooms} label="Classrooms" />
          </Section>

          <Section label="Calendar">
            <Stat value={m.calendar.calendars} label="Calendars" />
            <Stat value={m.calendar.managedEvents} label="Events & series" />
            <Stat value={m.calendar.upcomingOccurrences} label="Upcoming dates" />
            <Stat value={m.calendar.importedSources} label="Imported feeds" />
          </Section>

          <Section label="Volunteers">
            <Stat value={m.volunteers.publishedSheets} label="Published sheets" />
            <Stat value={m.volunteers.signups} label="Sign-ups, all time" />
          </Section>

          <Section label="Newsletter">
            <Stat value={m.newsletter.subscribers} label="Subscribers" />
            <Stat value={m.newsletter.issuesSent} label="Issues sent" />
            <Stat
              value={m.newsletter.archiveViews}
              label="Archive reads, all time"
              sub="Web page loads only — email opens aren't tracked, so this is a floor."
            />
          </Section>

          <Section label="Store">
            <Stat value={m.store.paidOrders} label="Paid orders" />
            <Stat value={dollars(m.store.revenueCents)} label="Revenue" sub="Items plus shipping, before vendor costs." />
            <Stat
              value={m.store.fulfillmentFailed}
              label="Fulfillment failures"
              warn={m.store.fulfillmentFailed > 0}
              sub={m.store.fulfillmentFailed > 0 ? "Paid but not submitted — see the store's Orders screen." : undefined}
            />
          </Section>

          <Section label="PTO boards">
            <Stat value={m.pto.boards} label="Boards" />
            <Stat value={m.pto.openCards} label="Open cards" />
          </Section>

          <Section label="Lost & found">
            <Stat value={m.lostAndFound.listed} label="Listed now" />
            <Stat
              value={m.lostAndFound.awaitingReview}
              label="Awaiting review"
              warn={m.lostAndFound.awaitingReview > 0}
            />
            <Stat value={m.lostAndFound.returned} label="Returned, all time" />
            <Stat value={m.lostAndFound.openClaims} label="Open claims" />
          </Section>

          <p className="sd-meta" style={{ margin: 0, lineHeight: 1.45 }}>
            Counts come straight from the database when the page loads. Nothing here identifies a
            person — totals only. Site traffic beyond the newsletter isn't measured here;
            Cloudflare Web Analytics (named on the privacy page) has the page-view picture.
          </p>
        </>
      )}
    </div>
  );

  if (isDesktop) {
    return <DesktopShell active="admin" title="Metrics"><div style={{ maxWidth: 720 }}>{body}</div></DesktopShell>;
  }
  return (
    <AppShell bottomNav={<BottomNav active="me" />}>
      <ScreenHeader title="Metrics" onLeft={() => navigate("/admin")} />
      <div className="sd-scroll"><div className="sd-body">{body}</div></div>
    </AppShell>
  );
}
