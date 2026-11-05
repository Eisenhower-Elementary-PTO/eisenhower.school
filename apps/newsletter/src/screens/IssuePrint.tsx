// GET /admin/issues/:id/print — an issue laid out for paper, for the admin who
// is already signed in.
//
// Why this is an SPA route and not a Pages Function like its two public
// siblings: the session cookie is host-only to the API's hostname and is never
// present on a navigation to this origin, so a Function here structurally
// cannot tell an admin from anyone else (see functions/_lib/page.ts). Routing
// the admin's own "view as PDF" through a minted review link instead would
// conflate two independent features and make a one-click action require
// creating a shareable secret first.
//
// It renders through the SAME renderer the public page and the email use
// (invariant 9) — this is its fifth call site, and the fourth that runs it in a
// browser rather than at the edge, exactly as PreviewPane already does for the
// email. Nothing about it is print-specific except the @media print block that
// already lives in NEWSLETTER_WEB_CSS and the dialog fired below.

import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type { CalendarEventDTO, NewsletterIssueDTO, NewsletterSettingsDTO } from "@sd/shared";
import {
  formatIssueDate,
  NEWSLETTER_WEB_CSS,
  renderNewsletterIssuePageHtml,
} from "@sd/shared";
import { api, errorMessage } from "../lib/api.js";
import { brandingOf } from "../lib/branding.js";

/** Longest the dialog waits on images before printing whatever has arrived. */
const IMAGE_WAIT_MS = 10_000;

export function IssuePrint() {
  const { id = "" } = useParams();
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        // All three in parallel, then render once: the print dialog must not
        // open over a half-built page.
        const [issueRes, settingsRes, eventsRes] = await Promise.all([
          api.issue(id),
          api.settings(),
          api.issuePreviewEvents(id),
        ]);
        if (!alive) return;
        setHtml(build(issueRes.issue, settingsRes.settings, eventsRes.eventsSnapshot));
      } catch (err) {
        if (alive) setError(errorMessage(err, "Couldn't load that issue."));
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  // Fires once, after the markup is in the DOM AND its images have arrived.
  // The public print pages wait for `load`, which covers images; here the bundle
  // loaded long ago, so there is no load event left to wait for, and printing on
  // the next frame — as this once did — sent every body image to the dialog
  // still downloading, which prints as a blank gap. So it waits on each <img>
  // itself: settled means loaded OR failed (a broken image must not hold the
  // dialog forever), and IMAGE_WAIT_MS caps the whole thing for a slow network,
  // where a page with a gap beats a dialog that never opens.
  // `requestAnimationFrame` then lets the browser lay out what arrived; without
  // it Safari can open the dialog over a page it hasn't painted.
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (html === null || !body.current) return;
    let cancelled = false;
    let frame = 0;
    const pending = Array.from(body.current.querySelectorAll("img"))
      .filter((img) => !img.complete)
      .map(
        (img) =>
          new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          }),
      );
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, IMAGE_WAIT_MS));
    void Promise.race([Promise.all(pending), timeout]).then(() => {
      if (cancelled) return;
      frame = requestAnimationFrame(() => window.print());
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [html]);

  if (error) return <p style={{ padding: 24, fontFamily: "system-ui" }}>{error}</p>;
  if (html === null) return <p style={{ padding: 24, fontFamily: "system-ui" }}>Preparing…</p>;

  return (
    <>
      {/* Scoped to this route by being mounted with it — the screen renders no
          app chrome at all, so there is nothing here for these rules to hit but
          the issue itself. */}
      <style dangerouslySetInnerHTML={{ __html: NEWSLETTER_WEB_CSS }} />
      {/* Same trust level as PreviewPane: this HTML came from the one renderer,
          over a document the API sanitized on write. */}
      <div ref={body} dangerouslySetInnerHTML={{ __html: html }} />
    </>
  );
}

function build(
  issue: NewsletterIssueDTO,
  settings: NewsletterSettingsDTO,
  events: Record<string, CalendarEventDTO[]>,
): string {
  return renderNewsletterIssuePageHtml({
    branding: brandingOf(settings),
    title: issue.title || "Untitled",
    subtitle: issue.subtitle,
    doc: issue.content,
    resolveEvents: (attrs) => events[attrs.blockId] ?? [],
    // "" for an unpublished issue: no "Last edited" bookkeeping on the page.
    dateLabel:
      issue.publishedAt !== null ? formatIssueDate(issue.sentAt ?? issue.publishedAt) : "",
    // Never the draft banner here, sent or not. It exists to warn a REVIEWER
    // holding a link (and says "private preview link", which this isn't); the
    // admin printing this knows what they're printing, and the banner would
    // land on every copy they hand out. isDraft drives nothing but the banner.
    isDraft: false,
    // Nor a language bar: a print view is paper, and this one is behind an
    // admin session for an issue that may not even be sent yet.
    issueUrl: "",
    // The QR code on paper — for a draft too, unlike the public print views.
    // This view is how an admin prints copies to hand out, often BEFORE the
    // send, and the slug is already the permanent address (the editor shows it
    // as the public page). Until the issue is sent that address 404s, which is
    // the admin's call to make; the code can never carry a token either way.
    publishedUrl: issue.slug ? `${window.location.origin}/n/${encodeURIComponent(issue.slug)}` : "",
    // No archive link and no link to a print view: this page IS the print view,
    // and it is reached from the editor rather than from a reader's journey.
    archiveHref: "",
    printHref: "",
    // The school's zone, not the author's — the same one the send uses, so an
    // event near midnight doesn't print on the wrong day.
    timeZone: settings.timeZone,
  });
}
