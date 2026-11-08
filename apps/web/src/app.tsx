import { useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useSession } from "./lib/session.js";
import { CALENDAR_APP_URL } from "./lib/api.js";
import { AppShell } from "./components/AppShell.js";
import { Btn } from "./components/atoms.js";
import { Icon } from "./components/Icon.js";
import { SignIn, CheckEmail } from "./screens/Onboarding.js";
import { Home } from "./screens/Home.js";
import { ProfileView, ProfileEdit } from "./screens/Profile.js";
import { GroupDetail, GroupsIndex } from "./screens/Group.js";
import { Admin } from "./screens/Admin.js";
import { Import } from "./screens/Import.js";
import { Metrics } from "./screens/Metrics.js";
import { Directory } from "./screens/Directory.js";
import { Access, RequireApproved } from "./screens/Access.js";
import { Welcome } from "./screens/Welcome.js";
import { AddPerson } from "./screens/AddPerson.js";
import { DesktopShell } from "./components/DesktopShell.js";
import { useIsDesktop } from "./lib/useIsDesktop.js";

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
          <div className="sd-lead" style={{ fontSize: 13.5, marginTop: 4 }}>One moment while we open the directory.</div>
        </div>
      </div>
    </div>
  );
}

function Stub({ title, nav = "home" }: { title: string; nav?: "home" | "dir" | "groups" | "me" }) {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const body = (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 40, textAlign: "center", minHeight: 280 }}>
      <Icon name="bolt" size={30} style={{ color: "var(--ink-3)" }} />
      <div>
        <div className="sd-h2">{title}</div>
        <p className="sd-lead" style={{ fontSize: 13.5, marginTop: 6 }}>This area arrives in a later milestone (see PLAN.md).</p>
      </div>
      <Btn kind="secondary" icon="arrowleft" onClick={() => navigate("/")}>Home</Btn>
    </div>
  );
  if (isDesktop) return <DesktopShell active={nav} title={title}>{body}</DesktopShell>;
  return <AppShell><div className="sd-scroll">{body}</div></AppShell>;
}

/** The calendar now lives on its own site. This keeps old /calendar bookmarks and
 *  deep links working instead of dropping them on the catch-all redirect to Home.
 *  `replace` so the back button returns to wherever the member actually came
 *  from, rather than bouncing them straight back out again. */
function ExternalRedirect({ to }: { to: string }) {
  useEffect(() => {
    window.location.replace(to);
  }, [to]);
  return <Loading />;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { loading, me } = useSession();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/sign-in" replace />;
  return <>{children}</>;
}

/** Auth entry points (sign-in). A visitor who already has a valid session is
 *  sent straight to Home rather than shown the login form. */
function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const { loading, me } = useSession();
  if (loading) return <Loading />;
  if (me) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Routes that act on an active Person; a user with none is sent to onboarding. */
function RequireProfile({ children }: { children: React.ReactNode }) {
  const { loading, me } = useSession();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/sign-in" replace />;
  if (me.persons.length === 0) return <Navigate to="/welcome" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<RedirectIfAuthed><SignIn /></RedirectIfAuthed>} />
      <Route path="/check-email" element={<CheckEmail />} />

      <Route path="/welcome" element={<RequireAuth><Welcome /></RequireAuth>} />

      <Route path="/" element={<RequireProfile><Home /></RequireProfile>} />
      <Route path="/persons/new" element={<RequireProfile><AddPerson /></RequireProfile>} />
      <Route path="/persons/:id" element={<RequireProfile><ProfileView /></RequireProfile>} />
      <Route path="/persons/:id/edit" element={<RequireProfile><ProfileEdit /></RequireProfile>} />
      <Route path="/persons/:id/invite" element={<RequireProfile><Stub title="Invite a co-manager" /></RequireProfile>} />

      <Route path="/calendar" element={<ExternalRedirect to={CALENDAR_APP_URL} />} />
      {/* Invariant 32: these three serve OTHER families, so they wait behind
          the approval gate. Everything else — the calendar, volunteering, the
          newsletter and a member's own family — stays open to any account, so
          a family waiting on review still has a site to use. */}
      <Route path="/directory" element={<RequireProfile><RequireApproved><Directory /></RequireApproved></RequireProfile>} />
      <Route path="/groups" element={<RequireProfile><RequireApproved><GroupsIndex /></RequireApproved></RequireProfile>} />
      <Route path="/groups/:id" element={<RequireProfile><RequireApproved><GroupDetail /></RequireApproved></RequireProfile>} />
      <Route path="/access" element={<RequireAuth><Access /></RequireAuth>} />
      <Route path="/you" element={<RequireProfile><Stub title="You" nav="me" /></RequireProfile>} />
      <Route path="/admin" element={<RequireAuth><Admin /></RequireAuth>} />
      <Route path="/admin/import" element={<RequireAuth><Import /></RequireAuth>} />
      <Route path="/admin/metrics" element={<RequireAuth><Metrics /></RequireAuth>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
