// Desktop layout: 244px sidebar nav + sticky header. Same structure as the
// directory app's, minus its member search box (there's nothing to search here)
// and with an account pill in place of the Person switcher.
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "./Icon.js";
import { Avatar } from "./atoms.js";
import { AccountSheet, LanguageSheet, LanguageButton } from "./Sheets.js";
import { MasqueradeBanner, isFullNavigation, navItems, type NavKey } from "./AppShell.js";
import { SiteFooter } from "./SiteFooter.js";
import { PlatformNav } from "./AppSwitcher.js";
import { useI18n } from "../i18n/index.js";
import { useSession } from "../lib/session.js";

function Sidebar({ active }: { active: NavKey }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { me } = useSession();
  const items = navItems(t, !!me?.user.isSystemAdmin, !!me);

  return (
    <aside className="sd-desknav">
      <div style={{ padding: "0 8px 18px" }}>
        <div className="sd-row" style={{ gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: "var(--blue)", color: "var(--on-brand)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
            <Icon name="calendar" size={19} stroke={1.9} />
          </div>
          <div style={{ lineHeight: 1.05 }}>
            <div style={{ fontSize: 15.5, fontWeight: 800, letterSpacing: "-.4px" }}>{t("brand")}</div>
            <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: ".8px", textTransform: "uppercase", color: "var(--ink-3)" }}>{t("brandSubCalendar")}</div>
          </div>
        </div>
      </div>
      <nav style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {items.map(([icon, key, label, path]) => (
          <button
            key={key}
            className={`sd-desknav-item${key === active ? " on" : ""}`}
            onClick={() => (isFullNavigation(path) ? (window.location.href = path) : navigate(path))}
          >
            <Icon name={icon} size={20} stroke={key === active ? 2.1 : 1.8} />{label}
          </button>
        ))}
      </nav>
      <div style={{ flex: 1 }} />
      {/* The platform switcher, at the foot of the sidebar in every app so it is
          in the same place wherever a member is. See AppSwitcher.tsx. */}
      <PlatformNav />
    </aside>
  );
}

export function DesktopShell({
  active,
  title,
  breadcrumb,
  children,
}: {
  active: NavKey;
  title: string;
  breadcrumb?: ReactNode;
  children: ReactNode;
}) {
  const { t, locale } = useI18n();
  const { me, displayName, loading } = useSession();
  const navigate = useNavigate();
  const [sheet, setSheet] = useState<"account" | "language" | null>(null);

  return (
    <div className={`sd sd-desktop ${locale === "zh" ? "sd-zh" : ""}`}>
      <Sidebar active={active} />
      <div className="sd-deskmain">
        <MasqueradeBanner />
        <header className="sd-deskhead">
          <h1 className="sd-h2" style={{ fontSize: 20, flex: "0 0 auto" }}>{title}</h1>
          <div style={{ flex: 1 }} />
          <LanguageButton onClick={() => setSheet("language")} />
          {me && (
            <button className="sd-deskswitch" onClick={() => setSheet("account")}>
              <Avatar name={displayName} size={32} color="var(--blue)" />
              <div style={{ lineHeight: 1.1, textAlign: "left" }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{displayName}</div>
                <div style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 600 }}>{me.user.email}</div>
              </div>
              <Icon name="chevdown" size={15} stroke={2.2} style={{ color: "var(--ink-3)" }} />
            </button>
          )}
          {/* The agenda is public, so this slot would otherwise be empty for a
              signed-out visitor and leave a member no visible way back in. */}
          {!me && !loading && (
            <button className="sd-btn sd-btn-ghost sd-btn-sm" onClick={() => navigate("/sign-in")}>
              {t("signInCta")}
            </button>
          )}
        </header>
        <div className="sd-deskbody">
          {breadcrumb}
          {children}
          {/* Last child of the flex column, so its `margin-top: auto` pins it to
              the bottom of the viewport on a short page and simply follows the
              content on a long one. One seam covers every desktop screen. */}
          <SiteFooter />
        </div>
      </div>
      {sheet === "account" && <AccountSheet onClose={() => setSheet(null)} />}
      {sheet === "language" && <LanguageSheet onClose={() => setSheet(null)} />}
    </div>
  );
}
