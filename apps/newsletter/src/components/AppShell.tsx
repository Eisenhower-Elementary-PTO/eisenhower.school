// The app frame: .sd scope + centered column, optional banners + bottom nav.
// Mirrors the directory and calendar apps' shells so all three sites read as one
// system; the nav item list is this app's own (issues + admin, plus links back to
// the directory and the calendar).
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Icon, type IconName } from "./Icon.js";
import { OfflineBanner, MasqBanner } from "./parts.js";
import { ChromeProvider, useChrome } from "./chrome.js";
import { AccountSheet, LanguageSheet } from "./Sheets.js";
import { AppsSheet } from "./AppSwitcher.js";
import { useOnline } from "../lib/useOnline.js";
import { useI18n } from "../i18n/index.js";
import { useSession } from "../lib/session.js";
import { useAccess } from "../lib/access.js";

/** Renders whichever app-bar sheet the chrome context has open, so every mobile
 *  ScreenHeader can reach the language picker and the account menu. */
function ChromeSheets() {
  const chrome = useChrome();
  if (!chrome) return null;
  return (
    <>
      {chrome.sheet === "language" && <LanguageSheet onClose={chrome.close} />}
      {chrome.sheet === "account" && <AccountSheet onClose={chrome.close} />}
      {chrome.sheet === "apps" && <AppsSheet onClose={chrome.close} />}
    </>
  );
}

/** Persistent masquerade banner. The session is shared across all three apps, so
 *  an admin who started masquerading in the directory is still masquerading here. */
export function MasqueradeBanner() {
  const { t } = useI18n();
  const { isMasquerading, displayName, stopMasquerade } = useSession();
  if (!isMasquerading) return null;
  return (
    <MasqBanner
      user={displayName || "user"}
      text={t("masqViewingAs")}
      back={t("masqReturn")}
      onBack={() => void stopMasquerade()}
    />
  );
}

export function AppShell({
  children,
  bottomNav,
  banner,
}: {
  children: ReactNode;
  bottomNav?: ReactNode;
  banner?: ReactNode;
}) {
  const online = useOnline();
  const { t, locale } = useI18n();
  return (
    <div className={`sd ${locale === "zh" ? "sd-zh" : ""}`}>
      <div className="sd-app">
        <ChromeProvider>
          <MasqueradeBanner />
          {!online && <OfflineBanner text={t("offlineBanner")} readOnly={t("offlineReadOnly")} />}
          {banner}
          {children}
          {bottomNav}
          <ChromeSheets />
        </ChromeProvider>
      </div>
    </div>
  );
}

export type NavKey = "newsletter" | "metrics" | "admin";

/** This app's OWN screens. The directory and the calendar used to be here as
 *  absolute URLs; they are now in the platform switcher (AppSwitcher.tsx). One
 *  list, read by both the bottom bar and the desktop sidebar.
 *
 *  Two audiences, two tiers (invariant 31). An EDITOR — a system admin or
 *  someone on the editors group's roster — gets the issue list; everyone else
 *  lands on the preferences screen, the only thing here for them. The admin
 *  entry (settings, subscribers) is for system admins alone, since that is
 *  where the editors group itself is named. */
export function navItems(t: ReturnType<typeof useI18n>["t"], canEdit: boolean, isSystemAdmin: boolean) {
  const items: [IconName, NavKey, string, string][] = [
    ["mail", "newsletter", t("navNewsletter"), canEdit ? "/admin" : "/preferences"],
  ];
  // Readership of the public archive — an editor's view of their own work, so
  // it rides the editor tier, not the admin one (same split as the API's
  // GET /newsletter/metrics).
  if (canEdit) items.push(["eye", "metrics", t("navMetrics"), "/admin/metrics"]);
  if (isSystemAdmin) items.push(["shield", "admin", t("navAdmin"), "/admin/settings"]);
  return items;
}

/** Where a nav path goes. Nothing in this app's own list leaves the origin any
 *  more — the sibling apps are the switcher's job — so every entry is a router
 *  route. Kept as a function so the five shells read the same. */
export function isFullNavigation(_path: string): boolean {
  return false;
}

export function BottomNav({ active }: { active: NavKey }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const chrome = useChrome();
  const { me } = useSession();
  const { access } = useAccess();
  const items = navItems(t, !!access?.canUse, !!me?.user.isSystemAdmin);

  return (
    <nav className="sd-bottomnav">
      {items.map(([icon, key, label, path]) => (
        <NavTab
          key={key}
          icon={icon}
          label={label}
          on={key === active}
          onClick={() => (isFullNavigation(path) ? (window.location.href = path) : navigate(path))}
        />
      ))}
      {/* The platform switcher — the four sibling apps — is a sheet, not four
          more tabs: the bar stays this app's own, and leaving the site is one
          explicit gesture rather than a tab that looks like every other tab and
          reloads the browser. See AppSwitcher.tsx. */}
      <NavTab icon="grid" label={t("navApps")} on={false} onClick={() => chrome?.open("apps")} />
    </nav>
  );
}

function NavTab({ icon, label, on, onClick }: { icon: IconName; label: string; on: boolean; onClick: () => void }) {
  return (
    <button className={`sd-navitem${on ? " on" : ""}`} onClick={onClick}>
      <Icon name={icon} size={21} stroke={on ? 2.2 : 1.8} />
      <span style={{ fontSize: 10.5, fontWeight: on ? 700 : 600 }}>{label}</span>
    </button>
  );
}
