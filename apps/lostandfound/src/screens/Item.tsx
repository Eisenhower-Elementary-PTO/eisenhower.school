// One found item, publicly, and the "that's mine" form.
//
// The claim needs no account (invariant 33) — the family most likely to have
// lost a water bottle is not necessarily one with a directory login. The server
// answers `{ ok: true }` whatever it decided (a per-address cap, the daily
// ceiling, the honeypot), so this screen shows the same thank-you every time;
// that sameness is the point, not a shortcut.
//
// The description is the model's, in English, and is shown as written with a
// note saying so. It is content rather than chrome, so it is not translated —
// the rule invariant 6 sets for member-entered text.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { LfPublicItemDTO } from "@sd/shared";
import { Screen } from "../components/Screen.js";
import { Swatch } from "../components/items.js";
import { Btn } from "../components/atoms.js";
import { useI18n } from "../i18n/index.js";
import { useAccess } from "../lib/access.js";
import { useSession } from "../lib/session.js";
import { ApiError, api } from "../lib/api.js";
import { loadClaimDefaults, saveClaimDefaults } from "../lib/claimDraft.js";
import { categoryLabel, colorLabel, formatDay } from "../lib/lf.js";

export function Item() {
  const { t } = useI18n();
  const { id = "" } = useParams();
  // Staff browsing the public site are where a wrong description gets noticed,
  // so they get a way straight into the editor. Nobody else sees the link.
  const { access } = useAccess();
  const [item, setItem] = useState<LfPublicItemDTO | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "gone" | "error">("loading");

  useEffect(() => {
    setState("loading");
    api
      .item(id)
      .then((it) => {
        setItem(it);
        setState("ready");
      })
      .catch((err) => setState(err instanceof ApiError && err.status === 404 ? "gone" : "error"));
  }, [id]);

  const title = item ? item.title || t("lfDescribing") : t("navLostFound");

  return (
    <Screen active="browse" title={t("navLostFound")} back="/">
      <div className="lf-page">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <Link className="sd-link" to="/" style={{ fontSize: 14 }}>
            ← {t("lfBackToAll")}
          </Link>
          {access?.canUse && state === "ready" && (
            <Link className="sd-link" to={`/staff/item/${encodeURIComponent(id)}`} style={{ fontSize: 14 }}>
              {t("lfStaffEdit")}
            </Link>
          )}
        </div>

        {state === "loading" && (
          <div className="sd-boot" style={{ minHeight: 200 }}>
            <div className="sd-spinner" />
          </div>
        )}
        {state === "gone" && <div className="lf-notice">{t("lfItemGone")}</div>}
        {state === "error" && <div className="lf-notice warn" role="alert">{t("lfLoadError")}</div>}

        {state === "ready" && item && (
          <div className="lf-detail">
            <img className="lf-photo" src={item.photoUrl} alt={title} />
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <h1 className="sd-h1">{title}</h1>
              {item.pending ? (
                <p className="sd-meta">{t("lfPendingNote")}</p>
              ) : (
                item.description && (
                  <div>
                    <p className="sd-lead" style={{ margin: 0 }}>{item.description}</p>
                    <p className="sd-meta" style={{ marginTop: 6 }}>{t("lfAutoDescribed")}</p>
                  </div>
                )
              )}
              <Facts item={item} />
              {item.tags.length > 0 && (
                <div className="lf-tags">
                  {item.tags.map((tag) => (
                    <span key={tag} className="sd-tag line">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <ClaimPanel itemId={item.id} />
            </div>
          </div>
        )}
      </div>
    </Screen>
  );
}

function Facts({ item }: { item: LfPublicItemDTO }) {
  const { t, locale } = useI18n();
  const rows: [string, React.ReactNode][] = [];
  if (item.category) rows.push([t("lfFactCategory"), categoryLabel(t, item.category)]);
  if (item.colors.length)
    rows.push([
      t("lfFactColors"),
      <span key="c" style={{ display: "inline-flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {item.colors.map((c) => (
          <span key={c} style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
            <Swatch color={c} />
            {colorLabel(t, c)}
          </span>
        ))}
      </span>,
    ]);
  if (item.brand) rows.push([t("lfFactBrand"), item.brand]);
  if (item.material) rows.push([t("lfFactMaterial"), item.material]);
  if (item.location) rows.push([t("lfFactWhere"), item.location]);
  rows.push([t("lfFactFound"), formatDay(item.foundAt, locale)]);
  return (
    <dl className="lf-facts">
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function ClaimPanel({ itemId }: { itemId: string }) {
  const { t, locale } = useI18n();
  const { me, displayName, loading: sessionLoading } = useSession();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [childName, setChildName] = useState("");
  const [teacher, setTeacher] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(false);

  // Prefill, once the session question is answered — and not before, so the
  // two sources can't race. Signed in: the account email (it has already
  // received a magic link, and the server marks a claim typed with it as
  // verified). Signed out: what this device remembers (lib/claimDraft.ts) —
  // the same family loses things all year. NEVER the remembered values while
  // signed in: on a shared family device they may be the OTHER parent's, and
  // a notification would go to the wrong inbox. Only empty fields are filled;
  // anything typed wins.
  useEffect(() => {
    if (sessionLoading) return;
    if (me) {
      const email = me.user.email;
      setContact((v) => v || email);
      if (displayName && displayName !== email) setName((v) => v || displayName);
    } else {
      const d = loadClaimDefaults();
      setName((v) => v || d.name);
      setContact((v) => v || d.contact);
      setChildName((v) => v || d.childName);
      setTeacher((v) => v || d.teacher);
    }
  }, [sessionLoading, me, displayName]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || contact.trim().length < 3) {
      setError(true);
      return;
    }
    setBusy(true);
    setError(false);
    try {
      // `lang` is the language this form was read in — what the return
      // notification will answer in (migration 0044).
      await api.claim(itemId, { name, contact, childName, teacher, message, website, lang: locale });
      // Remember the stable fields on this device for the next claim — but
      // only KNOWN signed out: a signed-in member prefills from their session,
      // and a shared family device shouldn't offer one parent's details to the
      // other (nor save anything while the session is still being resolved).
      if (!sessionLoading && !me) {
        saveClaimDefaults({
          name: name.trim(),
          contact: contact.trim(),
          childName: childName.trim(),
          teacher: teacher.trim(),
        });
      }
      setSent(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <section className="sd-card sd-card-pad" aria-live="polite">
        <h2 className="sd-h2">{t("lfClaimThanksTitle")}</h2>
        <p className="sd-lead" style={{ marginTop: 6 }}>{t("lfClaimThanksBody")}</p>
      </section>
    );
  }

  return (
    <section className="sd-card sd-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h2 className="sd-h2">{t("lfClaimTitle")}</h2>
      <p className="sd-meta" style={{ margin: 0 }}>{t("lfClaimLead")}</p>
      {!open ? (
        <Btn onClick={() => setOpen(true)} style={{ alignSelf: "flex-start" }}>
          {t("lfClaimCta")}
        </Btn>
      ) : (
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10, position: "relative" }}>
          <label className="sd-label" htmlFor="lf-claim-name">{t("lfClaimName")}</label>
          <input
            id="lf-claim-name"
            className="sd-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            autoComplete="name"
            required
            autoFocus
          />
          <label className="sd-label" htmlFor="lf-claim-contact">{t("lfClaimContact")}</label>
          <input
            id="lf-claim-contact"
            className="sd-input"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            maxLength={200}
            autoComplete="email"
            required
          />
          <p className="sd-meta" style={{ margin: 0 }}>{t("lfClaimContactHint")}</p>
          {/* Whose child it is and their teacher, so the office can send the
              item home through the classroom. Optional: the item may be the
              claimant's own, or they may not know the room. */}
          <label className="sd-label" htmlFor="lf-claim-child">{t("lfClaimChild")}</label>
          <input
            id="lf-claim-child"
            className="sd-input"
            value={childName}
            onChange={(e) => setChildName(e.target.value)}
            maxLength={100}
            autoComplete="off"
          />
          <label className="sd-label" htmlFor="lf-claim-teacher">{t("lfClaimTeacher")}</label>
          <input
            id="lf-claim-teacher"
            className="sd-input"
            value={teacher}
            onChange={(e) => setTeacher(e.target.value)}
            maxLength={100}
            autoComplete="off"
          />
          <label className="sd-label" htmlFor="lf-claim-message">{t("lfClaimMessage")}</label>
          <textarea
            id="lf-claim-message"
            className="sd-input"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder={t("lfClaimMessageHint")}
          />
          {/* Honeypot. A person never sees it; a script filling every field
              does, and the server quietly drops what it sends. Hidden by
              position rather than `display:none`, which some bots skip. */}
          <div className="lf-honeypot" aria-hidden="true">
            <label htmlFor="lf-claim-website">Website</label>
            <input
              id="lf-claim-website"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </div>
          {error && <div className="lf-notice warn" role="alert">{t("lfClaimError")}</div>}
          <p className="sd-meta" style={{ margin: 0 }}>{t("lfClaimPrivacy")}</p>
          <Btn type="submit" disabled={busy} style={{ alignSelf: "flex-start" }}>
            {busy ? t("lfClaimSending") : t("lfClaimSend")}
          </Btn>
        </form>
      )}
    </section>
  );
}
