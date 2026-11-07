// Volunteer signups for one authored event — the admin side.
//
// A sheet is per-DATE, not per-event (CLAUDE.md invariant 8: a recurring event
// has no single durable occurrence), so this screen is two steps: pick which
// date to open signups for, then define the positions on it. A one-off event
// still goes through the same picker; it just has one date to pick.
//
// Admin chrome is intentionally English-only (operator tooling), matching
// CalendarEvents.tsx. The member- and public-facing sheet — rendered on the
// event's own page at /e/:date/:slug — is fully translated; that's the page
// families actually read.
import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import {
  CLOCK,
  eventPath,
  formatClock,
  formatClockRange,
  isoToZonedDate,
  isoToZonedTime,
  zonedToIso,
  type ManagedOccurrenceDTO,
  type VolunteerSheetDTO,
} from "@sd/shared";
import { Icon } from "../components/Icon.js";
import { Avatar, Btn, Tag } from "../components/atoms.js";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader, SectLabel, Field } from "../components/parts.js";
import { ErrorText, iconBtnStyle, occurrenceAction } from "../components/adminUi.js";
import { useSession } from "../lib/session.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api, errorMessage } from "../lib/api.js";
import { SCHOOL_TIME_ZONE } from "../lib/timezone.js";

/** The link to hand out. A sheet no longer has a page of its own — it is read on
 *  its event's page — so this is normally the event's URL, which is also what a
 *  family sees when they reach the sheet from the calendar.
 *
 *  An ORPHANED sheet is the exception, and it is the reason this is a function
 *  and not an interpolation. Its date is no longer on the calendar (the banner
 *  above says so), which means the event path addresses nothing and a reader
 *  following it would be told the event doesn't exist. The slug still resolves,
 *  because a slug is the durable handle — so hand out /v/:slug there, which
 *  forwards to the same page carrying the slug the fallback needs.
 *
 *  Built from this app's own origin, and only ever shown for a PUBLISHED sheet:
 *  until then the event withholds the slug and its page shows no signup block.
 *
 *  The date segment is minted in the ADMIN's timezone, like every other link
 *  this app builds; the lookup searches a ±1 day window, so a reader in another
 *  zone still resolves it. See packages/shared/src/eventPath.ts. */
function sheetUrl(sheet: VolunteerSheetDTO): string {
  const path = sheet.orphaned ? `/v/${sheet.slug}` : eventPath(sheet.event, SCHOOL_TIME_ZONE);
  return `${window.location.origin}${path}`;
}

/** A draft in the admin's own mail client, addressed to themselves with every
 *  volunteer Bcc'd and the event's title as the subject.
 *
 *  **Bcc, never To.** A sheet's roster is a list of families; putting it in the
 *  To line would hand every address on it to everyone else on it, which is the
 *  same disclosure the directory spends invariant 1 preventing. The admin's own
 *  address goes in To because a message with no visible recipient is one some
 *  clients refuse to send.
 *
 *  Nothing is sent from here — this only opens a composer, so what actually goes
 *  out is still the admin's to write and to send. That is the whole reason this
 *  is a `mailto:` and not a route: the API has a mailer, and using it
 *  would make the PTO's own outbound mail a thing this system logs, retries and
 *  is blamed for.
 *
 *  TWO limits worth knowing, and "Copy volunteer emails" beside this button is
 *  the answer to both. A `mailto:` hands the message to a NATIVE mail client,
 *  so on a machine where none is configured — which is most of them now that
 *  mail lives in a browser tab — it opens nothing, or an app nobody uses. And
 *  some clients truncate a `mailto:` past roughly 2,000 characters, about 60
 *  addresses; a school sheet is well short of that, but a sheet that isn't
 *  wants the clipboard rather than this. */
function mailtoUrl(to: string, bcc: string[], subject: string): string {
  const params = new URLSearchParams({ bcc: bcc.join(","), subject });
  return [
    // `encodeURIComponent` would spell the "@" as %40 — legal, and shown
    // literally by enough clients to be worth undoing.
    `mailto:${encodeURIComponent(to).replace(/%40/g, "@")}`,
    // URLSearchParams spells a space as "+", which a subject line then shows as
    // a plus sign; %20 is what a mail client reads back as a space.
    params.toString().replace(/\+/g, "%20"),
  ].join("?");
}

