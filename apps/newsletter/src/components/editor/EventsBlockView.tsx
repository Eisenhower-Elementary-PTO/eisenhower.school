// In-editor view of an events block: the live event list the reader will see,
// plus the controls that define the query behind it.
//
// Showing real events (rather than a "[events go here]" placeholder) is the
// point — an admin choosing calendars and a window needs to see what that
// actually produces before mailing it to the whole school.
//
// Two views of the same resolved list, because they answer different questions.
// "Preview" runs the real renderer and shows what the reader gets; it's the
// default, since that's the question an author is usually asking. "List" is the
// compact app-styled version, easier to scan while picking calendars and a
// window. Note they disagree about time zones on purpose — see the TZ comment.

import { useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { eventKey, formatEventDay, formatEventTime, hasFixedRange, shiftIsoDate } from "@sd/shared";
import { Icon } from "../Icon.js";
import { useCalendarFeeds, useLiveEvents } from "../../lib/useCalendarFeeds.js";
import { EventsPreview } from "./EventsPreview.js";

const LOOKAHEAD_CHOICES = [7, 14, 30, 60];

// The compact list is for the author, so it reads times in the author's own
// zone. The sent email, the archive and the Preview view use the school's
// configured zone instead, since they have no viewer to ask.
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const LOCALE = "en-US";

/** Today as YYYY-MM-DD in `timeZone` — the sensible default when an author
 *  switches a block to fixed dates. `en-CA` formats as ISO. */
function todayIn(timeZone: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone });
}

