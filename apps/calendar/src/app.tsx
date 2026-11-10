import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useSession } from "./lib/session.js";
import { takeReturnPath } from "./lib/returnPath.js";
import { SignIn, CheckEmail } from "./screens/Onboarding.js";
import { Calendar } from "./screens/Calendar.js";
import { Event } from "./screens/Event.js";
import { Albums } from "./screens/Albums.js";
import { Admin } from "./screens/Admin.js";
import { CalendarEvents } from "./screens/CalendarEvents.js";
import { EventVolunteers } from "./screens/EventVolunteers.js";
import { VolunteerRedirect } from "./screens/VolunteerRedirect.js";

/** Shown while the session resolves. Renders the `.sd` token scope directly
 *  rather than going through AppShell: the shell's `.sd-app` is the mobile
 *  phone-frame column, so on a desktop it wrapped this spinner in a narrow
 *  drop-shadowed card that vanished the moment the real (full-width) screen
 *  took over. Nothing here needs a shell — there is no nav or app bar yet. */
function Loading() {
  return (
    <div className="sd">
      <div className="sd-boot">
        <div className="sd-spinner" />
        <div>
          <div className="sd-h2">Signing you in…</div>
          <div className="sd-lead" style={{ fontSize: 13.5, marginTop: 4 }}>One moment while we open the calendar.</div>
        </div>
      </div>
    </div>
  );
}

/** Members-only, like the directory. The gate is RequireAuth rather than the
 *  directory's RequireProfile: the calendar is shared, not Person-scoped, so
 *  there's no reason to push someone through profile onboarding to read it. */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { loading, me } = useSession();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/sign-in" replace />;
  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const { loading, me } = useSession();
  if (loading) return <Loading />;
  if (me) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Finish a deep sign-in. The magic link can only carry an ORIGIN (the API
 *  validates `returnTo` against ALLOWED_ORIGINS by exact match), so someone who
 *  started signing in from a volunteer sheet lands back at `/`. The path was
 *  stashed before they left; take it once they actually have a session.
 *  See lib/returnPath.ts. */
function ReturnToStashedPath() {
  const { loading, me } = useSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    // Only from the landing route, and only once signed in — otherwise a failed
    // link would yank someone off the agenda they deliberately opened.
    if (loading || !me || pathname !== "/") return;
    const path = takeReturnPath();
    if (path && path !== "/") navigate(path, { replace: true });
  }, [loading, me, pathname, navigate]);

  return null;
}

export function App() {
  return (
    <>
      <ReturnToStashedPath />
      <Routes>
        <Route path="/sign-in" element={<RedirectIfAuthed><SignIn /></RedirectIfAuthed>} />
        <Route path="/check-email" element={<CheckEmail />} />

        {/* Ungated on purpose: the agenda is public read-only. It reads the
            /calendar-public/* routes, which need no cookie, and the shell hides
            every member affordance when `me` is null. Admin stays gated below —
            both here and, authoritatively, on the server. */}
        <Route path="/" element={<Calendar />} />

        {/* A volunteer sheet no longer has a page of its own: the event page
            below renders the sheet inline, and this resolves the slug and
            forwards there. The URL is kept forever — it is what is circulating
            in text messages, and a slug is the only durable handle on a sheet.
            Ungated for the same reason the event page is, and it asks the
            anonymous endpoint when there's no session, so a signed-out reader
            gets counts and never names — see VolunteerRedirect.tsx. */}
        <Route path="/v/:slug" element={<VolunteerRedirect />} />

        {/* One event's own page, and ungated for the same reason again. The path
            is a CONTENT identity (day + title slug), not an id: an event has no
            durable public handle to put in a URL — see packages/shared/src/
            eventPath.ts. That is also why it works for an event imported from
            someone else's ICS feed, which has no durable id at all. */}
        <Route path="/e/:date/:slug" element={<Event />} />

        {/* Members only: the links are capabilities (migration 0045). */}
        <Route path="/albums" element={<RequireAuth><Albums /></RequireAuth>} />

        <Route path="/admin" element={<RequireAuth><Admin /></RequireAuth>} />
        <Route path="/admin/calendars/:id" element={<RequireAuth><CalendarEvents /></RequireAuth>} />
        <Route path="/admin/events/:id/volunteers" element={<RequireAuth><EventVolunteers /></RequireAuth>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
