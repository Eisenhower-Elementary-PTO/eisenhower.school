// Compose one issue: metadata, the TipTap body, a live email preview, and the
// send controls.
//
// Two things worth knowing before reading:
//
//   The draft autosaves. Send reads the issue from the database, not from this
//   component's state, so an unsaved edit would silently not go out. Rather than
//   make the author remember a Save button, edits flush on a short debounce and
//   Send force-flushes first.
//
//   A sent issue is read-only, here and on the server. The editor renders in
//   view-only mode and the preview switches to the frozen event snapshot, so
//   what you see afterwards is what people actually received.
//
//   Publishing is separate from sending (migration 0031). Publish puts the
//   `/n/:slug` page up without mailing anyone, and a published draft stays
//   editable — its page shows each save. Send still works afterwards, and
//   publishes on its own if nobody did. While a page is up its web address is
//   locked and the draft can't be deleted, because both would break links
//   already shared.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Editor as TipTapEditor } from "@tiptap/react";
import type {
  NewsletterAssistChangeDTO,
  NewsletterAssistMode,
  NewsletterIssueDTO,
  NewsletterNode,
  NewsletterSettingsDTO,
} from "@sd/shared";
import { formatIssueDate, issueSlug, renderNewsletterIssuePageHtml } from "@sd/shared";
import { brandingOf } from "../lib/branding.js";
import { useDocumentEvents } from "../lib/useCalendarFeeds.js";
import { TARGET_PRINT_PAGES, usePrintEstimate } from "../lib/printEstimate.js";
import { AppShell } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader, Field, SheetOver } from "../components/parts.js";
import { Btn } from "../components/atoms.js";
import { Icon } from "../components/Icon.js";
import { Editor } from "../components/editor/Editor.js";
import { PreviewPane } from "../components/PreviewPane.js";
import { StatusChip, WebChip } from "./Issues.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { ApiError, api, errorMessage } from "../lib/api.js";

/** Trailing debounce: how long after the last keystroke a save fires. Short,
 *  because an author who stops typing and looks at the preview should see
 *  "Saved" rather than wonder. */
const AUTOSAVE_MS = 1200;

/** Floor on the gap between two saves.
 *
 *  The debounce alone measures PAUSES, and writing prose is mostly pauses — in
 *  this instance's log the editor managed 12 saves inside one minute, which is
 *  a save every five seconds for a paragraph nobody would call twelve edits.
 *  This bounds that: a burst of thinking is one write, not twelve.
 *
 *  The trade is deliberate and this is the only place it is made — up to this
 *  much typing is unsaved if the tab dies. Navigating away and Send both
 *  force-flush (see `flush`), so the exposure is a crash, and fifteen seconds
 *  of it is a sentence. Do not raise this looking for a quieter AUDIT LOG:
 *  that is settled server-side by claimEditSession, which holds however fast a
 *  client chooses to PATCH. */
const MIN_SAVE_GAP_MS = 15_000;

const POLL_MS = 2000;

/** For the events hook while the issue is still loading: no blocks, so nothing
 *  is fetched, and a stable reference so it doesn't churn the hook. */
const EMPTY_DOC: NewsletterNode = { type: "doc", content: [] };

/** The issue's public archive page. The archive is served by this app's own
 *  Pages Functions (`/n/:slug`), so it lives on the origin the editor is on. */
function publicUrl(slug: string): string {
  return `${window.location.origin}/n/${slug}`;
}

interface Draft {
  title: string;
  subtitle: string;
  subject: string;
  slug: string;
  content: NewsletterNode;
}