function fmtOccurrence(o: ManagedOccurrenceDTO): string {
  return new Date(o.start).toLocaleString(undefined, {
    timeZone: o.allDay ? "UTC" : SCHOOL_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(o.allDay ? {} : CLOCK),
  });
}

/** "HH:MM" at the school, for the shift INPUTS and nothing else. HTML defines
 *  `<input type="time">`'s value as 24-hour regardless of locale — the browser
 *  shows its own widget in whatever form the platform uses — so this is a
 *  serializer, not a formatter, and it is deliberately not `CLOCK`.
 *
 *  Positions store instants; the form works in the wall-clock time an admin is
 *  actually thinking about. Anything a person READS goes through `shiftWindow`
 *  below: this function used to do both jobs, which is how a sheet whose every
 *  other time said "1:30 PM" came to print its shifts as "13:30". */
function toTimeInput(iso: string | null): string {
  if (!iso) return "";
  return isoToZonedTime(iso, SCHOOL_TIME_ZONE);
}

/** A position's shift window as an admin reads it — "1:30 – 5:00 PM", or an
 *  em dash for the half that isn't set. The browser's own locale, like
 *  `fmtOccurrence` above: this screen is operator chrome and takes no part in
 *  the app's i18n. */
function shiftWindow(startsAt: string | null, endsAt: string | null): string {
  if (startsAt && endsAt) return formatClockRange(startsAt, endsAt, undefined, SCHOOL_TIME_ZONE);
  const one = (iso: string | null) => (iso ? formatClock(iso, undefined, SCHOOL_TIME_ZONE) : "—");
  return `${one(startsAt)} – ${one(endsAt)}`;
}

/** Combine a "HH:MM" with the sheet's own date, read as the school's wall
 *  clock. A shift is always on the day of the event, so the date never needs
 *  its own input. An all-day event's date is its UTC date (it is stored at
 *  midnight UTC); reading that in a western zone would put the shift on the
 *  day before. */
function fromTimeInput(time: string, event: { start: string; allDay: boolean }): string | null {
  if (!time) return null;
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const day = event.allDay ? event.start.slice(0, 10) : isoToZonedDate(event.start, SCHOOL_TIME_ZONE);
  return zonedToIso(day, time, SCHOOL_TIME_ZONE);
}

interface PositionForm {
  title: string;
  description: string;
  slots: string;
  startTime: string;
  endTime: string;
}

const emptyPosition: PositionForm = { title: "", description: "", slots: "1", startTime: "", endTime: "" };

function PositionEditor({ initial, busy, onSubmit, onCancel }: {
  initial: PositionForm;
  busy: boolean;
  onSubmit: (f: PositionForm) => Promise<void>;
  onCancel: () => void;
}) {
  const [f, setF] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof PositionForm>(k: K, v: PositionForm[K]) => setF((c) => ({ ...c, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.title.trim()) {
      setError("Give the position a title.");
      return;
    }
    setError(null);
    try {
      await onSubmit(f);
    } catch (err) {
      setError(errorMessage(err, "Couldn't save that position."));
    }
  };

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: 10 }}>
      <Field label="Position">
        <input className="sd-input" placeholder="Snack table" value={f.title} onChange={(e) => set("title", e.target.value)} autoFocus />
      </Field>
      <Field label="Details" hint="Optional — what the job involves, what to bring.">
        <textarea className="sd-input" rows={2} style={{ height: "auto", resize: "vertical" }} value={f.description} onChange={(e) => set("description", e.target.value)} />
      </Field>
      <Field label="People needed">
        <input className="sd-input" type="number" min={1} max={200} value={f.slots} onChange={(e) => set("slots", e.target.value)} style={{ width: 100 }} />
      </Field>
      <div className="sd-row" style={{ gap: 8, alignItems: "flex-end" }}>
        <Field label="Shift starts" hint="Optional.">
          <input className="sd-input" type="time" value={f.startTime} onChange={(e) => set("startTime", e.target.value)} />
        </Field>
        <Field label="Shift ends" hint="Optional.">
          <input className="sd-input" type="time" value={f.endTime} onChange={(e) => set("endTime", e.target.value)} />
        </Field>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      <div className="sd-row" style={{ gap: 8 }}>
        <Btn type="submit" icon="check" disabled={busy} style={{ flex: 1 }}>Save position</Btn>
        <Btn type="button" kind="secondary" onClick={onCancel} disabled={busy}>Cancel</Btn>
      </div>
    </form>
  );
}