export function EventsBlockView({
  node,
  updateAttributes,
  deleteNode,
  selected,
  extension,
}: NodeViewProps) {
  const blockId = (node.attrs.blockId as string) ?? "blk_preview";
  const calendarIds = (node.attrs.calendarIds as string[]) ?? [];
  const lookaheadDays = (node.attrs.lookaheadDays as number) ?? 14;
  const rangeStart = (node.attrs.rangeStart as string | null) ?? null;
  const rangeEnd = (node.attrs.rangeEnd as string | null) ?? null;
  const excluded = (node.attrs.excluded as string[]) ?? [];
  const heading = (node.attrs.heading as string | null) ?? null;
  // Supplied by Editor.tsx from the loaded settings, so the preview's fallback
  // bar colour matches the issue's accent and its dates resolve in the school's
  // zone rather than the renderer's defaults.
  const accentColor = (extension.options.accentColor as string | undefined) ?? "#0068A8";
  const timeZone = (extension.options.timeZone as string | undefined) ?? "America/Chicago";
  const calendarUrl = (extension.options.calendarUrl as string | undefined) ?? "";

  const query = { calendarIds, lookaheadDays, rangeStart, rangeEnd };
  const fixed = hasFixedRange(query);

  const feeds = useCalendarFeeds();
  const events = useLiveEvents(query, timeZone);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"preview" | "list">("preview");

  const gone = new Set(excluded);
  const removeEvent = (e: { title: string; start: string; seriesId?: string; recurrenceId?: string }) =>
    updateAttributes({ excluded: [...excluded, eventKey(e as never)] });
  const restoreEvent = (key: string) =>
    updateAttributes({ excluded: excluded.filter((k) => k !== key) });

  /** Switching to fixed dates seeds today → today + the current lookahead, so
   *  the block doesn't blank out the moment the author flips the mode. */
  const useFixedRange = () => {
    const start = todayIn(timeZone);
    updateAttributes({ rangeStart: start, rangeEnd: shiftIsoDate(start, lookaheadDays) });
  };
  const useRollingWindow = () => updateAttributes({ rangeStart: null, rangeEnd: null });

  const toggleCalendar = (id: string) => {
    const next = calendarIds.includes(id)
      ? calendarIds.filter((c) => c !== id)
      : [...calendarIds, id];
    updateAttributes({ calendarIds: next });
  };

  // Empty means "every calendar" — the same convention the API uses — so the
  // label has to say that rather than "0 calendars".
  const calendarLabel =
    calendarIds.length === 0
      ? "All calendars"
      : calendarIds.length === 1
        ? (feeds.find((f) => f.id === calendarIds[0])?.name ?? "1 calendar")
        : `${calendarIds.length} calendars`;

  return (
    // The print-visibility attribute is restated by hand: a React node view
    // renders its own DOM, so addGlobalAttributes' renderHTML (which puts
    // data-print-visibility on ordinary blocks for the editor's badge styles)
    // never reaches this wrapper on its own.
    <NodeViewWrapper
      data-print-visibility={
        typeof node.attrs.printVisibility === "string" ? node.attrs.printVisibility : undefined
      }
    >
      <div className={`nlx-block${selected ? " sel" : ""}`} contentEditable={false}>
        <div className="nlx-block-bar">
          <Icon name="calendar" size={15} stroke={2} />
          <span className="nlx-block-kind">Upcoming events</span>
          <span className="nlx-block-note">
            {calendarLabel} · {fixed ? `${rangeStart} → ${rangeEnd}` : `next ${lookaheadDays} days`}
            {excluded.length > 0 && ` · ${excluded.length} removed`}
          </span>
          <div style={{ flex: 1 }} />
          <div className="nlx-modeswitch sm" role="group" aria-label="Events block view">
            <button type="button" className={`nlx-modebtn${view === "preview" ? " on" : ""}`}
              onClick={() => setView("preview")}>Preview</button>
            <button type="button" className={`nlx-modebtn${view === "list" ? " on" : ""}`}
              onClick={() => setView("list")}>List</button>
          </div>
          <button type="button" className="nlx-mini" onClick={() => setOpen((v) => !v)}>
            {open ? "Done" : "Configure"}
          </button>
          <button type="button" className="nlx-mini danger" onClick={deleteNode} title="Remove block">
            <Icon name="x" size={14} stroke={2.2} />
          </button>
        </div>

        {open && (
          <div className="nlx-block-config">
            <label className="sd-label">Heading</label>
            <input
              className="sd-input"
              value={heading ?? ""}
              placeholder="No heading"
              onChange={(e) => updateAttributes({ heading: e.target.value || null })}
            />

            <label className="sd-label" style={{ marginTop: 12 }}>Which events</label>
            <div className="nlx-modeswitch" role="group" aria-label="Event window mode">
              <button type="button" className={`nlx-modebtn${fixed ? "" : " on"}`}
                onClick={useRollingWindow}>Rolling window</button>
              <button type="button" className={`nlx-modebtn${fixed ? " on" : ""}`}
                onClick={useFixedRange}>Date range</button>
            </div>

            {fixed ? (
              <>
                <div className="nlx-daterow">
                  <div>
                    <label className="sd-label" htmlFor={`${blockId}-from`}>From</label>
                    <input
                      id={`${blockId}-from`}
                      className="sd-input"
                      type="date"
                      value={rangeStart ?? ""}
                      max={rangeEnd ?? undefined}
                      onChange={(e) => updateAttributes({ rangeStart: e.target.value || null })}
                    />
                  </div>
                  <div>
                    <label className="sd-label" htmlFor={`${blockId}-to`}>To</label>
                    <input
                      id={`${blockId}-to`}
                      className="sd-input"
                      type="date"
                      value={rangeEnd ?? ""}
                      min={rangeStart ?? undefined}
                      onChange={(e) => updateAttributes({ rangeEnd: e.target.value || null })}
                    />
                  </div>
                </div>
                <p className="nlx-block-hint">
                  Both dates are inclusive and read in {timeZone}. Fixed dates
                  don't move as the draft ages — the same events an author picks
                  today are the ones that mail.
                </p>
              </>
            ) : (
              <>
                <div className="nlx-chips">
                  {LOOKAHEAD_CHOICES.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`nlx-chip${d === lookaheadDays ? " on" : ""}`}
                      onClick={() => updateAttributes({ lookaheadDays: d })}
                    >
                      {d} days
                    </button>
                  ))}
                </div>
                <p className="nlx-block-hint">
                  Counted from whenever the issue is sent, so a draft left for a
                  week still mails a current list.
                </p>
              </>
            )}

            <label className="sd-label" style={{ marginTop: 12 }}>Calendars</label>
            <div className="nlx-chips">
              <button
                type="button"
                className={`nlx-chip${calendarIds.length === 0 ? " on" : ""}`}
                onClick={() => updateAttributes({ calendarIds: [] })}
              >
                All
              </button>
              {feeds.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`nlx-chip${calendarIds.includes(f.id) ? " on" : ""}`}
                  onClick={() => toggleCalendar(f.id)}
                >
                  <span className="nlx-dot" style={{ background: f.color }} />
                  {f.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className={`nlx-block-body${view === "preview" ? " pv" : ""}`}>
          {view === "preview" ? (
            <EventsPreview
              blockId={blockId}
              calendarIds={calendarIds}
              lookaheadDays={lookaheadDays}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              excluded={excluded}
              heading={heading}
              events={events}
              accentColor={accentColor}
              timeZone={timeZone}
              calendarUrl={calendarUrl}
            />
          ) : (
            <>
              {events === null && <div className="nlx-block-empty">Loading events…</div>}
              {events?.length === 0 && (
                <div className="nlx-block-empty">
                  No events in this window. The block will say so in the sent issue.
                </div>
              )}
              {/* A removed event stays listed, struck through, rather than
                  vanishing: the author needs to see that the gap in the preview
                  was their own doing, and needs somewhere to undo it. */}
              {events?.map((e) => {
                const key = eventKey(e);
                const off = gone.has(key);
                return (
                  <div
                    key={e.id}
                    className={`nlx-event${off ? " off" : ""}`}
                    style={{ borderLeftColor: e.source.color }}
                  >
                    <div className="nlx-event-main">
                      <div className="nlx-event-title">{e.title}</div>
                      <div className="nlx-event-meta">
                        {[formatEventDay(e, LOCALE, TZ), formatEventTime(e, LOCALE, TZ)]
                          .filter(Boolean)
                          .join(" · ")}
                        {e.location ? ` — ${e.location}` : ""}
                        {/* The same flag the rendered block draws, so the list
                            that answers "which events did my query pick?" also
                            answers "which of them are asking for help?" before
                            the author starts removing rows. */}
                        {e.volunteerSlug ? " · Volunteers needed" : ""}
                      </div>
                    </div>
                    {off ? (
                      <button type="button" className="nlx-mini" onClick={() => restoreEvent(key)}>
                        Undo
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="nlx-mini danger"
                        title={`Remove "${e.title}" from this newsletter`}
                        aria-label={`Remove ${e.title} from this newsletter`}
                        onClick={() => removeEvent(e)}
                      >
                        <Icon name="x" size={14} stroke={2.2} />
                      </button>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  );
}
