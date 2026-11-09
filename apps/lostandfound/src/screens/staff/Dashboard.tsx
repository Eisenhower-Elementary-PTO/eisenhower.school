// The staff home: claims waiting on a person first, then the items.
//
// English-only, like the PTO boards and the calendar's admin: it is working
// chrome for the handful of people who run the lost and found. The navigation
// around it is translated, because that is shared with the public screens.
//
// Claimants' names and contacts appear here and nowhere else. They came from a
// public form, so they are shown as plain text and links, never as markup.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { lfContactIsEmail, lfContactPhone, lostFoundReturnMessage } from "@sd/shared";
import type { LfClaimDTO, LfReturnMethod, LfStaffItemDTO } from "@sd/shared";
import { Screen } from "../../components/Screen.js";
import { ItemCard } from "../../components/items.js";
import { Btn, Tag } from "../../components/atoms.js";
import { useI18n } from "../../i18n/index.js";
import { api, errorMessage, type LfBulkAction } from "../../lib/api.js";
import { formatDayTime, rotatePhoto, type Turn } from "../../lib/lf.js";

type Tab = "review" | "waiting" | "attention" | "hidden" | "returned";

/** Review comes first: every new item starts held, and the ones the AI found
 *  writing on stay held until someone looks at the photo — with claims, that is
 *  the daily job. "Waiting for owners" (`status=found`) means live publicly. */
const TABS: { key: Tab; label: string; filter: Parameters<typeof api.staffItems>[0] }[] = [
  { key: "review", label: "Needs review", filter: { view: "review" } },
  { key: "waiting", label: "Live — waiting for owners", filter: { status: "found" } },
  { key: "attention", label: "Needs attention", filter: { view: "attention" } },
  { key: "hidden", label: "Hidden", filter: { view: "hidden" } },
  { key: "returned", label: "Returned", filter: { status: "returned" } },
];

/** A bulk action the selection bar offers, per tab. `confirm` asks before
 *  anything destructive or public-facing happens to a whole selection. */
interface BulkChoice {
  label: string;
  action: LfBulkAction;
  warn?: boolean;
  confirm?: (n: number) => string;
}

const these = (n: number) => (n === 1 ? "this item" : `these ${n} items`);
const BULK_DELETE: BulkChoice = {
  label: "Delete",
  action: "delete",
  warn: true,
  confirm: (n) => `Delete ${these(n)} and ${n === 1 ? "its photo" : "their photos"} for good?`,
};

/** What a selection on each tab can have done to it. The review tab is the
 *  approval queue: publishing there is the act the hold exists for, so it
 *  confirms with the same reminder the item page gives. */
const BULK_CHOICES: Record<Tab, BulkChoice[]> = {
  review: [
    {
      label: "Publish",
      action: "publish",
      confirm: (n) =>
        `Publish ${these(n)} to the public site? Make sure none of the photos show a child's name.`,
    },
    BULK_DELETE,
  ],
  waiting: [
    { label: "Mark returned", action: "return" },
    { label: "Hide from public", action: "hide" },
    BULK_DELETE,
  ],
  attention: [{ label: "Mark returned", action: "return" }, BULK_DELETE],
  hidden: [{ label: "Show publicly", action: "unhide" }, BULK_DELETE],
  returned: [{ label: "Put back in lost & found", action: "restore" }, BULK_DELETE],
};

/** A contact as a link when it plainly is one. Anything else stays text.
 *  The shape rules are @sd/shared's (lostFoundReturn.ts) — the same answers
 *  that decide whether the return flow offers "email them" or "text them". */
function ContactLink({ contact }: { contact: string }) {
  if (lfContactIsEmail(contact)) {
    return <a className="sd-link" href={`mailto:${contact}`}>{contact}</a>;
  }
  const phone = lfContactPhone(contact);
  if (phone) {
    return <a className="sd-link" href={`tel:${phone}`}>{contact}</a>;
  }
  return <span>{contact}</span>;
}

