// Event photo albums — a members-only list, newest event first.
//
// Exists because the event page cannot be the only home for an album link: the
// agenda keeps an occurrence for only ~2 days after it ends, and a photo album
// is wanted most AFTER the event. This list reads `event_album` directly
// (GET /calendar/albums), which keeps a row for as long as the series lives.
// Behind RequireAuth in App.tsx; the API enforces the same on its side, and the
// links are capabilities that never reach a public response (migration 0045).
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatClock, type EventAlbumDTO } from "@sd/shared";
import { Icon } from "../components/Icon.js";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader } from "../components/parts.js";
import { SiteFooter } from "../components/SiteFooter.js";
import { useI18n } from "../i18n/index.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api } from "../lib/api.js";
import { SCHOOL_TIME_ZONE } from "../lib/timezone.js";
import { formatEventDay } from "../lib/calendar.js";

const DAY_LABEL: Intl.DateTimeFormatOptions = { weekday: "short", month: "long", day: "numeric", year: "numeric" };

export function Albums() {
  const { t, locale } = useI18n();
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const [albums, setAlbums] = useState<EventAlbumDTO[] | null>(null);

  useEffect(() => {
    api
      .eventAlbums()
      .then((r) => setAlbums(r.albums))
      .catch(() => setAlbums([]));
  }, []);

  const list =
    albums === null ? (
      <div className="sd-card sd-card-pad sd-meta" style={{ textAlign: "center", padding: "28px 16px" }}>…</div>
    ) : albums.length === 0 ? (
      <div className="sd-card sd-card-pad sd-meta" style={{ textAlign: "center", padding: "28px 16px" }}>
        {t("albumsEmpty")}
      </div>
    ) : (
      <div className="sd-card" style={{ display: "flex", flexDirection: "column" }}>
        {albums.map((a, i) => (
          <a
            key={`${a.url}-${a.start}`}
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            className="sd-row"
            style={{ gap: 12, padding: "13px 16px", textDecoration: "none", color: "inherit", borderTop: i ? "1px solid var(--line)" : undefined }}
          >
            <Icon name="photo" size={19} style={{ color: "var(--ink-3)", flex: "0 0 auto" }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 14.5, fontWeight: 650 }}>{a.title}</div>
              <div className="sd-meta">
                {formatEventDay({ start: a.start, allDay: a.allDay }, locale, DAY_LABEL)}
                {!a.allDay && ` · ${formatClock(a.start, locale, SCHOOL_TIME_ZONE)}`}
              </div>
            </div>
            <Icon name="chevright" size={17} style={{ color: "var(--ink-3)", flex: "0 0 auto" }} />
          </a>
        ))}
      </div>
    );

  if (isDesktop) {
    return (
      <DesktopShell active="albums" title={t("albumsTitle")}>
        <div style={{ maxWidth: 760, width: "100%" }}>{list}</div>
      </DesktopShell>
    );
  }
  return (
    <AppShell bottomNav={<BottomNav active="albums" />}>
      <ScreenHeader title={t("albumsTitle")} onLeft={() => navigate("/")} />
      <div className="sd-scroll">
        <div className="sd-body" style={{ gap: 16 }}>{list}<SiteFooter /></div>
      </div>
    </AppShell>
  );
}
