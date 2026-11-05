// The volunteer positions block — the list of jobs on a sheet, the claim flow,
// and everything that follows from who is reading it.
//
// Extracted from the sheet's own page when the event page gained its own URL,
// and now the whole of what that page was: a sheet is rendered ONLY on the event
// page at /e/:date/:slug, and /v/:slug resolves the slug and forwards there
// (screens/VolunteerRedirect.tsx). One answer to "what does signing up look
// like", rather than two that drift.
//
// What it does NOT own is the fetch. The screen loads its own sheet — by the
// event's `volunteerSlug`, or by the slug a /v/ link forwarded in `?sheet=` —
// and must pick between two endpoints:
//
//   signed out → /volunteers-public/sheets/:slug — positions and filled counts
//   signed in  → /volunteers/sheets/:slug        — the same plus who took each spot
//
// That split is the product decision: a volunteer's name is member-only
// (CLAUDE.md invariant 1) while the sheet itself has to open from a text message
// with no account. It is enforced on the server; this component simply renders
// what it was handed. The narrower PublicVolunteerSheetDTO in the signed-out
// branch is what stops a future edit from rendering names that aren't there.
//
// Writes always require a session — there is no anonymous claim path — so the
// signed-out affordance is "sign in to volunteer".
import { useState } from "react";
import {
  eventPath,
  formatClock,
  googleCalendarUrl,
  volunteerEntryDetails,
  volunteerEntryTitle,
  volunteerShiftWindow,
} from "@sd/shared";
import { SCHOOL_TIME_ZONE } from "../lib/timezone.js";
import type {
  ControllablePersonDTO,
  PublicVolunteerSheetDTO,
  VolunteerPositionDTO,
  VolunteerSheetDTO,
} from "@sd/shared";
import { Icon } from "./Icon.js";
import { Avatar, Btn, Tag } from "./atoms.js";
import { Field, SheetOver } from "./parts.js";
import { LinkifiedText } from "./LinkifiedText.js";
import { useI18n, type I18nT } from "../i18n/index.js";
import { api, ApiError, DIRECTORY_URL } from "../lib/api.js";
import { useSession } from "../lib/session.js";

/** What every branch renders from. The public shape is the smaller of the two,
 *  so it is the common denominator: a member sheet is this plus `signups` on
 *  each position, which the UI treats as optional throughout. */
export type AnySheet = PublicVolunteerSheetDTO | VolunteerSheetDTO;

/** Signups exist only on the member shape. Reading them through this helper
 *  rather than a cast keeps "there are no names here" a type-level fact on the
 *  anonymous branch instead of an empty array someone might later fill. */
function signupsOf(p: VolunteerPositionDTO | AnySheet["positions"][number]): VolunteerPositionDTO["signups"] {
  return "signups" in p ? p.signups : [];
}

/** The runbook link, which exists only on the member shape (`publicSheetOf`
 *  withholds it — CLAUDE.md invariant 13's posture). A helper for signupsOf's
 *  reason, plus one more: VolunteerSheetDTO is structurally a SUBTYPE of
 *  PublicVolunteerSheetDTO, so any freshly computed union (a ternary, a `??`)
 *  collapses AnySheet to just the public shape and an in-place `"runbookUrl" in
 *  sheet` check types as `unknown` there. The declared parameter type here
 *  keeps both constituents, so the narrowing works in exactly one place. */
export function runbookOf(sheet: AnySheet): string | null {
  return "runbookUrl" in sheet ? sheet.runbookUrl : null;
}

function formatTime(iso: string, locale: string): string {
  return formatClock(iso, locale, SCHOOL_TIME_ZONE);
}

/** "5:00 – 7:00 PM" for a position's optional shift window. */
function shiftLabel(startsAt: string | null, endsAt: string | null, locale: string): string | null {
  if (!startsAt && !endsAt) return null;
  if (startsAt && endsAt) return `${formatTime(startsAt, locale)} – ${formatTime(endsAt, locale)}`;
  return formatTime((startsAt ?? endsAt)!, locale);
}

