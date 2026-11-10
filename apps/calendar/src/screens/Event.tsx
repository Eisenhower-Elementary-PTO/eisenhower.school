// One event's own page — the dedicated URL at /e/:date/:slug.
//
// Ungated, like the agenda at `/` and the volunteer sheet at /v/:slug: an event
// link's whole job is to open from a text message. It reads
// /calendar-public/events/:date/:slug when signed out, and re-reads the
// members-only twin ONLY for a system admin, which is the one thing that adds —
// `seriesId`, the durable handle the edit form opens. Same two-step the agenda
// does, and for the same reason: a shared link must not wait on /me.
//
// The path is a CONTENT identity, not an id — see packages/shared/src/eventPath.ts
// for why an event can't be addressed any other way, and what that costs. The
// consequence to know here is that this page exists for an imported ICS event
// just as much as for one authored in this app; only the admin and volunteer
// affordances are managed-only, and both are absent by construction (an imported
// event has no `seriesId` and can carry no sheet).
//
// It is also the ONLY page a volunteer sheet is read on. /v/:slug used to render
// its own near-copy of this one; it now resolves the slug and forwards here with
// `?sheet=`, which this page honours so that a sheet the event alone would not
// surface still opens — see screens/VolunteerRedirect.tsx and `sheetSlug` below.
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  eventPath,
  eventTitleSlug,
  htmlToText,
  type CalendarEventDTO,
  type PublicCalendarEventDTO,
  type VolunteerSheetDTO,
  formatClock,
} from "@sd/shared";
import { Icon } from "../components/Icon.js";
import { Btn } from "../components/atoms.js";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader, SectLabel } from "../components/parts.js";
import { SiteFooter } from "../components/SiteFooter.js";
import { EditEventSheet } from "../components/EditEventSheet.js";
import { LinkifiedText } from "../components/LinkifiedText.js";
import { VolunteerPositions, runbookOf, type AnySheet } from "../components/VolunteerPositions.js";
import { useI18n } from "../i18n/index.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api, errorMessage } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { SCHOOL_TIME_ZONE } from "../lib/timezone.js";
import { rememberReturnPath } from "../lib/returnPath.js";
import { showsDescription, showsAllDayLabel, showsTitle, formatEventDay } from "../lib/calendar.js";

/** The day heading format, matching the agenda's so the page a reader opens is
 *  labelled the same way as the row they tapped. */
const DAY_LABEL: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric" };

/** What this page renders. The public shape plus, for a system admin only,
 *  `seriesId` from the members-only re-read — exactly the widening the agenda
 *  allows itself, and no more. See api.memberCalendarEvent. */
type PageEvent = PublicCalendarEventDTO & Partial<Pick<CalendarEventDTO, "seriesId" | "recurrenceId">>;