/** One position with its roster. Admins see every name — this is the operator's
 *  view of who is coming, which is the whole reason to keep signups in-app. */
function PositionRow({ position, busy, onEdit, onRemove, onRelease }: {
  position: VolunteerSheetDTO["positions"][number];
  busy: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onRelease: (signupId: string) => void;
}) {
  const full = position.filled >= position.slots;
  return (
    <div className="sd-crow" style={{ alignItems: "flex-start", gap: 10, flexDirection: "column" }}>
      <div className="sd-row" style={{ gap: 10, width: "100%", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="sd-row" style={{ gap: 7, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{position.title}</span>
            <Tag tone={full ? "line" : "orange"}>{position.filled} of {position.slots}</Tag>
          </div>
          {(position.startsAt || position.endsAt) && (
            <div className="sd-meta">{shiftWindow(position.startsAt, position.endsAt)}</div>
          )}
          {position.description && <div className="sd-meta">{position.description}</div>}
        </div>
        <button aria-label={`Edit ${position.title}`} onClick={onEdit} style={iconBtnStyle}>
          <Icon name="pencil" size={16} />
        </button>
        <button aria-label={`Remove ${position.title}`} onClick={onRemove} style={iconBtnStyle}>
          <Icon name="x" size={18} />
        </button>
      </div>
      {position.signups.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", paddingLeft: 2 }}>
          {position.signups.map((s) => (
            <div key={s.id} className="sd-row" style={{ gap: 8, minWidth: 0 }}>
              <Avatar name={s.displayName} size={22} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{s.displayName}</span>
              {s.note && <span className="sd-meta" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.note}</span>}
              <button
                aria-label={`Remove ${s.displayName}`}
                title="Remove this signup"
                onClick={() => onRelease(s.id)}
                disabled={busy}
                style={{ ...iconBtnStyle, marginLeft: "auto", flex: "0 0 auto" }}
              >
                <Icon name="x" size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function EventVolunteers() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const { me, loading: sessionLoading } = useSession();

  const [occurrences, setOccurrences] = useState<ManagedOccurrenceDTO[] | null>(null);
  const [sheet, setSheet] = useState<VolunteerSheetDTO | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; form: PositionForm } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // How many volunteers the last "Email volunteers" click could not reach. Kept
  // after the composer opens, because the admin is now writing a message to a
  // list that isn't everyone and should be told so while they write it.
  const [unreachable, setUnreachable] = useState<number | null>(null);
  /** How many addresses the last copy put on the clipboard — the button says so
   *  for a moment, because a clipboard write is otherwise invisible. */
  const [copiedEmails, setCopiedEmails] = useState<number | null>(null);
  /** The list itself, shown only when the browser refused the clipboard. */
  const [emailList, setEmailList] = useState<string | null>(null);
  /** The test-reminder button's receipt, for the clipboard buttons' reason: a
   *  send with no visible result reads as a button that did nothing. */
  const [testSent, setTestSent] = useState(false);
  /** Working copy of the sheet's runbook link. Re-seeded when a different sheet
   *  opens — deliberately not on every sheet refresh, so a position save mid-
   *  typing doesn't clobber the draft. The server normalizes on save, so the
   *  field is re-read from the response rather than trusted as typed. */
  const [runbook, setRunbook] = useState("");

  const sheetId = sheet?.id ?? null;
  useEffect(() => {
    setRunbook(sheet?.runbookUrl ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetId]);

  const loadOccurrences = useCallback(async () => {
    const r = await api.eventOccurrences(id).catch(() => ({ occurrences: [] as ManagedOccurrenceDTO[] }));
    setOccurrences(r.occurrences);
    return r.occurrences;
  }, [id]);

  useEffect(() => {
    void (async () => {
      const list = await loadOccurrences();
      // Land on the sheet that already exists, if there's exactly one — the
      // common case is a one-off event whose sheet you came here to edit.
      const withSheets = list.filter((o) => o.sheet);
      if (withSheets.length === 1) {
        const r = await api.adminVolunteerSheet(withSheets[0]!.sheet!.id).catch(() => null);
        if (r) setSheet(r.sheet);
      }
    })();
  }, [loadOccurrences]);

  const openSheet = async (sheetId: string) => {
    setError(null);
    setUnreachable(null);
    setEmailList(null);
    const r = await api.adminVolunteerSheet(sheetId).catch(() => null);
    if (r) setSheet(r.sheet);
  };

  const create = async (occurrenceStart: string) => {
    setBusy(true);
    setError(null);
    setUnreachable(null);
    setEmailList(null);
    try {
      const r = await api.addVolunteerSheet(id, { occurrenceStart });
      setSheet(r.sheet);
      void loadOccurrences();
    } catch (err) {
      setError(errorMessage(err, "Couldn't open signups for that date."));
    } finally {
      setBusy(false);
    }
  };

  const savePosition = async (f: PositionForm) => {
    if (!sheet) return;
    const body = {
      title: f.title.trim(),
      description: f.description.trim() || null,
      slots: Number(f.slots) || 1,
      startsAt: fromTimeInput(f.startTime, sheet.event),
      endsAt: fromTimeInput(f.endTime, sheet.event),
    };
    setBusy(true);
    try {
      const r = editing?.id
        ? await api.updateVolunteerPosition(editing.id, body)
        : await api.addVolunteerPosition(sheet.id, body);
      setSheet(r.sheet);
      setEditing(null);
      void loadOccurrences();
    } finally {
      setBusy(false);
    }
  };

  const removePosition = async (positionId: string) => {
    setBusy(true);
    try {
      const r = await api.deleteVolunteerPosition(positionId);
      setSheet(r.sheet);
      void loadOccurrences();
    } catch {
      setError("Couldn't remove that position.");
    } finally {
      setBusy(false);
    }
  };

  const releaseSignup = async (signupId: string) => {
    if (!sheet) return;
    setBusy(true);
    try {
      // The member route, used by an admin: it accepts a system admin removing
      // anyone's signup, so there is one code path for giving a spot back.
      await api.releaseVolunteerSpot(signupId);
      await openSheet(sheet.id);
    } catch {
      setError("Couldn't remove that signup.");
    } finally {
      setBusy(false);
    }
  };

  const togglePublished = async () => {
    if (!sheet) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.updateVolunteerSheet(sheet.id, { published: !sheet.published });
      setSheet(r.sheet);
      void loadOccurrences();
    } catch (err) {
      setError(errorMessage(err, "Couldn't change that."));
    } finally {
      setBusy(false);
    }
  };

  /** Save the runbook link. The server holds it to http(s) and answers with the
   *  canonical form (`new URL().href`), which is what lands back in the field. */
  const saveRunbook = async () => {
    if (!sheet) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.updateVolunteerSheet(sheet.id, { runbookUrl: runbook.trim() || null });
      setSheet(r.sheet);
      setRunbook(r.sheet.runbookUrl ?? "");
    } catch (err) {
      setError(errorMessage(err, "Couldn't save the runbook link."));
    } finally {
      setBusy(false);
    }
  };

  /** Move this sheet onto one of its event's real dates. Only offered for an
   *  ORPHANED sheet: the banner above has always told the admin to do exactly
   *  this, and until now the app answered with nothing but a delete — which for
   *  a sheet like Field Day's meant throwing away eighteen families' sign-ups
   *  to fix a date. The positions' shift windows and everyone signed up ride
   *  along; the server does it in one batch. */
  const moveSheetTo = async (occurrenceStart: string) => {
    if (!sheet) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.moveVolunteerSheet(sheet.id, occurrenceStart);
      setSheet(r.sheet);
      void loadOccurrences();
    } catch (err) {
      setError(errorMessage(err, "Couldn't move this sheet to that date."));
    } finally {
      setBusy(false);
    }
  };

  const removeSheet = async () => {
    if (!sheet) return;
    setBusy(true);
    try {
      await api.deleteVolunteerSheet(sheet.id);
      setSheet(null);
      void loadOccurrences();
    } finally {
      setBusy(false);
    }
  };

  /** The addresses, read on the click rather than with the sheet: they are the
   *  one thing on this screen that is only ever wanted at the moment they are
   *  used. Returns null when there is nobody to write to, having already said
   *  so — both buttons below want the same read and the same two refusals. */
  const gatherEmails = async (): Promise<string[] | null> => {
    if (!sheet) return null;
    setError(null);
    setEmailList(null);
    try {
      const { emails, withoutEmail } = await api.volunteerSheetEmails(sheet.id);
      if (emails.length === 0) {
        setError(
          withoutEmail > 0
            ? `No email address on file for ${withoutEmail === 1 ? "the volunteer" : `any of the ${withoutEmail} volunteers`} on this sheet.`
            : "Nobody has signed up yet.",
        );
        return null;
      }
      setUnreachable(withoutEmail);
      return emails;
    } catch (err) {
      setError(errorMessage(err, "Couldn't gather the volunteers' email addresses."));
      return null;
    }
  };

  const emailVolunteers = async () => {
    setBusy(true);
    try {
      const emails = await gatherEmails();
      if (!emails || !sheet) return;
      // Subject is the EVENT's title, not the sheet's date — it is what the
      // family recognises, and it is the only name a sheet has anyway.
      window.location.href = mailtoUrl(me?.user.email ?? "", emails, sheet.event.title);
    } finally {
      setBusy(false);
    }
  };

  /** The other half of the same job, for the admin whose mail lives in a browser
   *  tab. `mailto:` hands the message to a NATIVE client, and on a machine where
   *  none is configured it opens nothing at all — or worse, an app the person
   *  has never used. Copying the list costs them one paste into Gmail's or
   *  Outlook's own Bcc field and needs no such handoff. */
  const copyEmails = async () => {
    setBusy(true);
    try {
      const emails = await gatherEmails();
      if (!emails) return;
      // Comma-separated: what every webmail recipient field parses, and what a
      // spreadsheet splits on if the list is going somewhere else.
      const text = emails.join(", ");
      try {
        await navigator.clipboard.writeText(text);
        setCopiedEmails(emails.length);
        setTimeout(() => setCopiedEmails(null), 2500);
      } catch {
        // A refused clipboard is exactly the case this button exists for, so it
        // cannot fail silently the way the link above does: put the list on
        // screen instead, where it can be selected by hand.
        setEmailList(text);
      }
    } finally {
      setBusy(false);
    }
  };

  /** Proof the two-evenings-before reminder: the server mails it — runbook
   *  link and every position's shift — to THIS admin's own address, prefixed
   *  "[Test]". Volunteers get nothing, and the cron's own send is untouched. */
  const sendTestReminder = async () => {
    if (!sheet) return;
    setBusy(true);
    setError(null);
    try {
      await api.testVolunteerReminder(sheet.id);
      setTestSent(true);
      setTimeout(() => setTestSent(false), 2500);
    } catch (err) {
      setError(errorMessage(err, "Couldn't send the test reminder."));
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!sheet) return;
    try {
      await navigator.clipboard.writeText(sheetUrl(sheet));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the link is still selectable */
    }
  };

  if (!sessionLoading && me && !me.user.isSystemAdmin) return <Navigate to="/" replace />;

  // Dates this event really has that no sheet holds yet — where an orphan may
  // go. `listOccurrences` returns the orphan's own date too, appended past the
  // real ones, so `sheet` being set is what excludes it.
  const freeOccurrences = (occurrences ?? []).filter((o) => !o.sheet);

  const datePicker = (
    <>
      <SectLabel>Dates</SectLabel>
      <div className="sd-card sd-card-pad" style={{ marginTop: 9 }}>
        {occurrences === null && <div className="sd-meta">Loading dates…</div>}
        {occurrences?.length === 0 && (
          <div className="sd-meta" style={{ padding: "8px 0" }}>
            This event has no dates on the calendar yet.
          </div>
        )}
        {(occurrences ?? []).map((o) => {
          const action = occurrenceAction(o.sheet?.id, sheet?.id);
          return (
            <div key={o.start} className="sd-crow" style={{ alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="sd-row" style={{ gap: 7, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{fmtOccurrence(o)}</span>
                  {o.sheet && (
                    <Tag tone={o.sheet.published ? "blue" : "line"}>
                      {o.sheet.published ? "Published" : "Draft"} · {o.sheet.positionCount} positions
                    </Tag>
                  )}
                </div>
              </div>
              {action === "editing" && <span className="sd-meta">Editing below</span>}
              {action === "open" && (
                <Btn sm kind="primary" onClick={() => void openSheet(o.sheet!.id)}>
                  Open
                </Btn>
              )}
              {action === "create" && (
                <Btn sm kind="secondary" icon="plus" disabled={busy} onClick={() => void create(o.start)}>
                  Add signups
                </Btn>
              )}
            </div>
          );
        })}
      </div>
    </>
  );

  const sheetPanel = sheet && (
    <>
      <SectLabel
        action={
          !editing && (
            <Btn sm icon="plus" onClick={() => setEditing({ id: null, form: emptyPosition })}>Add position</Btn>
          )
        }
      >
        {fmtOccurrence({ start: sheet.event.start, end: sheet.event.end, allDay: sheet.event.allDay, sheet: null })}
      </SectLabel>

      <div className="sd-card sd-card-pad" style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 10 }}>
        {sheet.orphaned && (
          // The series was edited after this sheet was created, so the date it
          // names is no longer on the calendar. The signups are intact; the
          // sheet just isn't reachable from the agenda.
          //
          // The dates beneath are the affordance the sentence promises. Only
          // the FREE ones: a date that already has a sheet can't take a second
          // (one sheet per occurrence, or "the" volunteer link for that date is
          // ambiguous), and the server refuses it anyway.
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <ErrorText>
              This date is no longer on the calendar — the event was edited after signups opened.
              The positions and signups below are intact; move them to a current date or delete the sheet.
            </ErrorText>
            {freeOccurrences.length > 0 ? (
              <div className="sd-row" style={{ gap: 8, flexWrap: "wrap" }}>
                {freeOccurrences.map((o) => (
                  <Btn
                    key={o.start}
                    sm
                    kind="primary"
                    icon="swap"
                    disabled={busy}
                    onClick={() => void moveSheetTo(o.start)}
                  >
                    Move to {fmtOccurrence(o)}
                  </Btn>
                ))}
              </div>
            ) : (
              <div className="sd-meta">
                This event has no other date to move these signups to. Add a date to the event first,
                or delete the sheet.
              </div>
            )}
          </div>
        )}

        <div className="sd-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <Tag tone={sheet.published ? "blue" : "line"}>{sheet.published ? "Published" : "Draft"}</Tag>
          <Btn sm kind={sheet.published ? "secondary" : "primary"} disabled={busy} onClick={() => void togglePublished()}>
            {sheet.published ? "Unpublish" : "Publish"}
          </Btn>
          {/* Shown whether or not anyone has signed up — a button that vanished
              on an empty sheet would read as a missing feature, where one that
              says "nobody has signed up yet" answers the question asked. */}
          <Btn sm kind="secondary" icon="mail" disabled={busy} onClick={() => void emailVolunteers()}>
            Email volunteers
          </Btn>
          {/* Beside it rather than instead of it: the two answer the same need
              for two kinds of admin, and which one works is a fact about the
              machine, not about the sheet. */}
          <Btn sm kind="secondary" icon="copy" disabled={busy} onClick={() => void copyEmails()}>
            {copiedEmails === null
              ? "Copy volunteer emails"
              : `Copied ${copiedEmails} ${copiedEmails === 1 ? "address" : "addresses"}`}
          </Btn>
          {/* Proof of the automated reminder the cron mails two evenings before
              the event — to YOUR address, never the volunteers'. Offered on
              drafts too: proofing is wanted before publishing. */}
          <Btn sm kind="secondary" icon="bolt" disabled={busy} onClick={() => void sendTestReminder()}>
            {testSent ? "Test sent to you" : "Send test reminder"}
          </Btn>
          <button aria-label="Delete this sheet" title="Delete this sheet" onClick={() => void removeSheet()} style={{ ...iconBtnStyle, marginLeft: "auto" }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Only a published sheet has a page worth handing out — an unpublished
            one 404s for everyone but an admin. */}
        {sheet.published && (
          <div className="sd-row" style={{ gap: 6 }}>
            <a href={sheetUrl(sheet)} target="_blank" rel="noopener noreferrer" className="sd-meta sd-link" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
              {sheetUrl(sheet)}
            </a>
            <button aria-label="Copy signup link" onClick={() => void copyLink()} style={{ ...iconBtnStyle, flex: "0 0 auto" }}>
              <Icon name={copied ? "check" : "link"} size={15} />
            </button>
          </div>
        )}
        <div className="sd-meta">
          Anyone with this link can see the positions and how many spots are filled. Names are shown to
          signed-in members only, and signing up requires an account.
        </div>

        <Field
          label="Runbook"
          hint="Optional — a link to an external runbook (a Google Doc) detailing how to run this event. Shown to signed-in members only; the public page never carries it."
        >
          <div className="sd-row" style={{ gap: 8 }}>
            <input
              className="sd-input"
              type="url"
              placeholder="https://docs.google.com/document/d/…"
              value={runbook}
              onChange={(e) => setRunbook(e.target.value)}
              style={{ flex: 1, minWidth: 0 }}
            />
            <Btn
              sm
              kind="secondary"
              disabled={busy || runbook.trim() === (sheet.runbookUrl ?? "")}
              onClick={() => void saveRunbook()}
            >
              Save
            </Btn>
          </div>
        </Field>

        {/* Said after the fact rather than instead of it: the message is still
            worth sending to everyone else. Worded for either button, since both
            leave the same people out. */}
        {!!unreachable && (
          <div className="sd-meta">
            {unreachable === 1 ? "One volunteer has" : `${unreachable} volunteers have`} no email address on
            file and {unreachable === 1 ? "was" : "were"} left out.
          </div>
        )}

        {/* Only when the clipboard was refused. Selected on mount, so the one
            thing left to do is the copy keystroke. */}
        {emailList && (
          <div>
            <div className="sd-meta" style={{ marginBottom: 6 }}>
              This browser wouldn't let the page write to the clipboard — copy the addresses from here.
            </div>
            <textarea
              className="sd-input"
              readOnly
              rows={3}
              style={{ height: "auto", resize: "vertical", width: "100%" }}
              value={emailList}
              // Focused once on mount and selected whenever it is, so the only
              // thing left to do is the copy keystroke. A ref that re-selected
              // on every render would fight the admin's own selection.
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>
        )}

        {error && <ErrorText>{error}</ErrorText>}
      </div>

      <div className="sd-card sd-card-pad" style={{ marginTop: 12 }}>
        {sheet.positions.length === 0 && !editing && (
          <div className="sd-meta" style={{ padding: "8px 0" }}>
            No positions yet. Add one — "Snack table, 4 people, 5–7pm".
          </div>
        )}
        {sheet.positions.map((p) => (
          <PositionRow
            key={p.id}
            position={p}
            busy={busy}
            onEdit={() =>
              setEditing({
                id: p.id,
                form: {
                  title: p.title,
                  description: p.description ?? "",
                  slots: String(p.slots),
                  startTime: toTimeInput(p.startsAt),
                  endTime: toTimeInput(p.endsAt),
                },
              })
            }
            onRemove={() => void removePosition(p.id)}
            onRelease={(signupId) => void releaseSignup(signupId)}
          />
        ))}
        {editing && (
          <PositionEditor
            key={editing.id ?? "new"}
            initial={editing.form}
            busy={busy}
            onSubmit={savePosition}
            onCancel={() => setEditing(null)}
          />
        )}
      </div>
    </>
  );

  const body = (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>{datePicker}</div>
      {sheet && <div>{sheetPanel}</div>}
      {!sheet && error && <ErrorText>{error}</ErrorText>}
    </div>
  );

  if (isDesktop) {
    return (
      <DesktopShell active="admin" title="Volunteer signups">
        <div style={{ maxWidth: 760, width: "100%" }}>
          <button
            onClick={() => navigate(-1)}
            className="sd-row"
            style={{ gap: 5, marginBottom: 12, background: "none", border: 0, padding: 0, cursor: "pointer", color: "var(--blue-700)", font: "inherit", fontSize: 13, fontWeight: 700 }}
          >
            <Icon name="arrowleft" size={16} stroke={2.2} />Back to events
          </button>
          {body}
        </div>
      </DesktopShell>
    );
  }
  return (
    <AppShell bottomNav={<BottomNav active="admin" />}>
      <ScreenHeader title="Volunteer signups" onLeft={() => navigate(-1)} />
      <div className="sd-scroll">
        <div className="sd-body">{body}</div>
      </div>
    </AppShell>
  );
}
