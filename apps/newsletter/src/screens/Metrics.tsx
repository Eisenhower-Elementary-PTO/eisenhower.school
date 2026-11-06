// Readership of the public archive — how many times each issue's web page has
// been opened, in which reading language, and where readers went from it.
//
// Everything here is an aggregate tally (migration 0042): there is no reader
// identity anywhere in the schema, so this screen can never grow a "who" —
// only "how many". The copy below says what is and isn't counted, because the
// honest answer to "did everyone see it?" is that email opens are invisible
// and script-blocking readers are too; these numbers are a floor, not a
// census.
//
// Admin-screen English like Subscribers.tsx; member-facing screens are the
// translated ones.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { NewsletterMetricsDTO } from "@sd/shared";
import { formatIssueDate, localeNames, type Locale } from "@sd/shared";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader } from "../components/parts.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api, errorMessage } from "../lib/api.js";

/** "Spanish", "Chinese (Simplified)" — or the bucket for a translate-proxy
 *  target outside the site's own four. English is the untranslated read and is
 *  shown only as part of the total, not as a chip. */
function langLabel(code: string): string {
  if (code === "other") return "Other languages";
  return localeNames[code as Locale]?.english ?? code;
}

/** The non-English share of an issue's views, as "Spanish 4 · Somali 1". */
function translatedSummary(byLang: Record<string, number>): string {
  return Object.entries(byLang)
    .filter(([code, n]) => code !== "en" && n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([code, n]) => `${langLabel(code)} ${n}`)
    .join(" · ");
}

function DayStrip({ days }: { days: { day: string; views: number }[] }) {
  // The last 30 days of the series, padded with nothing — a missing day simply
  // has no bar. Heights scale to the window's own max so a quiet month still
  // shows its shape.
  const recent = days.slice(-30);
  const max = Math.max(1, ...recent.map((d) => d.views));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 48 }}>
      {recent.map((d) => (
        <div
          key={d.day}
          title={`${d.day}: ${d.views} view${d.views === 1 ? "" : "s"}`}
          style={{
            flex: 1,
            minWidth: 3,
            borderRadius: 2,
            height: `${Math.max(8, Math.round((d.views / max) * 100))}%`,
            background: "var(--blue)",
            opacity: 0.85,
          }}
        />
      ))}
    </div>
  );
}

export function Metrics() {
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState<NewsletterMetricsDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .metrics()
      .then((r) => setMetrics(r.metrics))
      .catch((err: unknown) => setError(errorMessage(err, "Couldn't load the metrics.")));
  }, []);

  const body = (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {error && <p className="sd-lead" style={{ color: "var(--warn)", margin: 0 }}>{error}</p>}
      {!metrics && !error && <div className="sd-spinner" style={{ margin: "24px auto" }} />}

      {metrics && (
        <>
          <div className="sd-card" style={{ padding: "14px 16px" }}>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.6px" }}>
              {metrics.totalViews}
            </div>
            <p className="sd-meta" style={{ margin: "2px 0 0" }}>
              times an issue's web page has been opened, across every issue. Counted when
              the page loads in a browser — email opens aren't tracked, nothing identifies
              who was reading, and readers who block scripts aren't counted, so treat these
              as a floor.
            </p>
          </div>

          {metrics.days.length > 0 && (
            <div className="sd-card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontWeight: 700 }}>Last 30 days</div>
              <DayStrip days={metrics.days} />
            </div>
          )}

          <div>
            <div style={{ fontWeight: 700, padding: "0 2px 6px" }}>By issue</div>
            {metrics.issues.length === 0 && (
              <p className="sd-meta">No published issues yet — views are counted once an issue has a public page.</p>
            )}
            {metrics.issues.map((issue) => {
              const translated = translatedSummary(issue.byLang);
              return (
                <div
                  key={issue.issueId}
                  className="sd-row"
                  style={{ gap: 12, padding: "10px 2px", borderBottom: "1px solid var(--line)", alignItems: "baseline" }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 600, overflowWrap: "anywhere" }}>{issue.title}</div>
                    <div className="sd-meta">
                      {formatIssueDate(issue.sentAt ?? issue.publishedAt)}
                      {translated && <> · translated reads: {translated}</>}
                    </div>
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 800, flex: "0 0 auto" }}>{issue.total}</div>
                </div>
              );
            })}
          </div>

          {metrics.clicks.length > 0 && (
            <div className="sd-card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontWeight: 700 }}>Where readers went</div>
              <p className="sd-meta" style={{ margin: 0 }}>
                Links followed from issue pages, by destination site. Counted by site only —
                not by who clicked.
              </p>
              {metrics.clicks.map((c) => (
                <div key={c.dest} className="sd-row" style={{ gap: 10, alignItems: "baseline" }}>
                  <span style={{ fontSize: 13.5, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{c.dest}</span>
                  <span style={{ fontWeight: 700, flex: "0 0 auto" }}>{c.clicks}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );

  if (desktop) {
    return <DesktopShell active="metrics" title="Metrics">{body}</DesktopShell>;
  }
  return (
    <AppShell bottomNav={<BottomNav active="metrics" />}>
      <ScreenHeader title="Metrics" onLeft={() => navigate("/admin")} />
      <div className="sd-scroll" style={{ padding: "14px 16px 24px" }}>{body}</div>
    </AppShell>
  );
}