function googleMapsUrl(q: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/** "meet.google.com" from a meeting link — the part a reader recognises. Falls
 *  back to the whole string for anything `URL` can't parse, which the API
 *  should never have stored. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** "4:00 – 8:00 PM", or the all-day label. Typed by the fields it reads rather
 *  than by PageEvent, because the fallback card below renders a sheet's own
 *  occurrence, which is not an agenda row. */
function timeRange(
  e: Pick<PageEvent, "start" | "end" | "allDay">,
  locale: string,
  allDayLabel: string,
): string {
  if (e.allDay) return allDayLabel;
  const start = formatClock(e.start, locale, SCHOOL_TIME_ZONE);
  const end = e.end ? formatClock(e.end, locale, SCHOOL_TIME_ZONE) : null;
  return end ? `${start} – ${end}` : start;
}

export function Event() {
  const { date = "", slug = "" } = useParams();
  const { t, locale } = useI18n();
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const { me, loading: sessionLoading } = useSession();

  // A reader who arrived from a sheet's own link (/v/:slug) carries the slug
  // here. It matters in exactly the cases the event can't cover by itself: a
  // DRAFT sheet, whose slug the server withholds from `volunteerSlug` until it
  // is published, and one whose event no longer resolves — the series was edited
  // away from that date, or the day has aged out of `calendar_event`, which
  // keeps only ~2 days of the past. The sheet and its signups are intact in both
  // cases and the link is already circulating, so the page still has to open.
  // Reading it grants nothing: both sheet endpoints do their own authorization,
  // so a member handed an admin's draft link still gets a 404.
  const [params] = useSearchParams();
  const sheetParam = params.get("sheet");

  const [event, setEvent] = useState<PageEvent | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [loadedSheet, setLoadedSheet] = useState<AnySheet | null>(null);
  // Which slug the fetch below has answered for. A boolean would have been the
  // obvious thing and would have been wrong: `loadSheet` runs again after every
  // claim, and clearing a flag on each call blanks the page mid-signup — taking
  // the claim dialog's own error message down with it. What the page waits on is
  // an ANSWER ABOUT THIS SLUG, which a re-read of the same slug already has.
  const [settledFor, setSettledFor] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  // The photo album link, members only. `undefined` = not asked / not signed in.
  const [albumUrl, setAlbumUrl] = useState<string | null | undefined>(undefined);
  const [albumDraft, setAlbumDraft] = useState<string | null>(null); // non-null = editor open
  const [albumError, setAlbumError] = useState<string | null>(null);

  const isAdmin = !!me?.user.isSystemAdmin;

  const loadEvent = useCallback(async () => {
    try {
      const r = isAdmin ? await api.memberCalendarEvent(date, slug) : await api.calendarEvent(date, slug);
      setEvent(r.event);
      setState("ready");
    } catch {
      // Keep whatever is on screen if the admin re-read fails: that copy is the
      // perfectly good public one, only missing the edit handle.
      setState((cur) => (cur === "ready" ? cur : "missing"));
    }
  }, [date, slug, isAdmin]);

  useEffect(() => {
    void loadEvent();
  }, [loadEvent]);

  // The album link is a capability, so it comes from a members-only route of its
  // own (never the public event read) and only once a session has resolved. An
  // imported event has none; the route answers null and nothing renders.
  useEffect(() => {
    if (sessionLoading || !me) {
      setAlbumUrl(undefined);
      return;
    }
    let live = true;
    api
      .eventAlbum(date, slug)
      .then((r) => live && setAlbumUrl(r.albumUrl))
      .catch(() => live && setAlbumUrl(null));
    return () => {
      live = false;
    };
  }, [date, slug, me, sessionLoading]);

  const saveAlbum = async () => {
    if (!event?.seriesId || !event.recurrenceId || albumDraft === null) return;
    setAlbumError(null);
    try {
      await api.setEventAlbum(event.seriesId, event.recurrenceId, albumDraft);
      setAlbumUrl(albumDraft.trim() || null);
      setAlbumDraft(null);
    } catch (err) {
      setAlbumError(errorMessage(err, "Could not save the album link."));
    }
  };

  // The signup sheet, once the event says there is one. Two endpoints, picked by
  // whether there's a session — counts for everyone, names for members. The
  // session has to have RESOLVED first, or a signed-in reader gets the nameless
  // copy; see components/VolunteerPositions.tsx.
  const sheetSlug = event?.volunteerSlug ?? sheetParam;
  const loadSheet = useCallback(async () => {
    if (!sheetSlug || sessionLoading) return;
    try {
      const r = me ? await api.volunteerSheet(sheetSlug) : await api.publicVolunteerSheet(sheetSlug);
      setLoadedSheet(r.sheet);
    } catch {
      // A sheet unpublished between the agenda being read and this page opening
      // just means no signup block; the event itself is still worth showing.
      setLoadedSheet(null);
    } finally {
      setSettledFor(sheetSlug);
    }
  }, [sheetSlug, me, sessionLoading]);

  useEffect(() => {
    void loadSheet();
  }, [loadSheet]);

  /* What the page actually shows. A `?sheet=` names a sheet; it does not say the
     sheet is about the event this path names, and rendering one event's heading
     over another's positions would have someone sign up for an event they are
     not looking at. Both halves are content identities minted by the same
     function, so a forward from /v/:slug always agrees and a hand-edited URL
     that pairs two unrelated things does not. Only a param-sourced sheet is
     checked: one the EVENT itself named is the event's by construction. */
  const sheet =
    loadedSheet && (event?.volunteerSlug || eventTitleSlug(loadedSheet.event.title) === slug)
      ? loadedSheet
      : null;

  // Once the event has named the same sheet itself, the parameter has done its
  // job — drop it, so the URL in the address bar is the canonical event link and
  // that is what a reader who copies it passes on. It stays on the two paths
  // above, where it is the only thing keeping the block on screen.
  useEffect(() => {
    if (sheetParam && event?.volunteerSlug === sheetParam) {
      navigate(pathname, { replace: true });
    }
  }, [sheetParam, event?.volunteerSlug, navigate, pathname]);

  // Someone who followed a sign-up link asked for the sign-up, not the event, so
  // put it on screen. Once only, and only for that arrival: the ref is what
  // remembers it across the URL cleanup above, and is reset when the page is
  // pointed at a different event without unmounting.
  const volunteersRef = useRef<HTMLDivElement | null>(null);
  const cameFromSheetLink = useRef(!!sheetParam);
  const scrolled = useRef(false);
  useEffect(() => {
    cameFromSheetLink.current = !!sheetParam;
    scrolled.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the arrival, not every render
  }, [date, slug]);
  useEffect(() => {
    if (!sheet || !cameFromSheetLink.current || scrolled.current) return;
    // The sheet and the event are two races, and the sheet often wins: while the
    // event is still loading the body is a spinner and this block is not in the
    // tree. Spending the one scroll on a null ref would mean silently not
    // scrolling at all, so wait for the element — `state` is in the deps because
    // its landing is what mounts it.
    const el = volunteersRef.current;
    if (!el) return;
    scrolled.current = true;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [sheet, state]);

  const goSignIn = () => {
    // Remember this page so the magic link lands back here — the link itself can
    // only carry an origin. See lib/returnPath.ts.
    // The live URL rather than a rebuilt one, so a `?sheet=` that is still doing
    // work (a draft, or an event that no longer resolves) survives the trip.
    rememberReturnPath(`${pathname}${search}`);
    navigate("/sign-in");
  };

  const copyLink = async () => {
    try {
      // Origin + path, not `href`: a reader who arrived from a sheet link may
      // still have `?sheet=` on screen, and the link they pass on should be the
      // event's own.
      await navigator.clipboard.writeText(`${window.location.origin}${pathname}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the address bar still has the link */
    }
  };

  /* The signup block. Present only when a sheet actually loaded — for an event
     the server named one on, or for the `?sheet=` arrivals above. Counts for
     everyone, names for members; the split is enforced by which endpoint
     loadSheet asked, not by anything here. */
  const volunteerBlock = sheet && (
    <div ref={volunteersRef}>
      <SectLabel>{t("volunteersNeeded")}</SectLabel>
      {sheet.intro && (
        <div style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--ink-2)", whiteSpace: "pre-wrap", wordBreak: "break-word", marginTop: 9 }}>
          {sheet.intro}
        </div>
      )}
      {/* The organizers' runbook. Member-only by construction: the anonymous
          endpoint's shape has no such field (publicSheetOf withholds it), so
          this renders nothing for a signed-out reader — runbookOf is the one
          place that reads it; see its note for why not an `in` check here. */}
      {runbookOf(sheet) && (
        <div className="sd-row" style={{ gap: 7, marginTop: 9 }}>
          <Icon name="file" size={15} style={{ color: "var(--ink-3)", flex: "0 0 auto" }} />
          <a href={runbookOf(sheet)!} target="_blank" rel="noopener noreferrer" className="sd-link" style={{ fontSize: 13.5, fontWeight: 600 }}>
            {t("volunteerRunbook")}
          </a>
        </div>
      )}
      {sheet.closed && (
        <div className="sd-row" style={{ gap: 7, color: "var(--ink-3)", marginTop: 9 }}>
          <Icon name="lock" size={15} style={{ flex: "0 0 auto" }} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>{t("volunteerSignupsClosed")}</span>
        </div>
      )}
      <VolunteerPositions
        sheet={sheet}
        onSheet={(s: VolunteerSheetDTO) => setLoadedSheet(s)}
        onReload={() => void loadSheet()}
        onSignIn={goSignIn}
      />
    </div>
  );

  /* The header built from the SHEET rather than from the agenda — what this page
     falls back to when the path it was given addresses no event but a sheet did
     load. It is the smaller card on purpose: a sheet knows its occurrence, not
     which calendar the event sits on. No `showsDescription` gate, because only a
     MANAGED event can carry a sheet (invariant 8), so the text is always one an
     admin typed in this app's own editor. */
  const sheetHeader = sheet && (
    <div className="sd-card sd-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h1 className="sd-h2" style={{ margin: 0 }}>{sheet.event.title}</h1>
      <div className="sd-row" style={{ gap: 9 }}>
        <Icon name="calendar" size={17} style={{ color: "var(--ink-3)", flex: "0 0 auto" }} />
        <div style={{ fontSize: 14 }}>
          {formatEventDay(sheet.event, locale, DAY_LABEL)}
          <span style={{ color: "var(--ink-3)" }}> · {timeRange(sheet.event, locale, t("allDay"))}</span>
        </div>
      </div>
      {sheet.event.location && (
        <div className="sd-row" style={{ gap: 9 }}>
          <Icon name="pin" size={17} style={{ color: "var(--ink-3)", flex: "0 0 auto" }} />
          <a href={googleMapsUrl(sheet.event.location)} target="_blank" rel="noopener noreferrer" className="sd-link" style={{ fontSize: 14 }}>
            {sheet.event.location}
          </a>
        </div>
      )}
      {sheet.event.description && (
        <div style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--ink-2)", whiteSpace: "pre-wrap", wordBreak: "break-word", borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <LinkifiedText text={htmlToText(sheet.event.description)} />
        </div>
      )}
    </div>
  );

  // The event's lookup failing is only the whole answer once the sheet has
  // spoken too: on a `?sheet=` arrival the sheet is what the page falls back to,
  // and showing "event not found" for the moment before it lands would tell the
  // reader their link is dead when it isn't.
  const awaitingSheet = !!sheetParam && settledFor !== sheetSlug;

  const body = state === "loading" || (state === "missing" && awaitingSheet) ? (
    <div className="sd-card sd-card-pad sd-meta" style={{ textAlign: "center", padding: "28px 16px" }}>…</div>
  ) : state === "missing" || !event ? (
    sheet ? (
      <>{sheetHeader}{volunteerBlock}</>
    ) : (
      <div className="sd-card sd-card-pad" style={{ textAlign: "center", padding: "28px 16px" }}>
        <div className="sd-h2" style={{ marginBottom: 6 }}>{t("eventNotFound")}</div>
        <div className="sd-meta">{t("eventNotFoundBody")}</div>
        <Btn kind="secondary" style={{ marginTop: 14 }} onClick={() => navigate("/")}>{t("calendarTitle")}</Btn>
      </div>
    )
  ) : (
    <>
      <div className="sd-card sd-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="sd-row" style={{ gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: event.source.color, flex: "0 0 auto" }} />
          <span className="sd-meta" style={{ color: event.source.color, fontWeight: 700 }}>{event.source.name}</span>
        </div>
        {showsTitle(event) && <h1 className="sd-h2" style={{ margin: 0 }}>{event.title}</h1>}
        <div className="sd-row" style={{ gap: 9 }}>
          <Icon name="calendar" size={17} style={{ color: "var(--ink-3)", flex: "0 0 auto" }} />
          <div style={{ fontSize: 14 }}>
            {formatEventDay(event, locale, DAY_LABEL)}
            {(!event.allDay || showsAllDayLabel(event)) && (
              <span style={{ color: "var(--ink-3)" }}> · {timeRange(event, locale, t("allDay"))}</span>
            )}
          </div>
        </div>
        {event.location && (
          <div className="sd-row" style={{ gap: 9 }}>
            <Icon name="pin" size={17} style={{ color: "var(--ink-3)", flex: "0 0 auto" }} />
            <a href={googleMapsUrl(event.location)} target="_blank" rel="noopener noreferrer" className="sd-link" style={{ fontSize: 14 }}>
              {event.location}
            </a>
          </div>
        )}
        {/* Only an event authored here can carry one (migration 0025), and the
            API has already held it to http(s), so the href is safe to render on
            this anonymous page. The host is shown beside the label so a reader
            knows which app is about to open. */}
        {event.meetingUrl && (
          <div className="sd-row" style={{ gap: 9, minWidth: 0 }}>
            <Icon name="globe" size={17} style={{ color: "var(--ink-3)", flex: "0 0 auto" }} />
            <a href={event.meetingUrl} target="_blank" rel="noopener noreferrer" className="sd-link" style={{ fontSize: 14, fontWeight: 600 }}>
              {t("eventJoinOnline")}
            </a>
            <span className="sd-meta" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {hostOf(event.meetingUrl)}
            </span>
          </div>
        )}
        {showsDescription(event) && (
          <div style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--ink-2)", whiteSpace: "pre-wrap", wordBreak: "break-word", borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            <LinkifiedText text={htmlToText(event.description!)} />
          </div>
        )}
      </div>

      {/* Photo album: members only (the link is a capability — migration 0045).
          Admin editing is English, like the rest of the operator tooling. */}
      {(albumUrl || (isAdmin && event.seriesId)) && (
        <div className="sd-card sd-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {albumUrl && (
            <div className="sd-row" style={{ gap: 9 }}>
              <Icon name="photo" size={17} style={{ color: "var(--ink-3)", flex: "0 0 auto" }} />
              <a href={albumUrl} target="_blank" rel="noopener noreferrer" className="sd-link" style={{ fontSize: 14, fontWeight: 600 }}>
                {t("eventAlbum")}
              </a>
            </div>
          )}
          {isAdmin && event.seriesId && event.recurrenceId && albumDraft === null && (
            <Btn kind="secondary" icon="pencil" onClick={() => { setAlbumError(null); setAlbumDraft(albumUrl ?? ""); }}>
              {albumUrl ? "Change album link" : "Add photo album link"}
            </Btn>
          )}
          {albumDraft !== null && (
            <>
              <input
                className="sd-input"
                value={albumDraft}
                onChange={(e) => setAlbumDraft(e.target.value)}
                placeholder="https://photos.app.goo.gl/…"
                inputMode="url"
                autoFocus
              />
              <div className="sd-meta">
                Paste the share link of a collaborative Google Photos album for THIS date. Leave empty and save to remove it.
              </div>
              {albumError && <div className="sd-meta" style={{ color: "var(--red, #b3261e)" }}>{albumError}</div>}
              <div className="sd-row" style={{ gap: 8 }}>
                <Btn kind="primary" onClick={() => void saveAlbum()}>Save</Btn>
                <Btn kind="secondary" onClick={() => setAlbumDraft(null)}>Cancel</Btn>
              </div>
            </>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {/* No per-event download here. Taking a COPY of one occurrence is the
            thing that silently goes stale when the school moves the date; the
            calendar-level subscribe on the agenda's filter bar is the affordance
            that keeps up, and it is the one worth pointing people at. The one
            exception is a volunteer's OWN shift, offered on its position card —
            see packages/shared/src/volunteerCalendar.ts. */}
        <Btn kind="secondary" icon="link" onClick={() => void copyLink()}>
          {copied ? t("subscribeCopied") : t("subscribeCopy")}
        </Btn>
        {/* Admin-only, and only for an event authored here — an imported ICS
            event has no series in this app to edit. English rather than
            translated, like the rest of the operator tooling. */}
        {isAdmin && event.seriesId && (
          <Btn kind="secondary" icon="pencil" onClick={() => setEditing(true)}>Edit event</Btn>
        )}
        {/* The only route to a sheet that is still a DRAFT. The volunteer block
            below renders solely off `volunteerSlug`, which the server resolves
            with `published_at IS NOT NULL`, so an unpublished sheet is invisible
            on this page to admin and member alike — leaving no way to reach one
            but typing /v/:slug from memory. Points at the same screen the admin
            event list does, which picks the occurrence before showing positions
            (sheets are per-DATE — invariant 8). Shown whether or not a sheet
            exists: with none, that screen is also where you create one. */}
        {isAdmin && event.seriesId && (
          <Btn
            kind="secondary"
            icon="members"
            onClick={() => navigate(`/admin/events/${event.seriesId}/volunteers`)}
          >
            Volunteer signups
          </Btn>
        )}
      </div>

      {volunteerBlock}
    </>
  );

  const editSheet = editing && event?.seriesId && (
    <EditEventSheet
      seriesId={event.seriesId}
      onClose={() => setEditing(false)}
      onSaved={(saved) => {
        setEditing(false);
        // Saving re-expands the series into fresh calendar_event rows, AND may
        // have moved this page: the path is a content identity (title + day), so
        // a retitle or a date change makes the URL in the address bar address
        // nothing. Go to where the event now lives rather than re-reading a path
        // that would 404.
        //
        // For a repeating series the reader is on ONE of its dates and the edit
        // form can't move a single occurrence, so the day they are looking at is
        // still the right one and only the slug can have changed. A one-off
        // event is simply wherever it now starts.
        const next = saved.recurrence
          ? `/e/${date}/${encodeURIComponent(eventTitleSlug(saved.title))}`
          : eventPath(saved, SCHOOL_TIME_ZONE);
        if (next === `${window.location.pathname}`) void loadEvent();
        else navigate(next, { replace: true });
      }}
      onDeleted={() => {
        // This page addressed the event by title and day (invariant 8), so with
        // the event gone the URL addresses nothing — staying here would render
        // the "event not found" card. Back to the agenda, replacing the entry so
        // Back doesn't return to a dead path.
        navigate("/", { replace: true });
      }}
    />
  );

  if (isDesktop) {
    return (
      <DesktopShell active="calendar" title={t("eventTitle")}>
        <div style={{ maxWidth: 760, width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>{body}</div>
        {editSheet}
      </DesktopShell>
    );
  }
  return (
    <AppShell bottomNav={<BottomNav active="calendar" />}>
      <ScreenHeader
        title={t("eventTitle")}
        onLeft={() => navigate("/")}
        right={
          !me && !sessionLoading ? (
            <button className="sd-btn sd-btn-ghost sd-btn-sm" onClick={goSignIn}>{t("signInCta")}</button>
          ) : undefined
        }
      />
      <div className="sd-scroll">
        <div className="sd-body" style={{ gap: 16 }}>{body}<SiteFooter /></div>
      </div>
      {editSheet}
    </AppShell>
  );
}
