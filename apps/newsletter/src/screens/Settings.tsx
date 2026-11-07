// Newsletter configuration: who it comes from, what the footer says, how it
// looks, and what a new events block defaults to. One JSON blob behind the
// existing `setting` table, so this is a plain load/edit/save form.

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { NewsletterSettingsDTO, NotifyMode } from "@sd/shared";
import { sanitizeFooterHtml } from "@sd/shared";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader, Field, SectLabel } from "../components/parts.js";
import { Btn } from "../components/atoms.js";
import { Icon } from "../components/Icon.js";
import { FooterEditor } from "../components/editor/FooterEditor.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { useCalendarFeeds } from "../lib/useCalendarFeeds.js";
import { api, errorMessage, DIRECTORY_URL } from "../lib/api.js";
import { useAccess } from "../lib/access.js";

const LOOKAHEAD_CHOICES = [7, 14, 30, 60];

/** Admin-facing copy, hardcoded like the rest of this screen. The authoring
 *  side is English-only by convention (see lib/email.ts) — invariant 6's i18n
 *  rule governs member-facing UI, which this isn't. */
const NOTIFY_CHOICES: { mode: NotifyMode; label: string; detail: string }[] = [
  { mode: "off", label: "Off", detail: "Nobody is emailed when someone subscribes." },
  {
    mode: "instant",
    label: "Instant",
    detail: "Every system admin gets one email per confirmed subscriber, as it happens.",
  },
  {
    mode: "daily",
    label: "Daily digest",
    detail:
      "One email each morning listing everyone who confirmed since the last digest. Turning this on starts counting now — subscribers from before today aren't replayed.",
  },
];

/** Which group's roster may author the newsletter (invariant 31).
 *
 *  Its own save, not part of the form below: the route behind it
 *  (`PUT /newsletter/editors`) is the single lever over who may write to every
 *  subscriber's inbox, so it is audited on its own and takes effect the moment
 *  a group is tapped rather than riding along on the next "Save settings". The
 *  group is an ordinary generic group, rostered in the directory — no second
 *  membership model. With nothing chosen, only system admins author; that is
 *  the bootstrap state, not a broken one. */