/** How the item went home — the one question the return flow asks. The answer
 *  picks the sentence the family gets (@sd/shared's lostFoundReturnMessage). */
const RETURN_METHODS: { key: LfReturnMethod; label: string }[] = [
  { key: "classroom", label: "Sent to the classroom" },
  { key: "office", label: "At the front office" },
  { key: "family", label: "Handed to the family" },
];

/** Marking one claim's item returned, and telling the family. Email contacts
 *  get one tap — the server sends the same message this flow previews, in the
 *  language the claim form was filled in. Phone and free-text contacts stay a
 *  manual send, but with nothing left to compose: a prefilled text-message
 *  link, and a copy button that SHOWS the message when the clipboard refuses
 *  (the volunteer-emails screen's fallback). */
function ReturnFlow({
  claim,
  onDone,
  onCancel,
}: {
  claim: LfClaimDTO;
  /** Reload the lists; `note` lands by the Claims heading. */
  onDone: (note: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [method, setMethod] = useState<LfReturnMethod>("classroom");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showMessage, setShowMessage] = useState(false);

  const isEmail = lfContactIsEmail(claim.contact);
  const phone = lfContactPhone(claim.contact);
  // The very words the server would email — one builder for both paths, so the
  // automatic and the manual message can't drift apart.
  const msg = lostFoundReturnMessage(claim.lang, method, claim.itemTitle);

  const run = async (notify: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.returnClaim(claim.id, method, notify);
      if (notify && !r.notified) {
        await onDone(
          r.reason === "send_failed"
            ? `Marked returned, but the email to ${claim.contact} did NOT send — reach them yourself.`
            : r.reason === "already_notified"
              ? "Marked returned — they had already been emailed."
              : `Marked returned. ${claim.contact} isn't an email address — reach them yourself.`,
        );
      } else {
        await onDone(notify ? `Marked returned and emailed ${claim.contact}.` : "Marked returned.");
      }
    } catch (err) {
      setError(errorMessage(err, "That didn't work. Try again."));
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(msg.body);
      setCopied(true);
    } catch {
      setShowMessage(true);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
      <div className="sd-meta">How is it getting home?</div>
      <div className="lf-actions">
        {RETURN_METHODS.map((m) => (
          <Btn
            key={m.key}
            sm
            kind={method === m.key ? "secondary" : "ghost"}
            disabled={busy}
            onClick={() => setMethod(m.key)}
          >
            {m.label}
          </Btn>
        ))}
      </div>
      {isEmail ? (
        <div className="lf-actions">
          <Btn sm disabled={busy} onClick={() => void run(true)}>
            Mark returned &amp; email them
          </Btn>
          <Btn sm kind="ghost" disabled={busy} onClick={() => void run(false)}>
            Mark returned only
          </Btn>
        </div>
      ) : (
        <div className="lf-actions">
          {phone && (
            <a className="sd-btn sd-btn-secondary sd-btn-sm" href={`sms:${phone}?&body=${encodeURIComponent(msg.body)}`}>
              Text them the news
            </a>
          )}
          <Btn sm kind="ghost" disabled={busy} onClick={() => void copy()}>
            {copied ? "Copied ✓" : "Copy the message"}
          </Btn>
          <Btn sm disabled={busy} onClick={() => void run(false)}>
            Mark returned
          </Btn>
        </div>
      )}
      {claim.lang !== "en" && (
        <div className="sd-meta">The message is written in the language they filled the form in.</div>
      )}
      {showMessage && (
        <div className="sd-card sd-card-pad" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {msg.body}
        </div>
      )}
      {error && <div className="lf-notice warn" role="alert">{error}</div>}
      <Btn sm kind="ghost" disabled={busy} onClick={onCancel} style={{ alignSelf: "flex-start" }}>
        Cancel
      </Btn>
    </div>
  );
}

export function Dashboard() {
  const { locale } = useI18n();
  const [claims, setClaims] = useState<LfClaimDTO[] | null>(null);
  const [tab, setTab] = useState<Tab>("review");
  const [reviewCount, setReviewCount] = useState<number | null>(null);
  const [items, setItems] = useState<LfStaffItemDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryNote, setRetryNote] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNote, setBulkNote] = useState<string | null>(null);
  /** Which claim's return flow is open, and the outcome line of the last one. */
  const [returning, setReturning] = useState<string | null>(null);
  const [claimNote, setClaimNote] = useState<string | null>(null);

  const loadClaims = () =>
    api
      .claims()
      .then((r) => setClaims(r.claims))
      .catch((err) => setError(errorMessage(err, "Couldn't load claims.")));

  const loadItems = (which: Tab) => {
    setItems(null);
    return api
      .staffItems(TABS.find((x) => x.key === which)!.filter)
      .then((r) => {
        setItems(r.items);
        if (which === "review") setReviewCount(r.items.length);
      })
      .catch((err) => setError(errorMessage(err, "Couldn't load items.")));
  };

  // The review count rides on the tab label whichever tab is open.
  const loadReviewCount = () =>
    api
      .staffItems({ view: "review" })
      .then((r) => setReviewCount(r.items.length))
      .catch(() => {});

  useEffect(() => {
    void loadClaims();
    void loadReviewCount();
  }, []);
  useEffect(() => {
    // A selection means nothing on another tab: its actions differ.
    setSelected(new Set());
    anchor.current = null;
    void loadItems(tab);
  }, [tab]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await Promise.all([loadClaims(), loadItems(tab), loadReviewCount()]);
    } catch (err) {
      setError(errorMessage(err, "That didn't work. Try again."));
    }
  };

  /** A return flow finished — its outcome stays on screen while the queue
   *  reloads out from under the card it was about. */
  const finishReturn = async (note: string) => {
    setReturning(null);
    setClaimNote(note);
    await Promise.all([loadClaims(), loadItems(tab), loadReviewCount()]);
  };

  /** The last card clicked in selection mode — what a shift-click extends
   *  from. A ref, not state: it changes nothing on screen by itself. */
  const anchor = useRef<string | null>(null);

  /** A plain click toggles one card. Shift-click sets every card between the
   *  anchor and this one — in the grid's order — to the state the plain click
   *  would have given this card, the way mail clients do it, so one shift-click
   *  can also DEselect a run. An anchor that left the list (a reload, another
   *  tab) falls back to a plain toggle. */
  const toggle = (id: string, shiftKey: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const list = items ?? [];
      const from = anchor.current ? list.findIndex((x) => x.id === anchor.current) : -1;
      const to = list.findIndex((x) => x.id === id);
      if (shiftKey && from !== -1 && to !== -1) {
        const on = !prev.has(id);
        for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
          if (on) next.add(list[i]!.id);
          else next.delete(list[i]!.id);
        }
      } else if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
    anchor.current = id;
  };

  /** One action across the whole selection. The selection is kept on failure
   *  (part of it may have gone through — the reload shows what's left) and
   *  cleared on success. */
  const bulk = async (choice: BulkChoice) => {
    const ids = [...selected];
    if (!ids.length || bulkBusy) return;
    if (choice.confirm && !window.confirm(choice.confirm(ids.length))) return;
    setBulkBusy(true);
    setError(null);
    try {
      await api.bulkItems(ids, choice.action);
      setSelected(new Set());
    } catch (err) {
      setError(errorMessage(err, "That didn't work on some items. The lists below are reloaded."));
    } finally {
      setBulkBusy(false);
      await Promise.all([loadClaims(), loadItems(tab), loadReviewCount()]);
    }
  };

  /** Turn every selected photo, one at a time, the way the item page does:
   *  fetched back, re-encoded in the browser (the Worker has no canvas), then
   *  sent as a new photo and thumbnail under fresh keys. Sequential on
   *  purpose — each item is a download plus two uploads, and a note keeps the
   *  slow part honest. Each item leaves the selection as it finishes, so a
   *  failure stops the loop with exactly the unturned items still selected —
   *  pressing the button again finishes the job instead of double-turning
   *  what's done. */
  const rotateSelected = async (turn: Turn) => {
    const chosen = (items ?? []).filter((x) => selected.has(x.id));
    if (!chosen.length || bulkBusy) return;
    setBulkBusy(true);
    setError(null);
    try {
      for (let i = 0; i < chosen.length; i++) {
        setBulkNote(`Rotating ${i + 1} of ${chosen.length}…`);
        const item = chosen[i]!;
        const res = await fetch(item.photoUrl, { credentials: "include", cache: "no-store" });
        if (!res.ok) throw new Error(`photo ${res.status}`);
        const { photo, thumb } = await rotatePhoto(await res.blob(), turn);
        await api.replacePhoto(item.id, photo);
        await api.uploadThumb(item.id, thumb);
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
      }
    } catch (err) {
      setError(errorMessage(err, "Couldn't rotate every photo. The items still selected weren't turned."));
    } finally {
      setBulkNote(null);
      setBulkBusy(false);
      await loadItems(tab);
    }
  };

  const retry = async () => {
    setRetryNote("Retrying…");
    try {
      const { retried } = await api.retagFailed();
      setRetryNote(retried ? `Retried ${retried}.` : "Nothing to retry.");
      await loadItems(tab);
    } catch (err) {
      setRetryNote(errorMessage(err, "Couldn't retry."));
    }
  };

  return (
    <Screen active="staff" title="Lost & found staff">
      <div className="lf-page">
        <div className="lf-actions">
          <Link className="sd-btn sd-btn-primary" to="/staff/upload">
            Add found items
          </Link>
        </div>

        {error && <div className="lf-notice warn" role="alert">{error}</div>}

        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 className="sd-h2">Claims</h2>
          {claimNote && <div className="sd-meta" role="status">{claimNote}</div>}
          {claims === null ? (
            <div className="sd-meta">Loading…</div>
          ) : claims.length === 0 ? (
            <div className="sd-meta">No open claims.</div>
          ) : (
            claims.map((c) => (
              <div key={c.id} className="sd-card sd-card-pad lf-claim">
                <Link to={`/staff/item/${c.itemId}`}>
                  <img src={c.thumbUrl} alt={c.itemTitle || "Found item"} />
                </Link>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                  <div>
                    <b>{c.name}</b> says{" "}
                    <Link className="sd-link" to={`/staff/item/${c.itemId}`}>
                      {c.itemTitle || "this item"}
                    </Link>{" "}
                    is theirs
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <ContactLink contact={c.contact} />
                    {/* The claimant was signed in and this IS their account
                        email — it has already received a magic link. */}
                    {c.contactVerified && <Tag tone="blue">Verified</Tag>}
                  </div>
                  {(c.childName || c.teacher) && (
                    <div style={{ overflowWrap: "anywhere" }}>
                      For {c.childName || "their child"}
                      {c.teacher && ` · ${c.teacher}`}
                    </div>
                  )}
                  {c.message && <div style={{ overflowWrap: "anywhere" }}>“{c.message}”</div>}
                  <div className="sd-meta">{formatDayTime(c.createdAt, locale)}</div>
                  {returning === c.id ? (
                    <ReturnFlow claim={c} onDone={finishReturn} onCancel={() => setReturning(null)} />
                  ) : (
                    <div className="lf-actions" style={{ marginTop: 4 }}>
                      <Btn sm onClick={() => setReturning(c.id)}>Mark returned…</Btn>
                      <Btn sm kind="ghost" onClick={() => void act(() => api.dismissClaim(c.id))}>
                        Dismiss
                      </Btn>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
          <h2 className="sd-h2">Items</h2>
          <div className="lf-filters" role="tablist">
            {TABS.map((x) => (
              <button
                key={x.key}
                type="button"
                role="tab"
                aria-selected={tab === x.key}
                aria-pressed={tab === x.key}
                className="lf-chip"
                onClick={() => setTab(x.key)}
              >
                {x.label}
                {x.key === "review" && reviewCount ? ` (${reviewCount})` : ""}
              </button>
            ))}
            {tab === "attention" && (
              <Btn sm kind="ghost" onClick={() => void retry()}>
                Retry AI on failed items
              </Btn>
            )}
            {retryNote && <span className="sd-meta">{retryNote}</span>}
          </div>

          {/* Bulk mode: cards become toggles, and the bar applies one action to
              the whole selection. The actions on offer are the tab's. */}
          <div className="lf-actions" role="toolbar" aria-label="Bulk actions">
            {!selecting ? (
              <Btn
                sm
                kind="ghost"
                disabled={!items || items.length === 0}
                onClick={() => setSelecting(true)}
              >
                Select items…
              </Btn>
            ) : (
              <>
                <span className="sd-meta" aria-live="polite">{selected.size} selected</span>
                <Btn
                  sm
                  kind="ghost"
                  disabled={bulkBusy || !items || items.length === 0}
                  onClick={() => setSelected(new Set((items ?? []).map((x) => x.id)))}
                >
                  Select all
                </Btn>
                {BULK_CHOICES[tab].map((choice) => (
                  <Btn
                    key={choice.action}
                    sm
                    disabled={bulkBusy || selected.size === 0}
                    kind={choice.warn ? "ghost" : "secondary"}
                    style={choice.warn ? { color: "var(--warn)" } : undefined}
                    onClick={() => void bulk(choice)}
                  >
                    {choice.label}
                  </Btn>
                ))}
                <Btn sm kind="ghost" disabled={bulkBusy || selected.size === 0} onClick={() => void rotateSelected("ccw")}>
                  ↺ Rotate left
                </Btn>
                <Btn sm kind="ghost" disabled={bulkBusy || selected.size === 0} onClick={() => void rotateSelected("cw")}>
                  ↻ Rotate right
                </Btn>
                <Btn sm kind="ghost" disabled={bulkBusy || selected.size === 0} onClick={() => void rotateSelected("half")}>
                  ↻↻ 180°
                </Btn>
                {bulkNote && <span className="sd-meta" role="status">{bulkNote}</span>}
                <Btn
                  sm
                  kind="ghost"
                  disabled={bulkBusy}
                  onClick={() => {
                    setSelecting(false);
                    setSelected(new Set());
                  }}
                >
                  Done
                </Btn>
              </>
            )}
          </div>

          {items === null ? (
            <div className="sd-meta">Loading…</div>
          ) : (
            <div className="lf-grid">
              {items.length === 0 && <div className="lf-empty">Nothing here.</div>}
              {items.map((item) => (
                <ItemCard
                  key={item.id}
                  to={`/staff/item/${item.id}`}
                  item={{ ...item, untitled: !item.title }}
                  extra={<Badges item={item} />}
                  selected={selected.has(item.id)}
                  onToggle={selecting ? (e) => toggle(item.id, e.shiftKey) : undefined}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </Screen>
  );
}

function Badges({ item }: { item: LfStaffItemDTO }) {
  const badges: React.ReactNode[] = [];
  if (item.openClaims > 0)
    badges.push(<Tag key="c" tone="blue">{item.openClaims} claim{item.openClaims === 1 ? "" : "s"}</Tag>);
  if (item.tagStatus === "pending") badges.push(<Tag key="p" tone="line">AI working</Tag>);
  if (item.tagStatus === "failed") badges.push(<Tag key="f" tone="orange">AI failed</Tag>);
  if (item.donateDue) badges.push(<Tag key="d" tone="orange">Time to donate</Tag>);
  if (item.heldAt) badges.push(<Tag key="r" tone="orange">Held — check photo</Tag>);
  if (item.hiddenAt) badges.push(<Tag key="h" tone="line">Hidden</Tag>);
  if (!badges.length) return null;
  return <div className="lf-tags">{badges}</div>;
}
