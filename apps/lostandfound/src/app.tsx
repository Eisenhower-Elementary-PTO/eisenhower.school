import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useAccess } from "./lib/access.js";
import { useSession } from "./lib/session.js";
import { rememberReturnPath, takeReturnPath } from "./lib/returnPath.js";
import { SignIn, CheckEmail } from "./screens/Onboarding.js";
import { Browse } from "./screens/Browse.js";
import { Item } from "./screens/Item.js";
import { NoAccess } from "./screens/NoAccess.js";
import { Submit } from "./screens/Submit.js";
import { Dashboard } from "./screens/staff/Dashboard.js";
import { Upload } from "./screens/staff/Upload.js";
import { Edit } from "./screens/staff/Edit.js";
import { Settings } from "./screens/staff/Settings.js";

/** Shown while the session and the staff gate resolve. Renders the `.sd`
 *  token scope directly rather than going through AppShell, for the reason the
 *  sibling apps give: `.sd-app` is the mobile phone-frame column, so on a
 *  desktop it would wrap a spinner in a narrow card. */
function Loading() {
  return (
    <div className="sd">
      <div className="sd-boot">
        <div className="sd-spinner" />
      </div>
    </div>
  );
}

/**
 * The staff screens' two gates, in order, and the order is the point.
 *
 * "Not signed in" and "signed in but not staff" are different answers with
 * different screens: the first gets a sign-in form (with the page they were
 * after remembered, see lib/returnPath.ts), the second gets NoAccess.
 *
 * Both are UI conveniences. Every `/lostfound/*` route re-resolves the same gate
 * server side, so this decides what to RENDER, never what is permitted.
 */
function RequireStaff({ children }: { children: React.ReactNode }) {
  const { loading: sessionLoading, me } = useSession();
  const { loading, access } = useAccess();
  const { pathname, search } = useLocation();
  if (sessionLoading || loading) return <Loading />;
  if (!me) {
    rememberReturnPath(pathname + search);
    return <Navigate to="/sign-in" replace />;
  }
  if (!access?.canUse) return <NoAccess />;
  return <>{children}</>;
}

/** Submitting a found item needs only a session — the server holds every
 *  member-submitted item for staff review, so there is no second gate here. */
function RequireSignedIn({ children }: { children: React.ReactNode }) {
  const { loading, me } = useSession();
  const { pathname, search } = useLocation();
  if (loading) return <Loading />;
  if (!me) {
    rememberReturnPath(pathname + search);
    return <Navigate to="/sign-in" replace />;
  }
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { loading, me } = useSession();
  const { pathname, search } = useLocation();
  if (loading) return <Loading />;
  if (!me) {
    rememberReturnPath(pathname + search);
    return <Navigate to="/sign-in" replace />;
  }
  if (!me.user.isSystemAdmin) return <Navigate to="/staff" replace />;
  return <>{children}</>;
}

/** A signed-in visitor on the sign-in page goes where their account can act:
 *  staff to their dashboard, everyone else to the submit screen — adding a
 *  found item is why a non-staff member signs in here at all. */
function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const { loading, me } = useSession();
  const { loading: accessLoading, access } = useAccess();
  if (loading || (me && accessLoading)) return <Loading />;
  if (me) return <Navigate to={access?.canUse ? "/staff" : "/submit"} replace />;
  return <>{children}</>;
}

/** Finish a deep sign-in. The magic link lands on `/` (it can only carry an
 *  origin); the staff page someone set out for was stashed before they left. */
function ReturnToStashedPath() {
  const { loading, me } = useSession();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();

  useEffect(() => {
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

        {/* Ungated on purpose (invariant 33): anyone may browse and claim. They
            read `/lostfound-public/*`, which needs no cookie and serves only the
            public projection. */}
        <Route path="/" element={<Browse />} />
        <Route path="/item/:id" element={<Item />} />

        {/* Any signed-in account; the server holds what they add for staff
            review before it can appear publicly (invariant 33). */}
        <Route path="/submit" element={<RequireSignedIn><Submit /></RequireSignedIn>} />

        <Route path="/staff" element={<RequireStaff><Dashboard /></RequireStaff>} />
        <Route path="/staff/upload" element={<RequireStaff><Upload /></RequireStaff>} />
        <Route path="/staff/item/:id" element={<RequireStaff><Edit /></RequireStaff>} />
        <Route path="/staff/settings" element={<RequireAdmin><Settings /></RequireAdmin>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