function EditorsPicker() {
  const { access, refresh } = useAccess();
  const [groups, setGroups] = useState<{ id: string; name: string; memberCount: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .editorGroups()
      .then((r) => setGroups(r.groups))
      .catch(() => setGroups([]));
  }, []);

  const choose = async (groupId: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await api.setEditorGroup(groupId);
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Couldn't save that."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="nlx-formgrid">
      <SectLabel>Editors</SectLabel>
      <p className="sd-meta" style={{ margin: 0 }}>
        Pick the group whose members may write, preview and send issues. Anyone who controls a
        Person on its roster gets in; system admins always do. Settings and the subscriber list
        stay with system admins. Until you pick one, only system admins can author.
      </p>
      <p className="sd-meta" style={{ margin: 0 }}>
        Groups and their rosters are managed in the directory —{" "}
        <a className="sd-link" href={`${DIRECTORY_URL}/groups`}>
          {DIRECTORY_URL.replace(/^https?:\/\//, "")}
        </a>
        . Only <b>generic</b> groups are offered here: a household or a classroom is a different
        kind of thing and shouldn't double as a committee.
      </p>

      {error && <p className="sd-meta" style={{ color: "var(--warn)", margin: 0 }}>{error}</p>}

      {groups === null ? (
        <div className="sd-meta">Loading…</div>
      ) : groups.length === 0 ? (
        <div className="sd-card sd-card-pad">
          <div style={{ fontWeight: 700 }}>No groups yet</div>
          <p className="sd-meta" style={{ marginTop: 6 }}>
            Create one in the directory (Admin → Groups), add the editors to it, then come back
            here.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {groups.map((g) => {
            const on = access?.groupId === g.id;
            return (
              <button
                key={g.id}
                type="button"
                className="sd-row"
                disabled={busy}
                onClick={() => void choose(on ? null : g.id)}
                style={{
                  gap: 12,
                  padding: "13px 14px",
                  borderRadius: 12,
                  width: "100%",
                  textAlign: "left",
                  font: "inherit",
                  cursor: "pointer",
                  border: `1px solid ${on ? "var(--blue)" : "var(--line)"}`,
                  background: on ? "var(--blue-tint)" : "var(--paper)",
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{g.name}</div>
                  <div className="sd-meta">
                    {g.memberCount} {g.memberCount === 1 ? "member" : "members"}
                  </div>
                </div>
                {on && <span className="sd-meta" style={{ fontWeight: 700 }}>Selected</span>}
              </button>
            );
          })}
        </div>
      )}

      {access?.groupId && (
        <div>
          <Btn kind="ghost" disabled={busy} onClick={() => void choose(null)}>
            Clear — system admins only
          </Btn>
        </div>
      )}
    </section>
  );
}

export function Settings() {
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const feeds = useCalendarFeeds();
  const logoInput = useRef<HTMLInputElement>(null);

  const [settings, setSettings] = useState<NewsletterSettingsDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .settings()
      .then((r) => setSettings(r.settings))
      .catch((err: unknown) => setError(errorMessage(err, "Couldn't load settings.")));
  }, []);

  const edit = (patch: Partial<NewsletterSettingsDTO>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s));
    setNote(null);
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const r = await api.saveSettings(settings);
      // The server coerces each field; showing what it stored is more honest
      // than showing what was typed.
      setSettings(r.settings);
      setNote("Settings saved.");
    } catch (err) {
      setError(errorMessage(err, "Couldn't save settings."));
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (file: File) => {
    try {
      const { url } = await api.uploadMedia(file);
      edit({ logoUrl: url });
    } catch (err) {
      setError(errorMessage(err, "That logo couldn't be uploaded."));
    }
  };

  if (!settings) {
    return (
      <AppShell>
        <div className="sd-scroll" style={{ display: "grid", placeItems: "center" }}>
          {error ? <p className="sd-lead" style={{ color: "var(--warn)" }}>{error}</p> : <div className="sd-spinner" />}
        </div>
      </AppShell>
    );
  }

  const toggleCalendar = (calendarId: string) => {
    const ids = settings.defaultCalendarIds;
    edit({
      defaultCalendarIds: ids.includes(calendarId)
        ? ids.filter((c) => c !== calendarId)
        : [...ids, calendarId],
    });
  };

  const body = (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {error && <p className="sd-lead" style={{ color: "var(--warn)", margin: 0 }}>{error}</p>}

      <section className="nlx-formgrid">
        <SectLabel>Sender</SectLabel>
        <div className="nlx-formrow">
          <Field label="From name">
            <input className="sd-input" value={settings.senderName}
              onChange={(e) => edit({ senderName: e.target.value })} />
          </Field>
          <Field
            label="From address"
            hint="An address off the school's sending domain keeps its name but sends from the onboarded address (it stays as the reply-to). Leave blank to use the instance default."
          >
            <input className="sd-input" type="email" value={settings.senderEmail}
              placeholder="newsletter@example.school"
              onChange={(e) => edit({ senderEmail: e.target.value })} />
          </Field>
        </div>
        <Field label="Reply-to" hint="Optional. Where replies go, if not the From address.">
          <input className="sd-input" type="email" value={settings.replyTo ?? ""}
            onChange={(e) => edit({ replyTo: e.target.value || null })} />
        </Field>
      </section>

      <section className="nlx-formgrid">
        <SectLabel>Footer</SectLabel>
        <Field
          label="Footer"
          hint={
            <>
              Appears at the foot of the email and of every public archive page.
              The text-only part of the email gets this same markup flattened.
              Format it here, or switch to HTML for layout tables and inline{" "}
              <code>style</code> attributes — email clients ignore stylesheets.
              Scripts, styles and embeds are dropped when you save.
            </>
          }
        >
          <FooterEditor
            value={settings.footerHtml ?? ""}
            onChange={(footerHtml) => edit({ footerHtml })}
          />
        </Field>
        {(settings.footerHtml ?? "").trim() !== "" && (
          <Field
            label="Footer preview"
            hint="Rendered from the sanitized markup — this is what a reader gets, not what was typed."
          >
            {/* Safe by construction: the same sanitizer the server applies on
                save runs here first, so nothing outside the tag allowlist can
                reach the DOM. */}
            <div
              className="nlx-footer-preview"
              dangerouslySetInnerHTML={{ __html: sanitizeFooterHtml(settings.footerHtml ?? "") }}
            />
          </Field>
        )}
        <Field label="Mailing address" hint="Bulk email is expected to carry a physical address.">
          <textarea className="sd-input" rows={2} value={settings.mailingAddress}
            onChange={(e) => edit({ mailingAddress: e.target.value })} />
        </Field>
        <Field label="Unsubscribe wording" hint="Appears just before the unsubscribe link.">
          <input className="sd-input" value={settings.unsubscribeWording}
            onChange={(e) => edit({ unsubscribeWording: e.target.value })} />
        </Field>
      </section>

      <section className="nlx-formgrid">
        <SectLabel>Branding</SectLabel>
        <Field label="Newsletter title" hint="The masthead, shown above every issue.">
          <input className="sd-input" value={settings.newsletterTitle}
            onChange={(e) => edit({ newsletterTitle: e.target.value })} />
        </Field>
        <div className="nlx-formrow">
          <Field label="Accent color" hint="Hex, e.g. #0068A8.">
            <div className="sd-row" style={{ gap: 8 }}>
              <input type="color" value={settings.accentColor} aria-label="Accent color"
                style={{ width: 44, height: 40, padding: 2, border: "1px solid var(--line)", borderRadius: 9, background: "var(--paper)" }}
                onChange={(e) => edit({ accentColor: e.target.value.toUpperCase() })} />
              <input className="sd-input" value={settings.accentColor}
                onChange={(e) => edit({ accentColor: e.target.value })} />
            </div>
          </Field>
          <Field label="Logo" hint="Optional. Replaces the title text in the masthead.">
            <div className="sd-row" style={{ gap: 8, flexWrap: "wrap" }}>
              {settings.logoUrl && (
                <img src={settings.logoUrl} alt="" style={{ height: 40, borderRadius: 6 }} />
              )}
              <button className="sd-btn sd-btn-ghost" onClick={() => logoInput.current?.click()}>
                <Icon name="upload" size={16} /> {settings.logoUrl ? "Replace" : "Upload"}
              </button>
              {settings.logoUrl && (
                <button className="sd-btn sd-btn-ghost" onClick={() => edit({ logoUrl: null })}>Remove</button>
              )}
              <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void uploadLogo(file);
                }} />
            </div>
          </Field>
        </div>
      </section>

      <section className="nlx-formgrid">
        <SectLabel>Event defaults</SectLabel>
        <p className="sd-meta" style={{ margin: 0 }}>
          Pre-fills each new “upcoming events” block. Individual blocks can still
          override both.
        </p>
        <Field label="Default window">
          <div className="nlx-chips">
            {LOOKAHEAD_CHOICES.map((d) => (
              <button key={d} type="button"
                className={`nlx-chip${d === settings.defaultLookaheadDays ? " on" : ""}`}
                onClick={() => edit({ defaultLookaheadDays: d })}>
                {d} days
              </button>
            ))}
          </div>
        </Field>
        <Field label="Default calendars" hint="None selected means every calendar.">
          <div className="nlx-chips">
            <button type="button"
              className={`nlx-chip${settings.defaultCalendarIds.length === 0 ? " on" : ""}`}
              onClick={() => edit({ defaultCalendarIds: [] })}>
              All
            </button>
            {feeds.map((f) => (
              <button key={f.id} type="button"
                className={`nlx-chip${settings.defaultCalendarIds.includes(f.id) ? " on" : ""}`}
                onClick={() => toggleCalendar(f.id)}>
                <span className="nlx-dot" style={{ background: f.color }} />
                {f.name}
              </button>
            ))}
          </div>
        </Field>
      </section>

      <EditorsPicker />

      <section className="nlx-formgrid">
        <SectLabel>Notifications</SectLabel>
        <Field
          label="New subscribers"
          hint="Emails every system admin when someone confirms a subscription on the public sign-up page. Addresses you add yourself, here or by import, never notify."
        >
          <div className="nlx-chips">
            {NOTIFY_CHOICES.map((choice) => (
              <button key={choice.mode} type="button"
                className={`nlx-chip${settings.newSubscriberNotify === choice.mode ? " on" : ""}`}
                onClick={() => edit({ newSubscriberNotify: choice.mode })}>
                {choice.label}
              </button>
            ))}
          </div>
        </Field>
        <p className="sd-meta" style={{ margin: 0 }}>
          {NOTIFY_CHOICES.find((c) => c.mode === settings.newSubscriberNotify)?.detail}
        </p>
      </section>

      <div className="sd-row" style={{ gap: 12 }}>
        <Btn icon="check" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </Btn>
        {note && <span className="sd-meta">{note}</span>}
        <div style={{ flex: 1 }} />
        <button className="sd-btn sd-btn-ghost" onClick={() => navigate("/admin/subscribers")}>
          <Icon name="users3" size={16} /> Subscribers
        </button>
      </div>
    </div>
  );

  if (desktop) {
    return <DesktopShell active="admin" title="Newsletter settings">{body}</DesktopShell>;
  }
  return (
    <AppShell bottomNav={<BottomNav active="admin" />}>
      <ScreenHeader title="Settings" onLeft={() => navigate("/admin")} />
      <div className="sd-scroll" style={{ padding: "14px 16px 24px" }}>{body}</div>
    </AppShell>
  );
}
