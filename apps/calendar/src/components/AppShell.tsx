// The app frame: .sd scope + centered column, optional banners + bottom nav.
// Mirrors the directory app's shell so the two sites read as one system; the nav
// item list is this app's own (calendar + admin, plus a link back to directory).
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

/** Persistent masquerade banner. The session is shared with the directory, so an
 *  admin who started masquerading there is still masquerading here. */
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

export type NavKey = "calendar" | "albums" | "admin";

/** This app's OWN screens. The directory and the newsletter used to be here as
 *  absolute URLs; they are now in the platform switcher (AppSwitcher.tsx). One
 *  list, read by both the bottom bar and the desktop sidebar. (The /volunteers
 *  index briefly lived here too; it moved to the PTO site's landing page,
 *  which renders the same anonymous reads server-side.) */
export function navItems(t: ReturnType<typeof useI18n>["t"], isSystemAdmin: boolean, signedIn = false) {
  const items: [IconName, NavKey, string, string][] = [
    ["calendar", "calendar", t("navCalendar"), "/"],
  ];
  // Event photo albums: links are capabilities, so the tab is for members only.
  if (signedIn) items.push(["photo", "albums", t("navAlbums"), "/albums"]);
  if (isSystemAdmin) items.push(["shield", "admin", t("navAdmin"), "/admin"]);
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
  const items = navItems(t, !!me?.user.isSystemAdmin, !!me);

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