/** Filled/needed, as a bar plus a count. Both audiences see this; it is the
 *  entire signed-out story about a position. */
function Progress({ filled, slots, t }: { filled: number; slots: number; t: I18nT }) {
  const pct = slots > 0 ? Math.min(100, Math.round((filled / slots) * 100)) : 0;
  const full = filled >= slots;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
      <div className="sd-row" style={{ gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: full ? "var(--ink-3)" : "var(--ink-2)" }}>
          {t("volunteerSpotsFilled", { filled, slots })}
        </span>
        {full ? (
          <Tag tone="line" icon="check">{t("volunteerFull")}</Tag>
        ) : (
          <Tag tone="orange">{t("volunteerSpotsLeft", { left: slots - filled })}</Tag>
        )}
      </div>
      <div style={{ height: 6, borderRadius: 4, background: "var(--line-2)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: full ? "var(--blue)" : "var(--orange)" }} />
      </div>
    </div>
  );
}

function PositionCard({
  position,
  locale,
  canWrite,
  persons,
  busy,
  onTake,
  onWithdraw,
  onSignIn,
  onAddToCalendar,
}: {
  position: AnySheet["positions"][number];
  locale: string;
  /** False when signed out, or when the sheet is closed. */
  canWrite: boolean;
  /** The Persons the reader controls — the pool a claim picks from. */
  persons: ControllablePersonDTO[];
  busy: boolean;
  onTake: () => void;
  onWithdraw: (signupId: string) => void;
  onSignIn: () => void;
  onAddToCalendar: (signupId: string) => void;
}) {
  const { t } = useI18n();
  const signups = signupsOf(position);
  const full = position.filled >= position.slots;
  // All of the household's claims, not just the first: one signup per Person
  // per position, and a parent may hold spots for themselves AND their kids.
  const mySignups = signups.filter((s) => s.isYou);
  const signedPersonIds = new Set(mySignups.map((s) => s.personId));
  // An empty persons list still offers the button: ClaimSheet turns it into
  // the "add a family member first" prompt.
  const canTakeAnother =
    persons.length === 0 || persons.some((p) => !signedPersonIds.has(p.id));
  const shift = shiftLabel(position.startsAt, position.endsAt, locale);

  return (
    <div className="sd-card sd-card-pad" style={{ display: "flex", flexDirection: "column", gap: 11 }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3 }}>{position.title}</div>
        {shift && (
          <div className="sd-row" style={{ gap: 6, marginTop: 4 }}>
            <Icon name="calendar" size={14} style={{ color: "var(--ink-3)", flex: "0 0 auto" }} />
            <span className="sd-meta">{shift}</span>
          </div>
        )}
        {position.description && (
          <div style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--ink-2)", whiteSpace: "pre-wrap", wordBreak: "break-word", marginTop: 6 }}>
            <LinkifiedText text={position.description} />
          </div>
        )}
      </div>

      <Progress filled={position.filled} slots={position.slots} t={t} />

      {/* The roster. Absent by construction when signed out — the anonymous
          endpoint never sends it — so the prompt below is the honest thing to
          show rather than an empty list that reads as "nobody signed up". */}
      {signups.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 7, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
          {signups.map((s) => (
            <div key={s.id} className="sd-row" style={{ gap: 8, minWidth: 0 }}>
              <Avatar name={s.displayName} size={26} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.displayName}
                </div>
                {s.note && <div className="sd-meta" style={{ lineHeight: 1.4 }}>{s.note}</div>}
              </div>
              {s.isYou && canWrite && (
                <button
                  type="button"
                  onClick={() => onWithdraw(s.id)}
                  disabled={busy}
                  className="sd-btn sd-btn-ghost sd-btn-sm"
                  style={{ flex: "0 0 auto" }}
                >
                  {t("volunteerWithdraw")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Offered for as long as the spot is theirs, not only in the moment after
          taking it — the confirmation that follows a claim is easy to dismiss,
          and a closed sheet is still a shift they owe. One button per claim:
          each signup is its own .ics, so a parent holding two spots can put
          each person's shift on the right calendar. */}
      {mySignups.map((s) => (
        <Btn key={s.id} block kind="secondary" icon="calendar" onClick={() => onAddToCalendar(s.id)}>
          {mySignups.length > 1
            ? `${t("volunteerAddToCalendar")} (${s.displayName})`
            : t("volunteerAddToCalendar")}
        </Btn>
      ))}

      {canWrite ? (
        canTakeAnother && (
          <Btn block kind={full ? "secondary" : "primary"} icon="plus" disabled={busy || full} onClick={onTake}>
            {t("takeASpot")}
          </Btn>
        )
      ) : (
        <Btn block kind="secondary" icon="lock" onClick={onSignIn}>
          {t("signInToVolunteer")}
        </Btn>
      )}
    </div>
  );
}

/** Who is this spot for? Sourced from the Persons the signed-in User controls,
 *  which is the same list the directory's Person switcher uses — so a parent
 *  signs up a child by picking them, and nobody can sign up a stranger. */
function ClaimSheet({
  persons,
  takenPersonIds,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  persons: ControllablePersonDTO[];
  /** Persons of the reader's who already hold this position. They stay visible
   *  but can't be picked again — a second signup for the same Person is the one
   *  combination the server refuses (409 duplicate); a DIFFERENT Person on the
   *  same position is an ordinary claim. */
  takenPersonIds: Set<string>;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (personId: string, note: string) => void;
}) {
  const { t, locale } = useI18n();
  const [personId, setPersonId] = useState(
    persons.find((p) => !takenPersonIds.has(p.id))?.id ?? "",
  );
  const [note, setNote] = useState("");

  // A brand-new member controls no Persons yet, so there is nobody to sign up.
  // Rather than an empty picker with a dead submit button, point them at the
  // directory's onboarding to add themselves or a family member; a member with
  // no Persons is exactly who `/welcome` is for. It's a cross-origin hop, so
  // `?lang=` carries their language across the way every front-door link does.
  if (persons.length === 0) {
    return (
      <SheetOver onClose={onClose}>
        <h2 className="sd-h2" style={{ marginBottom: 8 }}>{t("takeASpot")}</h2>
        <p className="sd-meta" style={{ margin: "0 0 16px" }}>{t("volunteerNeedPerson")}</p>
        <div className="sd-row" style={{ gap: 8 }}>
          <Btn block kind="secondary" onClick={onClose}>{t("cancel")}</Btn>
          <a className="sd-btn sd-btn-primary block" href={`${DIRECTORY_URL}/welcome?lang=${locale}`}>
            <Icon name="plus" size={18} />{t("addPerson")}
          </a>
        </div>
      </SheetOver>
    );
  }

  return (
    <SheetOver onClose={onClose}>
      <h2 className="sd-h2" style={{ marginBottom: 14 }}>{t("takeASpot")}</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label={t("volunteerWhoFor")}>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {persons.map((p) => {
              const taken = takenPersonIds.has(p.id);
              const on = !taken && p.id === personId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPersonId(p.id)}
                  aria-pressed={on}
                  disabled={taken}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", textAlign: "left",
                    border: `1px solid ${on ? "var(--blue)" : "var(--line)"}`, borderRadius: 10,
                    background: on ? "var(--blue-50, #eef6fc)" : "var(--paper)", font: "inherit",
                    cursor: taken ? "default" : "pointer", opacity: taken ? 0.6 : 1,
                  }}
                >
                  <Avatar name={p.displayName} img={p.photoUrl} size={30} />
                  <span style={{ fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0 }}>{p.displayName}</span>
                  {taken && <Tag tone="line" icon="check">{t("volunteerPersonSignedUp")}</Tag>}
                  {on && <Icon name="check" size={17} style={{ color: "var(--blue)" }} />}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label={t("volunteerNote")}>
          <input
            className="sd-input"
            value={note}
            maxLength={500}
            placeholder={t("volunteerNotePlaceholder")}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        {error && <div className="sd-meta" style={{ color: "var(--danger, #b3261e)" }}>{error}</div>}

        <div className="sd-row" style={{ gap: 8 }}>
          <Btn block kind="secondary" onClick={onClose}>{t("cancel")}</Btn>
          <Btn block disabled={busy || !personId} onClick={() => onSubmit(personId, note)}>{t("takeASpot")}</Btn>
        </div>
      </div>
    </SheetOver>
  );
}

/** Where a taken spot goes next: the reader's own calendar.
 *
 *  Two ways in, because there is no one way that reaches everyone. Google's is a
 *  link that opens its own pre-filled form; everything else — Apple Calendar,
 *  Outlook, a phone's built-in app — imports a `.ics` file, which the API renders
 *  so the date in it is read at the moment of the tap. Both describe the same
 *  window (`volunteerShiftWindow`) and both carry the event page's link, which
 *  is the version that keeps up if the school moves the event; see
 *  packages/shared/src/volunteerCalendar.ts for why a shift is the one thing
 *  this app hands out as a copy.
 *
 *  `justClaimed` adds the confirmation heading, so the sheet that opens straight
 *  after a claim also says that the claim worked. */
function AddToCalendarSheet({
  sheet,
  positionId,
  signupId,
  justClaimed,
  onClose,
}: {
  sheet: AnySheet;
  positionId: string;
  signupId: string;
  justClaimed: boolean;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const position = sheet.positions.find((p) => p.id === positionId);
  if (!position) return null;

  const eventUrl = `${window.location.origin}${eventPath(sheet.event, SCHOOL_TIME_ZONE)}`;
  const google = googleCalendarUrl({
    title: volunteerEntryTitle(position.title, sheet.event.title, t("volunteerEntryPrefix")),
    window: volunteerShiftWindow(sheet.event, position),
    location: sheet.event.location,
    details: volunteerEntryDetails(position.description, eventUrl),
  });
  const shift = shiftLabel(position.startsAt, position.endsAt, locale);

  return (
    <SheetOver onClose={onClose}>
      <h2 className="sd-h2" style={{ marginBottom: 6 }}>
        {justClaimed ? t("volunteerSignedUpTitle") : t("volunteerAddToCalendar")}
      </h2>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{position.title}</div>
      {shift && <div className="sd-meta" style={{ marginTop: 2 }}>{shift}</div>}
      <p className="sd-meta" style={{ margin: "10px 0 16px", lineHeight: 1.5 }}>{t("volunteerSignedUpBody")}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <a className="sd-btn sd-btn-primary block" href={google} target="_blank" rel="noopener noreferrer">
          <Icon name="calendar" size={18} />{t("volunteerAddGoogle")}
        </a>
        <a className="sd-btn sd-btn-secondary block" href={api.volunteerSignupIcsUrl(signupId, locale)}>
          <Icon name="download" size={18} />{t("volunteerAddIcs")}
        </a>
        <Btn block kind="ghost" onClick={onClose}>{t("done")}</Btn>
      </div>
    </SheetOver>
  );
}

/** The positions grid plus the claim flow.
 *
 *  Both writes answer with the refreshed MEMBER sheet, which is handed back
 *  through `onSheet` — the screen owns the sheet state because it also owns the
 *  fetch. `onReload` is the "re-read the truth" path for the two 409s that mean
 *  this copy is stale (someone else took the last spot, or signups closed while
 *  the form was open); the screen knows which endpoint it is entitled to. */
export function VolunteerPositions({
  sheet,
  onSheet,
  onReload,
  onSignIn,
}: {
  sheet: AnySheet;
  onSheet: (s: VolunteerSheetDTO) => void;
  onReload: () => void;
  onSignIn: () => void;
}) {
  const { t, locale } = useI18n();
  const { me } = useSession();
  const [claiming, setClaiming] = useState<string | null>(null); // position id
  const [busy, setBusy] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ positionId: string; signupId: string; justClaimed: boolean } | null>(null);

  const canWrite = !!me && !sheet.closed;

  // Which of the reader's Persons already hold the position being claimed, so
  // the picker greys them out instead of letting the server 409 the duplicate.
  const claimingPosition = claiming ? sheet.positions.find((p) => p.id === claiming) : undefined;
  const takenPersonIds = new Set(
    claimingPosition
      ? signupsOf(claimingPosition)
          .filter((s) => s.isYou)
          .map((s) => s.personId)
      : [],
  );

  const claim = async (positionId: string, personId: string, note: string) => {
    setBusy(true);
    setClaimError(null);
    try {
      const r = await api.claimVolunteerSpot(positionId, personId, note.trim() || null);
      onSheet(r.sheet);
      setClaiming(null);
      // Straight on to the calendar while the commitment is fresh. The new
      // signup is found on the refreshed sheet by Person — the response names
      // the sheet, not the row it just wrote.
      const mine = r.sheet.positions
        .find((p) => p.id === positionId)
        ?.signups.find((su) => su.isYou && su.personId === personId);
      if (mine) setAdding({ positionId, signupId: mine.id, justClaimed: true });
    } catch (err) {
      // 409 carries which of the three ways it failed, so the message can say
      // what actually happened instead of "something went wrong".
      const reason = err instanceof ApiError && err.status === 409
        ? (err.body as { error?: string }).error
        : null;
      setClaimError(
        reason === "duplicate" ? t("volunteerAlready")
        : reason === "full" ? t("volunteerTookLastSpot")
        : reason === "closed" ? t("volunteerSignupsClosed")
        : t("volunteerError"),
      );
      if (reason === "full" || reason === "closed") onReload(); // re-read the truth
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (signupId: string) => {
    setBusy(true);
    try {
      const r = await api.releaseVolunteerSpot(signupId);
      onSheet(r.sheet);
    } catch {
      onReload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {sheet.positions.length === 0 ? (
        <div className="sd-card sd-card-pad sd-meta" style={{ textAlign: "center", padding: "22px 16px", marginTop: 9 }}>
          {t("volunteerNoPositions")}
        </div>
      ) : (
        <div style={{ marginTop: 9, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, alignItems: "start" }}>
          {sheet.positions.map((p) => (
            <PositionCard
              key={p.id}
              position={p}
              locale={locale}
              canWrite={canWrite}
              persons={me?.persons ?? []}
              busy={busy}
              onTake={() => { setClaimError(null); setClaiming(p.id); }}
              onWithdraw={withdraw}
              onSignIn={onSignIn}
              onAddToCalendar={(signupId) => setAdding({ positionId: p.id, signupId, justClaimed: false })}
            />
          ))}
        </div>
      )}
      {/* Said once, under the list, rather than on every card. */}
      {!me && sheet.positions.length > 0 && (
        <div className="sd-meta" style={{ marginTop: 10, textAlign: "center" }}>{t("volunteerNamesMembersOnly")}</div>
      )}
      {claiming && (
        <ClaimSheet
          persons={me?.persons ?? []}
          takenPersonIds={takenPersonIds}
          busy={busy}
          error={claimError}
          onClose={() => setClaiming(null)}
          onSubmit={(personId, note) => void claim(claiming, personId, note)}
        />
      )}
      {adding && (
        <AddToCalendarSheet
          sheet={sheet}
          positionId={adding.positionId}
          signupId={adding.signupId}
          justClaimed={adding.justClaimed}
          onClose={() => setAdding(null)}
        />
      )}
    </>
  );
}
