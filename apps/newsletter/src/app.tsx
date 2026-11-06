import { Navigate, Route, Routes } from "react-router-dom";
import { useAccess } from "./lib/access.js";
import { useSession } from "./lib/session.js";
import { SignIn, CheckEmail } from "./screens/Onboarding.js";
import { Issues } from "./screens/Issues.js";
import { IssueEditor } from "./screens/IssueEditor.js";
import { IssuePrint } from "./screens/IssuePrint.js";
import { Metrics } from "./screens/Metrics.js";
import { Settings } from "./screens/Settings.js";
import { Subscribers } from "./screens/Subscribers.js";
import { Preferences } from "./screens/Preferences.js";
import { Unsubscribe } from "./screens/Unsubscribe.js";

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
          <div className="sd-lead" style={{ fontSize: 13.5, marginTop: 4 }}>One moment while we open the newsletter.</div>
        </div>
      </div>
    </div>
  );
}

/** Members-only, like the calendar app — the gate is RequireAuth rather than the
 *  directory's RequireProfile, since nothing here is Person-scoped. */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { loading, me } = useSession();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/sign-in" replace />;
  return <>{children}</>;
}

/** Authoring is for editors: system admins and the roster of the editors group
 *  (invariant 31). A signed-in member who is neither is sent to the one screen
 *  that is theirs rather than shown a bare "forbidden". Both gates here are UI
 *  conveniences — every authoring route re-asks the same question server-side. */
function RequireEditor({ children }: { children: React.ReactNode }) {
  const { loading: sessionLoading, me } = useSession();
  const { loading, access } = useAccess();
  if (sessionLoading || loading) return <Loading />;
  if (!me) return <Navigate to="/sign-in" replace />;
  if (!access?.canUse) return <Navigate to="/preferences" replace />;
  return <>{children}</>;
}

/** Settings and the subscriber list stay with system admins — the subscriber
 *  list is email addresses, and the settings screen is where the editors group
 *  itself is named. An editor who lands here goes back to the issues. */
function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { loading, me } = useSession();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/sign-in" replace />;
  if (!me.user.isSystemAdmin) return <Navigate to="/admin" replace />;
  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const { loading, me } = useSession();
  if (loading) return <Loading />;
  if (me) return <Navigate to="/app" replace />;
  return <>{children}</>;
}

/** Where "home" is depends on who you are: editors author, members subscribe.
 *  In production `/` never reaches this router — the public archive at `/` and
 *  `/n/:slug` is served by Pages Functions, and _redirects only falls back to
 *  this bundle for the routes below. It matters in `vite dev`, where there are
 *  no Functions.
 *
 *  Because `/` is unreachable in production, `/app` is mounted on this same
 *  component as the app's real entry point: it is the ONE URL that sibling apps
 *  and the public archive can link to without knowing whether the visitor is an
 *  admin, a member, or signed out. Link there, not at the bare origin — the bare
 *  origin is the reader-facing archive and has no way into the app. */
function Home() {
  const { loading, me } = useSession();
  const { loading: accessLoading, access } = useAccess();
  if (loading || accessLoading) return <Loading />;
  if (!me) return <Navigate to="/sign-in" replace />;
  return <Navigate to={access?.canUse ? "/admin" : "/preferences"} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<RedirectIfAuthed><SignIn /></RedirectIfAuthed>} />
      <Route path="/check-email" element={<CheckEmail />} />

      {/* No auth: the link arrives in an email, and requiring a sign-in to stop
          receiving mail is exactly the dark pattern the unsubscribe rules exist
          to prevent. */}
      <Route path="/unsubscribe/:token" element={<Unsubscribe />} />

      <Route path="/preferences" element={<RequireAuth><Preferences /></RequireAuth>} />

      <Route path="/admin" element={<RequireEditor><Issues /></RequireEditor>} />
      <Route path="/admin/issues/:id" element={<RequireEditor><IssueEditor /></RequireEditor>} />
      {/* No Function claims /admin/*, so this falls through to the bundle — see
          ROUTING.md before adding a Function anywhere near it. */}
      <Route path="/admin/issues/:id/print" element={<RequireEditor><IssuePrint /></RequireEditor>} />
      <Route path="/admin/metrics" element={<RequireEditor><Metrics /></RequireEditor>} />
      <Route path="/admin/settings" element={<RequireAdmin><Settings /></RequireAdmin>} />
      <Route path="/admin/subscribers" element={<RequireAdmin><Subscribers /></RequireAdmin>} />

      {/* The production entry point — see Home. `/` only resolves here in dev. */}
      <Route path="/app" element={<Home />} />
      <Route path="/" element={<Home />} />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