function SendSheet({
  issue,
  onClose,
  onConfirm,
  busy,
}: {
  issue: NewsletterIssueDTO;
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  return (
    <SheetOver onClose={onClose}>
      <h2 className="sd-h2" style={{ marginBottom: 4 }}>Send this issue?</h2>
      {issue.publishedAt ? (
        <p className="sd-lead" style={{ fontSize: 14, marginBottom: 16 }}>
          “{issue.title}” goes out to everyone subscribed. Its web page is already
          public at <code>/n/{issue.slug}</code>. Sending can't be undone, and the
          issue can't be edited afterwards.
        </p>
      ) : (
        <>
          <p className="sd-lead" style={{ fontSize: 14, marginBottom: 14 }}>
            “{issue.title}” goes out to everyone subscribed, and its web page becomes
            public at <code>/n/{issue.slug}</code>. Sending can't be undone.
          </p>
          <PublicWarning />
        </>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Btn block onClick={onConfirm} disabled={busy}>
          {busy ? "Sending…" : "Send now"}
        </Btn>
        <button className="sd-btn sd-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </SheetOver>
  );
}

function PublicWarning() {
  return (
    <div className="nlx-warn" style={{ marginBottom: 16 }}>
      <Icon name="info" size={16} stroke={2} style={{ flex: "0 0 auto", marginTop: 1 }} />
      <span>
        The web page is public — anyone with the link can read it, and the URL is
        guessable by design. Don't include anything that shouldn't leave the school
        community.
      </span>
    </div>
  );
}

/** Put the page up without mailing anyone. Its own confirmation, because it is
 *  the same publication a send makes, minus the email. */
function PublishSheet({
  issue,
  onClose,
  onConfirm,
  busy,
}: {
  issue: NewsletterIssueDTO;
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  return (
    <SheetOver onClose={onClose}>
      <h2 className="sd-h2" style={{ marginBottom: 4 }}>Publish to the web?</h2>
      <p className="sd-lead" style={{ fontSize: 14, marginBottom: 14 }}>
        “{issue.title}” goes up at <code>/n/{issue.slug}</code> and in the archive.
        Nobody is emailed.
        {issue.status === "draft" &&
          " You can keep editing it — the page shows each change — and send it later."}
        {" "}You can unpublish it at any time.
      </p>
      <PublicWarning />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Btn block onClick={onConfirm} disabled={busy}>
          {busy ? "Publishing…" : "Publish"}
        </Btn>
        <button className="sd-btn sd-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </SheetOver>
  );
}

/** Mint, copy and revoke the review link.
 *
 *  The one thing shaping this component: the URL is unrecoverable. Only its hash
 *  is stored (migration 0015), so the mint response is the sole copy that will
 *  ever exist. That makes "a link is live but I don't have it" a real state the
 *  sheet has to show honestly — the only ways out are revoking it or minting a
 *  replacement, and there is deliberately no "show me the current link". */
function ShareSheet({
  issue,
  onClose,
  onChanged,
}: {
  issue: NewsletterIssueDTO;
  onClose: () => void;
  onChanged: (link: NewsletterIssueDTO["previewLink"]) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const active = issue.previewLink.active;

  const mint = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await api.createPreviewLink(issue.id);
      setUrl(res.url);
      onChanged({ active: true, createdAt: res.createdAt });
    } catch (e) {
      setErr(errorMessage(e, "Couldn't create that link."));
    }
    setBusy(false);
  };

  const revoke = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.revokePreviewLink(issue.id);
      setUrl(null);
      onChanged({ active: false, createdAt: null });
    } catch (e) {
      setErr(errorMessage(e, "Couldn't revoke that link."));
    }
    setBusy(false);
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // A denied clipboard permission isn't worth an error banner — the URL is
      // on screen in a selectable field either way.
    }
  };

  return (
    <SheetOver onClose={onClose}>
      <h2 className="sd-h2" style={{ marginBottom: 4 }}>Share for review</h2>
      <p className="sd-lead" style={{ fontSize: 14, marginBottom: 14 }}>
        A private link to this issue as it stands, for someone who needs to read it
        before it goes out. They don't need an account.
      </p>
      <div className="nlx-warn" style={{ marginBottom: 16 }}>
        <Icon name="info" size={16} stroke={2} style={{ flex: "0 0 auto", marginTop: 1 }} />
        <span>
          Anyone with the link can read it, so treat it like the issue itself. It
          keeps working until you revoke it — including after this issue is sent.
        </span>
      </div>

      {err && <p className="sd-lead" style={{ color: "var(--warn)", fontSize: 14 }}>{err}</p>}

      {url && (
        <Field label="Link" hint="Copy it now — this is the only time it's shown.">
          <input className="sd-input" readOnly value={url} onFocus={(e) => e.target.select()} />
        </Field>
      )}

      {active && !url && (
        <p className="sd-meta" style={{ marginBottom: 10 }}>
          A link is already active. It can't be shown again — only replaced or revoked.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
        {url && (
          <Btn block icon="link" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy link"}
          </Btn>
        )}
        <button className="sd-btn sd-btn-ghost" onClick={() => void mint()} disabled={busy}>
          {busy ? "Working…" : active ? "Replace with a new link" : "Create a link"}
        </button>
        {active && (
          <button className="sd-btn sd-btn-ghost" onClick={() => void revoke()} disabled={busy}>
            Stop sharing
          </button>
        )}
        <button className="sd-btn sd-btn-ghost" onClick={onClose}>Close</button>
      </div>
    </SheetOver>
  );
}

function TestSendSheet({
  onClose,
  onSend,
}: {
  onClose: () => void;
  onSend: (addresses: string[]) => Promise<string>;
}) {
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const submit = async () => {
    const addresses = raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    if (addresses.length === 0) return;
    setBusy(true);
    setResult(await onSend(addresses));
    setBusy(false);
  };

  return (
    <SheetOver onClose={onClose}>
      <h2 className="sd-h2" style={{ marginBottom: 4 }}>Send a test</h2>
      <p className="sd-lead" style={{ fontSize: 14, marginBottom: 14 }}>
        Up to 10 addresses, separated by commas. Test copies are subject-prefixed
        and their unsubscribe link is inert, so a test can't remove anyone.
      </p>
      <Field label="Send to">
        <textarea
          className="sd-input"
          rows={3}
          value={raw}
          placeholder="you@example.com, principal@example.com"
          onChange={(e) => setRaw(e.target.value)}
        />
      </Field>
      {result && <p className="sd-meta" style={{ marginTop: 10 }}>{result}</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
        <Btn block icon="mail" onClick={() => void submit()} disabled={busy || !raw.trim()}>
          {busy ? "Sending…" : "Send test"}
        </Btn>
        <button className="sd-btn sd-btn-ghost" onClick={onClose}>Close</button>
      </div>
    </SheetOver>
  );
}

/** What a "tighten" call came back with, held until the author decides. */
interface AssistReview {
  content: NewsletterNode;
  changes: NewsletterAssistChangeDTO[];
}

/** The rewrite, block by block, before it touches the document. Applying is the
 *  author's act, not the model's — and even then it only lands in the editor,
 *  to be saved by the same autosave as any keystroke. */
function AssistReviewSheet({
  review,
  pagesBefore,
  pagesAfter,
  onApply,
  onClose,
}: {
  review: AssistReview;
  /** Print estimates for the draft as it stands and as proposed, when the
   *  composer has them — pagesAfter lags a moment while the rewrite is being
   *  measured, and the line simply waits for it. */
  pagesBefore: number | null;
  pagesAfter: number | null;
  onApply: () => void;
  onClose: () => void;
}) {
  const n = review.changes.length;
  return (
    <SheetOver onClose={onClose}>
      <h2 className="sd-h2" style={{ marginBottom: 4 }}>Tighter draft</h2>
      <p className="sd-lead" style={{ fontSize: 14, marginBottom: 10 }}>
        The assistant reworded {n === 1 ? "one section" : `${n} sections`}. Nothing changes
        until you apply it, and you can undo afterwards. Check every fact — dates, times,
        names — before you trust it. Bold, italics and links carry over; custom text sizes
        inside a reworded section are reset.
      </p>
      {pagesBefore !== null && pagesAfter !== null && (
        <p className="sd-meta" style={{ marginTop: 0, marginBottom: 10 }}>
          Estimated print length: ≈{pagesBefore.toFixed(1)} pages now, ≈{pagesAfter.toFixed(1)} with
          the rewrite.
        </p>
      )}
      <div style={{ maxHeight: "45vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, marginBottom: 14 }}>
        {review.changes.map((ch, i) => (
          <div key={i} className="sd-card" style={{ padding: "10px 12px" }}>
            <p className="sd-meta" style={{ margin: 0, textDecoration: "line-through", opacity: 0.75 }}>
              {ch.before}
            </p>
            <p style={{ margin: "6px 0 0", fontSize: 14 }}>{ch.after}</p>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Btn block icon="check" onClick={onApply}>Apply the rewrite</Btn>
        <button className="sd-btn sd-btn-ghost" onClick={onClose}>Keep my wording</button>
      </div>
    </SheetOver>
  );
}

/** Editorial notes — advice only, so the whole lifecycle is reading the list
 *  and dismissing it. Nothing in the draft moved. */
function AssistSuggestions({ items, onClose }: { items: string[]; onClose: () => void }) {
  return (
    <div className="sd-card" style={{ padding: "12px 14px", marginBottom: 10 }}>
      <div className="sd-row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700 }}>Editorial suggestions</span>
        <button className="sd-btn sd-btn-ghost sd-btn-sm" onClick={onClose} aria-label="Dismiss suggestions">
          <Icon name="x" size={14} />
        </button>
      </div>
      <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((s, i) => (
          <li key={i} style={{ fontSize: 14, lineHeight: 1.5 }}>{s}</li>
        ))}
      </ol>
      <p className="sd-meta" style={{ margin: "8px 0 0" }}>
        From an AI model — advice to weigh, not applied changes. Nothing in the draft moved.
      </p>
    </div>
  );
}

function SendProgress({ issue }: { issue: NewsletterIssueDTO }) {
  const counts = issue.recipientCounts;
  if (!counts) return null;
  const total = counts.pending + counts.sent + counts.failed;
  const done = counts.sent + counts.failed;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div className="sd-card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 9 }}>
      <div className="sd-row" style={{ justifyContent: "space-between" }}>
        <span style={{ fontSize: 13.5, fontWeight: 700 }}>
          {issue.status === "sending" ? "Sending…" : "Delivery"}
        </span>
        <span className="sd-meta">{done} of {total}</span>
      </div>
      <div className="nlx-progress"><span style={{ width: `${pct}%` }} /></div>
      {counts.failed > 0 && (
        <p className="sd-meta" style={{ color: "var(--warn)" }}>
          {counts.failed} {counts.failed === 1 ? "address" : "addresses"} failed.
        </p>
      )}
    </div>
  );
}

export function IssueEditor() {
  const { id = "" } = useParams();
  const desktop = useIsDesktop();
  const navigate = useNavigate();

  const [issue, setIssue] = useState<NewsletterIssueDTO | null>(null);
  const [settings, setSettings] = useState<NewsletterSettingsDTO | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [sheet, setSheet] = useState<"send" | "test" | "share" | "publish" | null>(null);
  const [sending, setSending] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const [copying, setCopying] = useState(false);

  // AI assist (Workers AI, server-side). Everything below is proposal state:
  // nothing reaches the document until applyAssist feeds the editor, and the
  // save that makes it durable is the same autosave every keystroke uses.
  const [aiAssist, setAiAssist] = useState(false);
  const [assistBusy, setAssistBusy] = useState<NewsletterAssistMode | null>(null);
  /** One line of outcome — "nothing to tighten", a 429, a model failure. */
  const [assistNote, setAssistNote] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [assistReview, setAssistReview] = useState<AssistReview | null>(null);
  /** The document as it stood when a rewrite was applied — the Undo button. */
  const [assistUndo, setAssistUndo] = useState<NewsletterNode | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraft = useRef<Draft | null>(null);
  /** The TipTap instance, for applying/undoing a rewrite in place. */
  const tiptap = useRef<TipTapEditor | null>(null);
  /** When the last save was ISSUED, for the MIN_SAVE_GAP_MS floor. Starts at 0
   *  so the first edit after opening the editor is never held back. */
  const lastSaveAt = useRef(0);
  /** The save currently on the wire, if any. `pendingDraft` is cleared when a
   *  request is ISSUED, not when it lands, so it alone can't answer "is
   *  everything saved?" — Send would see nothing pending and race the PATCH
   *  that carries the author's last edit. */
  const inFlight = useRef<Promise<boolean> | null>(null);
  const readOnly = issue !== null && issue.status !== "draft";
  /** The latest saved issue, for a handler that reads it after awaiting a
   *  flush — the `issue` its closure captured is from before the save landed. */
  const issueRef = useRef(issue);
  issueRef.current = issue;

  // ── Printed-length estimate ────────────────────────────────────────────────
  // The draft, rendered exactly as the print view renders it (same inputs as
  // IssuePrint.tsx's build), measured in a hidden iframe under the print rules
  // (lib/printEstimate.ts). `page` feeds the "≈N printed pages" chip and sizes
  // the shrink target the succinct assist is asked for; `review` measures a
  // proposed rewrite while the review sheet is open, so the author sees whether
  // accepting it actually gets the issue under the goal.
  const events = useDocumentEvents(
    draft?.content ?? EMPTY_DOC,
    issue?.eventsSnapshot ?? null,
    settings?.timeZone ?? "UTC",
  );
  const measuredHtml = useMemo(() => {
    if (!issue || !draft || !settings) return { page: null, review: null };
    const build = (doc: NewsletterNode) =>
      renderNewsletterIssuePageHtml({
        branding: brandingOf(settings),
        title: draft.title || "Untitled",
        subtitle: draft.subtitle.trim() ? draft.subtitle : null,
        doc,
        resolveEvents: (attrs) => events[attrs.blockId] ?? [],
        // Matches IssuePrint.tsx, so the measured page is the printed page:
        // a date line only once the issue is published, never "Last edited".
        dateLabel:
          issue.publishedAt !== null ? formatIssueDate(issue.sentAt ?? issue.publishedAt) : "",
        // Mirrors IssuePrint.tsx: no banner, no language bar, no archive or
        // print links — and the QR block, which takes real space on paper.
        isDraft: false,
        issueUrl: "",
        publishedUrl: draft.slug
          ? `${window.location.origin}/n/${encodeURIComponent(draft.slug)}`
          : "",
        archiveHref: "",
        printHref: "",
        timeZone: settings.timeZone,
      });
    return {
      page: build(draft.content),
      review: assistReview ? build(assistReview.content) : null,
    };
  }, [issue, draft, settings, events, assistReview]);
  const printEst = usePrintEstimate(measuredHtml.page);
  const reviewEst = usePrintEstimate(measuredHtml.review);

  useEffect(() => {
    // "Make a copy" navigates from one issue's editor straight to another's, so
    // this effect can fire on a LIVE editor rather than a fresh mount. Every
    // piece of per-issue state has to reset here, or the old issue bleeds into
    // the new one — the null issue/draft also unmounts the TipTap instance,
    // which only reads `content` at creation and would otherwise keep showing
    // the document it was built with. Nothing is lost: makeCopy flushes before
    // it navigates, and a cleared pendingDraft is what stops a stale timer from
    // PATCHing the OLD issue's text onto the NEW id.
    setIssue(null);
    setDraft(null);
    setSaveState("idle");
    setAssistNote(null);
    setSuggestions(null);
    setAssistReview(null);
    setAssistUndo(null);
    if (timer.current) clearTimeout(timer.current);
    pendingDraft.current = null;
    lastSaveAt.current = 0;
    Promise.all([api.issue(id), api.settings()])
      .then(([i, s]) => {
        setIssue(i.issue);
        setSettings(s.settings);
        setAiAssist(Boolean(s.aiAssist));
        setDraft({
          title: i.issue.title,
          subtitle: i.issue.subtitle ?? "",
          subject: i.issue.subject,
          slug: i.issue.slug,
          content: i.issue.content,
        });
      })
      .catch((err: unknown) => setError(errorMessage(err, "Couldn't load this issue.")));
  }, [id]);

  // Poll while the fan-out runs so the progress bar and final counts settle
  // without the admin reloading.
  useEffect(() => {
    if (issue?.status !== "sending") return;
    const handle = setInterval(() => {
      void api.issue(id).then((r) => setIssue(r.issue)).catch(() => {});
    }, POLL_MS);
    return () => clearInterval(handle);
  }, [issue?.status, id]);

  /** Persist any pending edit and wait for anything already in flight.
   *
   *  Saves are serialized through `inFlight` rather than fired concurrently: two
   *  overlapping PATCHes can land out of order, letting an older body overwrite
   *  newer content. */
  const flush = useCallback(async (): Promise<boolean> => {
    const previous = inFlight.current;
    if (previous) await previous;

    const next = pendingDraft.current;
    if (!next) return true;
    pendingDraft.current = null;
    lastSaveAt.current = Date.now();
    setSaveState("saving");

    const run = (async () => {
      try {
        const { issue: saved } = await api.updateIssue(id, {
          title: next.title.trim() || "Untitled newsletter",
          subtitle: next.subtitle.trim() || null,
          subject: next.subject.trim() || next.title.trim(),
          slug: next.slug.trim() || undefined,
          content: next.content,
        });
        // The server may have adjusted the slug (uniqueness); reflect that back.
        setIssue(saved);
        issueRef.current = saved; // before the re-render, for copyPublicUrl
        setDraft((d) => (d ? { ...d, slug: saved.slug } : d));
        setSaveState("saved");
        return true;
      } catch (err) {
        // A 409 here means the issue was sent while this save was in flight, so
        // the edit is moot — reporting "couldn't save" on top of a successful
        // send would just be alarming and wrong.
        if (err instanceof ApiError && err.status === 409) return true;
        setSaveState("error");
        setError(errorMessage(err, "Couldn't save your changes."));
        return false;
      } finally {
        inFlight.current = null;
      }
    })();

    inFlight.current = run;
    return run;
  }, [id]);

  /** Copy the address the issue WILL be published at. It's the SAVED slug, not
   *  the one in the input: the server uniquifies on save (-2, -3, …), so a slug
   *  typed a second ago may not be the one that ends up public. With nothing
   *  pending the write happens straight off the click; otherwise it waits for
   *  the flush, which some browsers refuse once the gesture has gone stale —
   *  the address is still in the field's hint to select by hand. */
  const copyPublicUrl = async () => {
    if (pendingDraft.current || inFlight.current) {
      if (timer.current) clearTimeout(timer.current);
      if (!(await flush())) return;
    }
    const slug = issueRef.current?.slug;
    if (!slug) return;
    try {
      await navigator.clipboard.writeText(publicUrl(slug));
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 1500);
    } catch {
      /* clipboard refused — the URL is on screen in the hint */
    }
  };

  const edit = useCallback(
    (patch: Partial<Draft>) => {
      setDraft((current) => {
        if (!current) return current;
        const next = { ...current, ...patch };
        pendingDraft.current = next;
        return next;
      });
      setSaveState("saving");
      if (timer.current) clearTimeout(timer.current);
      // Whichever is later: a beat after this keystroke, or the floor since the
      // last save. Recomputed per keystroke, so the wait shrinks as the floor
      // elapses and an isolated edit still lands in AUTOSAVE_MS.
      const wait = Math.max(AUTOSAVE_MS, MIN_SAVE_GAP_MS - (Date.now() - lastSaveAt.current));
      timer.current = setTimeout(() => void flush(), wait);
    },
    [flush],
  );

  // Flush on unmount so navigating away mid-debounce doesn't drop the last edit.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    void flush();
  }, [flush]);

  const send = async () => {
    setSending(true);
    if (timer.current) clearTimeout(timer.current);
    // Send reads from the database, so anything still in the debounce window has
    // to land first or it simply wouldn't go out.
    if (!(await flush())) {
      setSending(false);
      return;
    }
    try {
      await api.sendIssue(id);
      const { issue: updated } = await api.issue(id);
      setIssue(updated);
      setSheet(null);
    } catch (err) {
      setError(errorMessage(err, "Couldn't send this issue."));
    } finally {
      setSending(false);
    }
  };

  const publish = async () => {
    setPublishing(true);
    if (timer.current) clearTimeout(timer.current);
    // The page renders what's in the database, so the last edit lands first.
    if (!(await flush())) {
      setPublishing(false);
      return;
    }
    try {
      const { issue: updated } = await api.publishIssue(id);
      setIssue(updated);
      setSheet(null);
    } catch (err) {
      setError(errorMessage(err, "Couldn't publish this issue."));
    } finally {
      setPublishing(false);
    }
  };

  const unpublish = async () => {
    const cost =
      issue?.status === "sent"
        ? "The email's “view in browser” link, its translation links and any printed QR code will stop working."
        : "Anyone holding the link — or a printed QR code — will get a “not available” page.";
    if (!window.confirm(`Take this issue off the web? ${cost} You can publish it again later.`)) return;
    try {
      const { issue: updated } = await api.unpublishIssue(id);
      setIssue(updated);
    } catch (err) {
      setError(errorMessage(err, "Couldn't unpublish this issue."));
    }
  };

  const testSend = async (addresses: string[]): Promise<string> => {
    if (timer.current) clearTimeout(timer.current);
    if (!(await flush())) return "Save failed — the test wasn't sent.";
    try {
      const r = await api.testSend(id, addresses);
      return `Sent ${r.sent} of ${r.attempted}.`;
    } catch (err) {
      return errorMessage(err, "The test couldn't be sent.");
    }
  };

  const retry = async () => {
    try {
      await api.retryIssue(id);
      const { issue: updated } = await api.issue(id);
      setIssue(updated);
    } catch (err) {
      setError(errorMessage(err, "Nothing to retry."));
    }
  };

  /** Ask the assistant. Flushes first — the server reads the SAVED draft, so an
   *  edit still in the debounce window would be invisible to it, like Send.
   *  When the print estimate says the draft runs past the page goal, a succinct
   *  pass carries the measured shrink target, turning "tidy the wordy bits"
   *  into "cut about this much" — the flush doesn't change the content, so the
   *  estimate in hand still describes what the server will read. */
  const runAssist = async (mode: NewsletterAssistMode) => {
    const reduce =
      mode === "succinct" && printEst && !printEst.fits && printEst.suggestedReduce !== null
        ? printEst.suggestedReduce
        : undefined;
    setAssistBusy(mode);
    setAssistNote(null);
    if (timer.current) clearTimeout(timer.current);
    if (!(await flush())) {
      setAssistBusy(null);
      return;
    }
    try {
      const { result } = await api.assistIssue(id, mode, reduce !== undefined ? { reduce } : undefined);
      if (mode === "suggestions") {
        if (result.suggestions.length === 0) {
          setAssistNote("The assistant had nothing to flag.");
        } else {
          setSuggestions(result.suggestions);
        }
      } else if (!result.content || result.changes.length === 0) {
        setAssistNote("Nothing to tighten — the assistant left the draft as it is.");
      } else {
        setAssistReview({ content: result.content, changes: result.changes });
      }
    } catch (err) {
      setAssistNote(errorMessage(err, "The assistant couldn't answer. Try again in a minute."));
    }
    setAssistBusy(null);
  };

  /** The author said yes: swap the rewrite into the editor. setContent emits an
   *  update, so the ordinary autosave carries it — one write path, one audit
   *  sitting. The document as it stood is kept for the Undo banner. */
  const applyAssist = () => {
    if (!assistReview) return;
    const previous = draft?.content ?? issue?.content;
    tiptap.current?.commands.setContent(assistReview.content, true);
    if (previous) setAssistUndo(previous);
    setAssistReview(null);
  };

  const undoAssist = () => {
    if (!assistUndo) return;
    tiptap.current?.commands.setContent(assistUndo, true);
    setAssistUndo(null);
  };

  /** Keeps the LATEST instance — the editor rebuilds when read-only flips. */
  const editorReady = useCallback((editor: TipTapEditor) => {
    tiptap.current = editor;
  }, []);

  /** Duplicate this issue as a fresh draft and open it. Goes through the
   *  ordinary create route — one write path, so the copy is sanitized, slugged
   *  and audited exactly like any new draft. What is deliberately NOT copied:
   *  the frozen events snapshot (a copy's events blocks resolve live again,
   *  invariant 10), the public page, and the review link (a capability, not
   *  content). Works on a sent issue on purpose — "start next month's from the
   *  last one" is the whole reason this button exists. */
  const makeCopy = async () => {
    if (!draft) return;
    setCopying(true);
    if (timer.current) clearTimeout(timer.current);
    // Land any pending edit first: the navigation below resets pendingDraft, so
    // an unsaved sentence would otherwise exist only in the copy.
    if (!readOnly && !(await flush())) {
      setCopying(false);
      return;
    }
    try {
      const { issue: copy } = await api.createIssue({
        title: `Copy of ${draft.title.trim() || "Untitled newsletter"}`,
        subtitle: draft.subtitle.trim() || null,
        // Verbatim, not re-derived from the new title: "Copy of …" is a fine
        // working title but a wrong email subject, and the old subject is the
        // better starting point for next month's.
        subject: draft.subject.trim() || undefined,
        content: draft.content,
      });
      setCopying(false);
      navigate(`/admin/issues/${copy.id}`);
    } catch (err) {
      setError(errorMessage(err, "Couldn't copy this issue."));
      setCopying(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("Delete this draft? This can't be undone.")) return;
    try {
      await api.deleteIssue(id);
      navigate("/admin", { replace: true });
    } catch (err) {
      setError(errorMessage(err, "Couldn't delete this draft."));
    }
  };

  if (error && !issue) {
    return (
      <AppShell>
        <div className="sd-scroll" style={{ padding: 24 }}>
          <p className="sd-lead" style={{ color: "var(--warn)" }}>{error}</p>
        </div>
      </AppShell>
    );
  }
  if (!issue || !draft || !settings) {
    return (
      <AppShell>
        <div className="sd-scroll" style={{ display: "grid", placeItems: "center" }}>
          <div className="sd-spinner" />
        </div>
      </AppShell>
    );
  }

  const saveLabel =
    saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved" : saveState === "saved" ? "Saved" : "";

  const body = (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && <p className="sd-lead" style={{ color: "var(--warn)", margin: 0 }}>{error}</p>}

      <div className="sd-row" style={{ gap: 10, flexWrap: "wrap" }}>
        <StatusChip status={issue.status} />
        <WebChip publishedAt={issue.publishedAt} />
        {!readOnly && <span className="sd-meta">{saveLabel}</span>}
        <div style={{ flex: 1 }} />
        {/* Measured, not guessed — lib/printEstimate.ts. Approximate on purpose
            (print pagination adds slack a continuous measure can't see), hence
            the ≈; the exact count is the print dialog's to give. */}
        {printEst && (
          <span
            className="sd-meta"
            style={printEst.fits ? undefined : { color: "var(--warn)", fontWeight: 600 }}
            title={`Estimated length on Letter paper; the goal is ${TARGET_PRINT_PAGES} pages. Open "View as PDF" for the exact count.`}
          >
            ≈{printEst.pages.toFixed(1)} printed pages
          </span>
        )}
        {/* Available whether or not the issue has been sent — "give me a PDF of
            that newsletter" is asked about back issues at least as often as
            about drafts. Opens in a tab so the print dialog doesn't take over
            the editor. */}
        <a
          className="sd-btn sd-btn-ghost"
          href={`/admin/issues/${id}/print`}
          target="_blank"
          rel="noopener"
        >
          View as PDF
        </a>
        {/* On sent issues too — a sent issue is the natural template for the
            next one, and copying is the only way to "edit" one. */}
        <button className="sd-btn sd-btn-ghost" onClick={() => void makeCopy()} disabled={copying}>
          {copying ? "Copying…" : "Make a copy"}
        </button>
        <button className="sd-btn sd-btn-ghost" onClick={() => setSheet("share")}>
          {issue.previewLink.active ? "Sharing…" : "Share for review…"}
        </button>
        {issue.publishedAt ? (
          <>
            <a className="sd-btn sd-btn-ghost" href={publicUrl(issue.slug)} target="_blank" rel="noopener">
              View page
            </a>
            {issue.status !== "sending" && (
              <button className="sd-btn sd-btn-ghost" onClick={() => void unpublish()}>Unpublish</button>
            )}
          </>
        ) : (
          issue.status !== "sending" && (
            <button className="sd-btn sd-btn-ghost" onClick={() => setSheet("publish")}>Publish…</button>
          )
        )}
        {!readOnly && (
          <>
            <button className="sd-btn sd-btn-ghost" onClick={() => setSheet("test")}>Send test</button>
            <Btn icon="mail" onClick={() => setSheet("send")}>Send…</Btn>
          </>
        )}
        {issue.status === "sent" && (issue.recipientCounts?.failed ?? 0) > 0 && (
          <button className="sd-btn sd-btn-ghost" onClick={() => void retry()}>Retry failed</button>
        )}
      </div>

      {issue.status !== "draft" && <SendProgress issue={issue} />}

      {readOnly && (
        <div className="nlx-warn">
          <Icon name="lock" size={16} stroke={2} style={{ flex: "0 0 auto", marginTop: 1 }} />
          <span>
            This issue has been sent, so it can no longer be edited — its public page
            has to keep matching what landed in people's inboxes.
          </span>
        </div>
      )}

      <div className="nlx-formgrid">
        <Field label="Title" hint="Shown as the headline, in the archive, and as the default subject.">
          <input className="sd-input" value={draft.title} readOnly={readOnly}
            onChange={(e) => edit({ title: e.target.value })} />
        </Field>
        <div className="nlx-formrow">
          <Field label="Subtitle" hint="Optional.">
            <input className="sd-input" value={draft.subtitle} readOnly={readOnly}
              onChange={(e) => edit({ subtitle: e.target.value })} />
          </Field>
          <Field label="Email subject" hint="Defaults to the title.">
            <input className="sd-input" value={draft.subject} readOnly={readOnly}
              onChange={(e) => edit({ subject: e.target.value })} />
          </Field>
        </div>
        <Field
          label="Web address"
          hint={
            issue.publishedAt
              ? `Live at ${publicUrl(issue.slug)} — unpublish to change it.`
              : `Public page: ${publicUrl(draft.slug)}`
          }
        >
          {/* Dated from the issue's own createdAt, not today: re-deriving the
              slug for a draft started last week shouldn't silently move it to
              today's date. Same helper the server uses at create time, so the
              button previews exactly what it would have minted. The server
              still uniquifies on save (-2, -3, …) and flush() reflects that
              back, so a collision here isn't the author's problem. */}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input className="sd-input" style={{ flex: 1, minWidth: 0 }} value={draft.slug}
              readOnly={readOnly || issue.publishedAt !== null}
              onChange={(e) => edit({ slug: e.target.value })} />
            {!readOnly && issue.publishedAt === null && (
              <button
                type="button"
                className="sd-btn sd-btn-ghost sd-btn-sm"
                style={{ flex: "0 0 auto" }}
                onClick={() => edit({ slug: issueSlug(draft.title, issue.createdAt) })}
              >
                Generate
              </button>
            )}
            <button
              type="button"
              className="sd-btn sd-btn-ghost sd-btn-sm"
              style={{ flex: "0 0 auto" }}
              onClick={() => void copyPublicUrl()}
              disabled={!draft.slug.trim()}
            >
              {urlCopied ? "Copied" : "Copy URL"}
            </button>
          </div>
        </Field>
      </div>

      <div className="nlx-layout">
        <div>
          {aiAssist && !readOnly && (
            <div className="sd-row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <span className="sd-eyebrow" style={{ marginRight: 2 }}>AI assistant</span>
              <button
                type="button"
                className="sd-btn sd-btn-ghost sd-btn-sm"
                onClick={() => void runAssist("succinct")}
                disabled={assistBusy !== null}
              >
                {/* One button, two asks: over the page goal it carries the
                    measured shrink target (see runAssist), and the label says
                    so — under it, it stays the gentle tidy it has always been. */}
                <Icon name="bolt" size={14} />{" "}
                {assistBusy === "succinct"
                  ? "Tightening…"
                  : printEst && !printEst.fits
                    ? `Tighten to fit ${TARGET_PRINT_PAGES} pages`
                    : "Make it more succinct"}
              </button>
              <button
                type="button"
                className="sd-btn sd-btn-ghost sd-btn-sm"
                onClick={() => void runAssist("suggestions")}
                disabled={assistBusy !== null}
              >
                <Icon name="eye" size={14} /> {assistBusy === "suggestions" ? "Reading…" : "Editorial suggestions"}
              </button>
              {assistNote && <span className="sd-meta">{assistNote}</span>}
            </div>
          )}
          {assistUndo && !readOnly && (
            <div className="nlx-warn" style={{ marginBottom: 10, alignItems: "center" }}>
              <Icon name="bolt" size={16} stroke={2} style={{ flex: "0 0 auto" }} />
              <span style={{ flex: 1 }}>AI rewrite applied. Re-read it before sending.</span>
              <button type="button" className="sd-btn sd-btn-ghost sd-btn-sm" onClick={undoAssist}>
                Undo
              </button>
              <button
                type="button"
                className="sd-btn sd-btn-ghost sd-btn-sm"
                onClick={() => setAssistUndo(null)}
                aria-label="Dismiss"
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          )}
          {suggestions && <AssistSuggestions items={suggestions} onClose={() => setSuggestions(null)} />}
          <Editor
            content={issue.content}
            editable={!readOnly}
            accentColor={settings.accentColor}
            timeZone={settings.timeZone}
            calendarUrl={settings.calendarUrl}
            onChange={(content) => edit({ content })}
            onReady={editorReady}
          />
        </div>
        <div className="nlx-preview-col">
          <p className="sd-eyebrow" style={{ marginBottom: 7 }}>Email preview</p>
          <PreviewPane
            doc={draft.content}
            settings={settings}
            title={draft.title}
            subtitle={draft.subtitle || null}
            slug={draft.slug}
            frozenEvents={issue.eventsSnapshot}
          />
        </div>
      </div>

      {!readOnly && issue.publishedAt === null && (
        <div>
          <button className="sd-btn sd-btn-ghost" style={{ color: "var(--warn)" }} onClick={() => void remove()}>
            Delete draft
          </button>
        </div>
      )}
      {!readOnly && issue.publishedAt !== null && (
        <p className="sd-meta" style={{ margin: 0 }}>Unpublish this draft to delete it.</p>
      )}

      {sheet === "send" && (
        <SendSheet issue={issue} busy={sending} onClose={() => setSheet(null)} onConfirm={() => void send()} />
      )}
      {sheet === "publish" && (
        <PublishSheet issue={issue} busy={publishing} onClose={() => setSheet(null)} onConfirm={() => void publish()} />
      )}
      {sheet === "test" && <TestSendSheet onClose={() => setSheet(null)} onSend={testSend} />}
      {assistReview && (
        <AssistReviewSheet
          review={assistReview}
          pagesBefore={printEst?.pages ?? null}
          pagesAfter={reviewEst?.pages ?? null}
          onApply={applyAssist}
          onClose={() => setAssistReview(null)}
        />
      )}
      {sheet === "share" && (
        <ShareSheet
          issue={issue}
          onClose={() => setSheet(null)}
          onChanged={(previewLink) => setIssue((i) => (i ? { ...i, previewLink } : i))}
        />
      )}
    </div>
  );

  if (desktop) {
    return (
      <DesktopShell active="newsletter" title={draft.title || "Untitled newsletter"}>
        <button className="sd-btn sd-btn-ghost sd-btn-sm nlx-backlink" onClick={() => navigate("/admin")}>
          <Icon name="arrowleft" size={15} /> All issues
        </button>
        {body}
      </DesktopShell>
    );
  }
  return (
    <AppShell>
      <ScreenHeader title="Edit issue" onLeft={() => navigate("/admin")} />
      <div className="sd-scroll" style={{ padding: "14px 16px 28px" }}>{body}</div>
    </AppShell>
  );
}
